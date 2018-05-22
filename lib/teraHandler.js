const _ = require('lodash');
const IpcClient = require('./ipc/IpcClient.js');
const Sysmsg = require('./sysmsg');
const TeraStrings = require('./tera-strings');
const U = require('./util');
const fs = require('fs');
const util = require('util');

const dir = `${__dirname}/logs`;
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

const saveLog = (filename, object) => {
  fs.writeFile(
    `${__dirname}/logs/${filename}.json`,
    util.inspect(object),
    err => (err ? console.log(err) : console.log(`The ${filename} logfile was saved!`))
  );
};

const appendString = (filename, string) => {
  fs.appendFile(
    `${__dirname}/logs/${filename}.txt`,
    string,
    err => (err ? console.log(err) : console.log(`The ${filename} logfile was saved!`))
  );
};

// How often to request guild info update from Tera
const REFRESH_THRESHOLD = 60 * 1000;
const REFRESH_TIMER = 15 * 1000;

class TeraHandler {
  constructor(dispatch, config) {
    this.dispatch = dispatch;
    this.config = config;

    this.GINFO_TYPE = {
      details: 2,
      members: 5,
      quests: 6
    };

    // auto updates
    this.lastUpdate = {};

    this.state = {
      loggedIn: false
    };
    this.loaded = false;
    this.messageQueue = [];
    this.guildId = 0;
    this.myName = false;
    this.motd = '';
    this.currAllGuildies = [];
    this.currOnlineGuildies = [];
    this.allGuildies = [];
    this.onlineGuildies = [];
    this.quests = [];
    this.currGuildQuestList = {};
    this.guildQuestList = {};

    this.sysmsg = new Sysmsg(this.dispatch);

    if (process.platform === 'win32') {
      this.socket = `\\\\.\\pipe\\${this.config.socketName}`;
    } else {
      this.socket = `/tmp/${this.config.socketName}.sock`;
    }
    this.ipc_tera = new IpcClient(this.socket, (event, ...args) => {
      switch (event) {
        case 'fetch': {
          for (let i = 0, len = Object.keys(this.GINFO_TYPE).length; i < len; i++) {
            const type = this.GINFO_TYPE[i];
            this.requestGuildInfo(type);
          }
          break;
        }

        case 'chat': {
          const [author, message] = args;
          const msgToTera = this.teraEscape(`<${author}> ${message}`);

          this.sendOrQueue('C_CHAT', 1, {
            channel: 2,
            message: `<FONT>${msgToTera}</FONT>`
          });
          break;
        }

        case 'info': {
          const [message] = args;
          const msgToTera = this.teraEscape(`${message}`);

          this.sendOrQueue('C_CHAT', 1, {
            channel: 2,
            message: `<FONT>* ${msgToTera}</FONT>`
          });
          break;
        }

        default:
          console.warn(`[${U.getTimestamp()}][teraHandler.js] unknown event: `, event);
          break;
      }
    });

    this.init();
  }

  init() {
    // Start guild info refresh interval
    setInterval(() => {
      if (!this.guildId) {
        return;
      }

      for (let i = 0, len = Object.keys(this.GINFO_TYPE).length; i < len; i++) {
        const type = this.GINFO_TYPE[i];
        if (this.lastUpdate[type] && Date.now() - this.lastUpdate[type] > REFRESH_THRESHOLD) {
          this.lastUpdate[type] = Date.now();
          this.requestGuildInfo(type);
        }
      }
    }, REFRESH_TIMER);

    this.teraToDiscordIPC();
  }

  sendOrQueue(...args) {
    if (!this.loaded) {
      this.messageQueue.push(args);
    } else {
      this.dispatch.toServer(...args);
    }
  }

  setLoginStatus(status) {
    this.state.loggedIn = status;
    this.sendToDiscord('stateUpdate', this.state);
  }

  sendToDiscord(event, payload) {
    this.ipc_tera.send(event, payload);
  }

  requestMemberList() {
    this.dispatch.toServer('C_REQUEST_GUILD_MEMBER_LIST', 1);
  }

  requestGuildInfo() {
    const timers = {};

    const doRequest = type => {
      try {
        this.dispatch.toServer('C_REQUEST_GUILD_INFO', 1, {
          guildId: this.guildId,
          type
        });
      } catch (err) {
        console.error(`[${U.getTimestamp()}] Caught error: `, err);
      }
      timers[type] = null;
    };

    return (type, immediate) => {
      if (!immediate) {
        if (!timers[type]) {
          timers[type] = setTimeout(doRequest, 100, type);
        }
      } else {
        if (timers[type]) {
          clearTimeout(timers[type]);
        }
        doRequest(type); // will unset timers[type]
      }
    };
  }

  teraToDiscordIPC() {
    this.dispatch.hook('S_LOGIN', 10, event => {
      this.myName = event.name;
      console.log(`[${U.getTimestamp()}][client] Logged into character: ${this.myName}`);
    });

    this.dispatch.hook('S_CHAT', 2, event => {
      if (event.channel === 2 && event.authorName !== this.myName) {
        this.ipc_tera.send('chat', event.authorName, event.message);
      }
    });

    this.dispatch.hook('S_WHISPER', 2, event => {
      if (event.recipient === this.myName) {
        this.ipc_tera.send('whisper', event.authorName, event.message);
      }
    });

    this.dispatch.hook('S_LOAD_TOPO', 3, event => {
      this.loaded = true;
      if (!this.state.loggedIn) {
        this.setLoginStatus(true);
      }
      while (this.messageQueue.length > 0) {
        this.dispatch.toServer(...this.messageQueue.shift());
      }
    });

    /* Guild notices */

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYLIST_1', params => {
      saveLog('SMT_GC_MSGBOX_APPLYLIST_1', params);

      this.ipc_tera.send('sysmsg', `+ ${params.Name} joined the guild. >`, {
        codeStyle: 'diff',
        logChan: this.config.channels.guildfirewall
      });

      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYRESULT_1', params => {
      saveLog('SMT_GC_MSGBOX_APPLYRESULT_1', params);

      this.ipc_tera.send('sysmsg', `+ ${params.Name1} accepted ${params.Name2} into the guild.`, {
        codeStyle: 'diff',
        logChan: this.config.channels.guildfirewall
      });

      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GUILD_LOG_LEAVE', params => {
      this.ipc_tera.send('sysmsg', `- ${params.UserName} has left the guild.`, {
        codeStyle: 'diff',
        logChan: this.config.channels.guildfirewall
      });

      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GUILD_LOG_BAN', params => {
      this.ipc_tera.send('sysmsg', `- ${params.UserName} was kicked out of the guild.`, {
        codeStyle: 'diff',
        logChan: this.config.channels.guildfirewall
      });

      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GUILD_MEMBER_LOGON', params => {
      this.ipc_tera.send('sysmsg', `<:nya:308670487117037569> \`${params.UserName} logged in. Message: ${params.Comment}\``);
      this.onlineGuildies.push(params.UserName);
      this.ipc_tera.send('members', this.onlineGuildies);
    });

    this.sysmsg.on('SMT_GUILD_MEMBER_LOGON_NO_MESSAGE', params => {
      this.ipc_tera.send('sysmsg', `<:nya:308670487117037569> \`${params.UserName} logged in.\``);
      this.onlineGuildies.push(params.UserName);
      this.ipc_tera.send('members', this.onlineGuildies);
    });

    this.sysmsg.on('SMT_GUILD_MEMBER_LOGOUT', params => {
      this.ipc_tera.send('sysmsg', `<:uguu:424747266017067029> \`${params.UserName} logged out.\``);
      const index = this.onlineGuildies.indexOf(params.UserName);
      if (index !== -1) {
        this.onlineGuildies.splice(index, 1);
      }
      this.ipc_tera.send('members', this.onlineGuildies);
    });

    this.sysmsg.on('SMT_GC_SYSMSG_GUILD_CHIEF_CHANGED', params => {
      this.ipc_tera.send('sysmsg', `= ${params.Name} is now the Guild Master. =`, {
        codeStyle: 'asciidoc'
      });
    });

    this.sysmsg.on('SMT_ACCOMPLISH_ACHIEVEMENT_GRADE_GUILD', params => {
      this.ipc_tera.send('sysmsg', `< ${params.name} earned a ${this.conv(params.grade)}. >`, {
        codeStyle: 'md'
      });
    });

    /* Guild quests */

    this.dispatch.hook('S_UPDATE_GUILD_QUEST_STATUS', 1, event => {
      saveLog('S_UPDATE_GUILD_QUEST_STATUS', event);
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_ACCEPT', params => {
      this.ipc_tera.send('sysmsg', `Received [${this.conv(params.guildQuestName)}]`, {
        codeStyle: 'ini' /* ,
          logChan: this.config.channels.gquests */
      });
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_COMPLETE', params => {
      this.ipc_tera.send('sysmsg', `Completed [${this.conv(params.guildQuestName)}]`, {
        codeStyle: 'ini' /* ,
          logChan: this.config.channels.gquests */
      });
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_CANCEL', params => {
      this.ipc_tera.send('sysmsg', `${params.userName} canceled [${this.conv(params.guildQuestName)}]`, {
        codeStyle: 'ini',
        logChan: this.config.channels.gquests
      });
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_END_NOTICE', params => {
      this.ipc_tera.send('sysmsg', `<@&345648353884897293> < WARNING > A guild quest is ending in 10min`, {
        codeStyle: 'md',
        logChan: this.config.channels.gquests
      });
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_CARRYOUT', params => {
      if (params.targetValue > 25) {
        return;
      } // silence gather quests
      this.ipc_tera.send(
        'sysmsg',
        `${params.userName} advanced [${this.conv(params.guildQuestName)}] (${params.value}/${params.targetValue})`,
        {
          codeStyle: 'ini'
        }
      );
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_FAIL_OVERTIME', params => {
      this.ipc_tera.send('sysmsg', `Failed [${this.conv(params.guildQuestName)}]`, {
        codeStyle: 'asciidoc',
        logChan: this.config.channels.gquests
      });
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_CHANGE_GUILDLEVEL', params => {
      this.ipc_tera.send('sysmsg', `< Guild level is now ${params.GuildLevel}. >`, {
        codeStyle: 'md',
        logChan: this.config.channels.guildannouncements
      });
    });

    this.sysmsg.on('SMT_LEARN_GUILD_SKILL_SUCCESS', params => {
      this.ipc_tera.send('sysmsg', '< The guild has learned a new skill. >', {
        codeStyle: 'md'
      });
    });

    this.sysmsg.on('SMT_GUILD_INCENTIVE_SUCCESS', params => {
      this.ipc_tera.send('sysmsg', '< Guild funds have been delivered via parcel post. >', {
        codeStyle: 'md'
      });
    });

    /* Misc Notices */

    this.sysmsg.on('SMT_MAX_ENCHANT_SUCCEED', params => {
      saveLog('SMT_MAX_ENCHANT_SUCCEED', params);
      if (this.allGuildies.indexOf(params.UserName) !== -1) {
        this.ipc_tera.send(
          'sysmsg',
          `* ${params.UserName} has successfully enchanted (+${params.Added}) < ${this.conv(params.ItemName)} >.`,
          {
            codeStyle: 'md'
          }
        );
      }
    });

    this.sysmsg.on('SMT_GACHA_REWARD', params => {
      if (this.allGuildies.indexOf(params.UserName) !== -1) {
        this.ipc_tera.send(
          'sysmsg',
          `* ${params.UserName} obtained < ${this.conv(params.randomItemName)} > x ${
            params.randomItemCount
          } from <${this.conv(params.gachaItemName)}>.`,
          {
            codeStyle: 'md'
          }
        );
      }
    });

    /* Guild hooks */

    this.dispatch.hook('S_GUILD_QUEST_LIST', 1, event => {
      saveLog('S_GUILD_QUEST_LIST', event);

      if (!_.isEqual(this.guildQuestList, event.quests)) {
        this.guildQuestList = event.quests;

        saveLog('lastQuestList', this.guildQuestList);

        for (let i = 0, len = this.guildQuestList.length; i < len; i++) {
          // Check for rally
          if (this.guildQuestList[i].isRally === 2 || this.guildQuestList[4] === 4) {
            console.log('@@@ Rally found!');
            saveLog('rallyFound', this.guildQuestList[i]);
          } else if (this.guildQuestList[i].isRally === 1) {
            console.log('@@@ isRally value is 1');
          }
        }
      }

      this.lastUpdate[this.GINFO_TYPE.quests] = Date.now();
      const activeQuests = event.quests.filter(quest => quest.status !== 0);
      const currQuests = activeQuests.map(quest => {
        const name = this.conv(quest.name);
        if (quest.targets.length === 1 && name !== 'Crafting Supplies') {
          const [target] = quest.targets;
          return { name, completed: target.completed, total: target.total };
        }
        const targets = quest.targets.map(target => ({
          name: this.conv(`@item:${target.info2}`),
          completed: target.completed,
          total: target.total
        }));
        return { name, targets };
      });

      if (!_.isEqual(this.quests, currQuests)) {
        this.quests = currQuests;
        this.ipc_tera.send('quest', this.quests, event.completedQuests);
      }
    });

    this.dispatch.hook('S_GUILD_INFO', 1, event => {
      try {
        this.lastUpdate[this.GINFO_TYPE.details] = Date.now();

        this.guildId = event.id;

        if (this.motd !== event.motd) {
          this.motd = event.motd;
          this.ipc_tera.send('motd', this.motd);
        }
      } catch (err) {
        console.error(`[${U.getTimestamp()}] Caught error: `, err);
      }
    });

    // This is triggered at least once when the bot comes online. Unsure when else it triggers.
    this.dispatch.hook('S_GUILD_MEMBER_LIST', 1, event => {
      saveLog('S_GUILD_MEMBER_LIST', event);

      this.lastUpdate[this.GINFO_TYPE.members] = Date.now();

      if (event.first) {
        this.currAllGuildies = [];
        this.currOnlineGuildies = [];
      }

      for (let i = 0, len = Object.keys(event.members).length; i < len; i++) {
        const member = event.members[i];
        this.currAllGuildies.push(member.name);
        if (member.status !== 2 && member.name !== this.myName) {
          this.currOnlineGuildies.push(member.name);
        }
      }

      if (event.last && !_.isEqual(this.allGuildies, this.currAllGuildies)) {
        this.allGuildies = this.currAllGuildies;
      }

      if (event.last && !_.isEqual(this.onlineGuildies, this.currOnlineGuildies)) {
        this.onlineGuildies = this.currOnlineGuildies;
        this.ipc_tera.send('members', this.onlineGuildies);
      }
    });
  }

  conv(s) {
    const validString = TeraStrings(s);
    if (!validString) {
      appendString('stringsToAdd', s);
      return '(???)';
    }
    return validString;
  }

  // Tera can't display these without entities!
  escapeHtml(str) {
    const entities = {
      '"': 'quot',
      '&': 'amp',
      '<': 'lt',
      '>': 'gt',
      "'": 'apos',
      '‘': '#8216',
      '’': '#8217'
    };

    return str.replace(/["&<>']/g, e => `&${entities[e]};`);
  }

  teraEscape(str) {
    return this.escapeHtml(str)
      .replace(/w-w/gi, match => match.split('-').join('-&#8206;'))
      .replace(/w{3,}/gi, match => match.split('').join('&#8206;'))
      .replace(/w w w/gi, match => match.split(' ').join('&#8206; '))
      .replace(/\n/g, ' ')
      .replace(/\t/g, '    ')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '?')
      .replace(/[^\x20-\x7E]/g, '?');
  }
}

module.exports = TeraHandler;
