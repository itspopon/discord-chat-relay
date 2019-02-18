const _ = require('lodash');
const IpcClient = require('./ipc/IpcClient.js');
const Sysmsg = require('./sysmsg');
const TeraStrings = require('./tera-strings');
const U = require('./util');
const fs = require('fs');

const dir = `${__dirname}/logs`;
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

// How often to request guild info update from Tera
const REFRESH_THRESHOLD = 60 * 1000;
const REFRESH_TIMER = 15 * 1000;

class TeraHandler {
  constructor(dispatch, config, models) {
    this.dispatch = dispatch;
    this.config = config;
    this.models = models;

    this.oids = {
      guild: config.devMode ? config.db.oids.devGuild : config.db.oids.guild,
    };

    this.GINFO_TYPE = {
      details: 2,
      members: 5,
      quests: 6,
    };

    // auto updates
    this.lastUpdate = {};

    this.state = {
      loggedIn: false,
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
    this.allGuildies = [];
    this.allGuildiesArray = [];
    this.clone = {};
    this.currGuildQuestList = {};
    this.guildQuestList = {};
    this.currentApplicants = new Set();
    this.messageMap = new Map();
    this.sysmsg = new Sysmsg(this.dispatch);

    if (process.platform === 'win32') {
      this.socket = `\\\\.\\pipe\\${this.config.socketName}`;
    } else {
      this.socket = `/tmp/${this.config.socketName}.sock`;
    }
    this.ipc_tera = new IpcClient(this.socket, (event, ...args) => {
      switch (event) {
        case 'fetch': {
          for (
            let i = 0, len = Object.keys(this.GINFO_TYPE).length;
            i < len;
            i++
          ) {
            const type = this.GINFO_TYPE[i];
            this.requestGuildInfo(type);
          }
          break;
        }

        case 'chat': {
          const [author, message] = args;
          const msgToTera = U.teraEscape(`<${author}> ${message}`);

          this.sendOrQueue('C_CHAT', 1, {
            channel: 2,
            message: `<FONT>${msgToTera}</FONT>`,
          });
          break;
        }

        case 'info': {
          const [message] = args;
          const msgToTera = this.teraEscape(`${message}`);

          this.sendOrQueue('C_CHAT', 1, {
            channel: 2,
            message: `<FONT>* ${msgToTera}</FONT>`,
          });
          break;
        }

        default:
          console.warn(
            `[${U.getTimestamp()}][teraHandler.js] unknown event: `,
            event
          );
          this.saveLog(
            `[${U.getTimestamp()}][teraHandler.js] unknown event: `,
            'error'
          );
          this.saveLog(event, 'error');
          break;
      }
    });

    this.init();
  }

  saveGuild(guildData) {
    try {
      this.models.TeraGuild.findByIdAndUpdate(
        this.oids.guild,
        { guildData },
        { upsert: true },
        () => {
          this.saveLog(`Guild log has been successfully saved!`, 'logSuccess');
        }
      );
    } catch (err) {
      console.error(err);
      this.saveLog(err, 'error');
    }
  }

  saveObject(name, data) {
    const Unsorted = new this.models.TeraUnsorted({ name, data });
    Unsorted.save(err => {
      if (err) {
        console.error(err);
        this.saveLog(err, 'error');
      }

      this.saveLog(`${name} log has been successfully saved!`, 'logSuccess');
    });
  }

  saveLog(logline) {
    const logWithTimestamp = `[${U.getDateAndTimestamp()}] ${logline}`;

    try {
      this.models.TeraLogs.findOneAndUpdate(
        { date: U.getDate() },
        { $push: { log: logWithTimestamp } },
        { upsert: true },
        () => console.log(logWithTimestamp)
      );
    } catch (err) {
      console.error(err);
    }
  }

  init() {
    // Start guild info refresh interval
    setInterval(() => {
      if (!this.guildId) {
        return;
      }

      for (let i = 0, len = Object.keys(this.GINFO_TYPE).length; i < len; i++) {
        const type = this.GINFO_TYPE[i];
        if (
          this.lastUpdate[type] &&
          Date.now() - this.lastUpdate[type] > REFRESH_THRESHOLD
        ) {
          this.lastUpdate[type] = Date.now();
          this.requestGuildInfo(type);
        }
      }
    }, REFRESH_TIMER);

    this.teraToDiscordIPC();
  }

  sendOrQueue(...args) {
    if (this.config.devMode) {
      this.saveLog(JSON.stringify(args));
      return;
    }

    if (!this.loaded) {
      this.messageQueue.push(args);
    } else {
      this.dispatch.toServer(...args);
    }
  }

  setLoginStatus(status) {
    this.state.loggedIn = status;
    this.sendToDiscord('botState', this.state);
  }

  sendToDiscord(event, payload) {
    this.ipc_tera.send(event, payload);
  }

  requestMemberList() {
    // TODO: This ain't working xD
    // this.dispatch.toServer('C_REQUEST_GUILD_MEMBER_LIST', 1);
  }

  requestGuildInfo() {
    const timers = {};

    const doRequest = type => {
      try {
        console.log('Requesting guild info.');
        this.dispatch.toServer('C_REQUEST_GUILD_INFO', 1, {
          guildId: this.guildId,
          type,
        });
      } catch (err) {
        console.error(`[${U.getTimestamp()}] Caught error: `, err);
        this.saveLog(`[${U.getTimestamp()}] Caught error: `, 'error');
        this.saveLog(err, 'error');
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
        // will unset timers[type]
        doRequest(type);
      }
    };
  }

  teraToDiscordIPC() {
    this.dispatch.hook('S_LOGIN', 10, event => {
      this.myName = event.name;
      this.saveLog(
        `[${U.getTimestamp()}][client] Logged into character: ${this.myName}`
      );
    });

    this.dispatch.hook('S_ANSWER_INTERACTIVE', 2, event => {
      const className = U.modelToClass(event.model);

      if (this.currentApplicants.has(event.name)) {
        const applicationMsg = this.messageMap.get(event.name);
        this.ipc_tera.send(
          'firewall',
          `${event.name} (Level ${
            event.level
          } ${className}) applied to the guild. Their message: ${applicationMsg}`,
          {
            // A `regular codeblock`
            codeStyle: true,
          }
        );

        this.ipc_tera.send(
          'gamechat',
          `${event.name} (Level ${
            event.level
          } ${className}) applied to the guild. Their message: ${applicationMsg}`,
          {
            // A `regular codeblock`
            codeStyle: true,
          }
        );
      }
    });

    this.dispatch.hook('S_GUILD_APPLY_LIST', 2, event => {
      const newCurrentApplicants = new Set();
      for (
        let i = 0;
        event.apps[i] !== undefined && i < event.apps.length;
        i++
      ) {
        const currentApp = event.apps[i];
        newCurrentApplicants.add(currentApp.name);
        this.messageMap.set(currentApp.name, currentApp.message);
      }
      this.currentApplicants = newCurrentApplicants;
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
      this.saveObject('SMT_GC_MSGBOX_APPLYLIST_1', params);

      this.ipc_tera.send('firewall', `+ ${params.Name} joined the guild.`, {
        codeStyle: 'diff',
      });

      this.ipc_tera.send('gamechat', `+ ${params.Name} joined the guild.`, {
        codeStyle: 'diff',
      });

      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYLIST_2', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYLIST_2', params);

      this.ipc_tera.send(
        'firewall',
        `> ${params.Name}'s guild application was rejected.`,
        {
          codeStyle: 'diff',
        }
      );

      this.ipc_tera.send(
        'gamechat',
        `> ${params.Name}'s guild application was rejected.`,
        {
          codeStyle: 'diff',
        }
      );

      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYRESULT_1', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYRESULT_1', params);

      this.ipc_tera.send(
        'firewall',
        `+ ${params.Name1} accepted ${params.Name2} into the guild.`,
        {
          codeStyle: 'diff',
        }
      );

      this.ipc_tera.send(
        'gamechat',
        `+ ${params.Name1} accepted ${params.Name2} into the guild.`,
        {
          codeStyle: 'diff',
        }
      );

      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYRESULT_2', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYRESULT_2', params);

      this.ipc_tera.send(
        'firewall',
        `> ${params.Name1} rejected ${params.Name2}'s guild application.`,
        {
          codeStyle: 'diff',
        }
      );

      this.ipc_tera.send(
        'gamechat',
        `> ${params.Name1} rejected ${params.Name2}'s guild application.`,
        {
          codeStyle: 'diff',
        }
      );

      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLY_TITLE', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLY_TITLE', params);
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLY_1', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLY_1', params);
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLY_2', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLY_2', params);
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLY_3', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLY_3', params);
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYLIST_TITLE', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYLIST_TITLE', params);
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYRESULT_TITLE', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLY_TITLE', params);
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYRESULT_TITLE', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYRESULT_TITLE', params);
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYRESULT_1', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYRESULT_1', params);
    });

    this.sysmsg.on('SMT_GUILD_LOG_APPLY', params => {
      this.saveObject('SMT_GUILD_LOG_APPLY', params);
    });

    this.sysmsg.on('SMT_GUILD_LOG_LEAVE', params => {
      this.ipc_tera.send(
        'firewall',
        `- ${params.UserName} has left the guild. Please unfriend that person.`,
        {
          codeStyle: 'diff',
        }
      );

      this.ipc_tera.send(
        'gamechat',
        `- ${params.UserName} has left the guild. Please unfriend that person.`,
        {
          codeStyle: 'diff',
        }
      );

      this.logOff(params.UserName);
      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GUILD_LOG_BAN', params => {
      this.ipc_tera.send(
        'firewall',
        `- ${
          params.UserName
        } was kicked out of the guild. Please unfriend that person.`,
        {
          codeStyle: 'diff',
        }
      );

      this.ipc_tera.send(
        'gamechat',
        `- ${
          params.UserName
        } was kicked out of the guild. Please unfriend that person.`,
        {
          codeStyle: 'diff',
        }
      );

      this.logOff(params.UserName);
      this.requestMemberList();
    });

    this.sysmsg.on('SMT_GUILD_MEMBER_LOGON', params => {
      // Login message unescaped so we don't see &lt;3 for <3
      this.ipc_tera.send(
        'gamechat',
        `<:Aw:489893064005910554> \`${
          params.UserName
        } logged in. Message: ${_.unescape(params.Comment)}\``
      );
      this.logOn(params.UserName);
    });

    this.sysmsg.on('SMT_GUILD_MEMBER_LOGON_NO_MESSAGE', params => {
      this.ipc_tera.send(
        'gamechat',
        `<:Aw:489893064005910554> \`${params.UserName} logged in.\``
      );
      this.logOn(params.UserName);
    });

    this.sysmsg.on('SMT_GUILD_MEMBER_LOGOUT', params => {
      this.ipc_tera.send(
        'gamechat',
        `<:Cry:489897676704317450> \`${params.UserName} logged out.\``
      );
      this.logOff(params.UserName);
    });

    this.sysmsg.on('SMT_GC_SYSMSG_GUILD_CHIEF_CHANGED', params => {
      this.ipc_tera.send(
        'gamechat',
        `= ${params.Name} is now the Guild Master. =`,
        {
          codeStyle: 'asciidoc',
        }
      );
    });

    this.sysmsg.on('SMT_ACCOMPLISH_ACHIEVEMENT_GRADE_GUILD', params => {
      this.ipc_tera.send(
        'gamechat',
        `< ${params.name} earned a ${this.conv(params.grade)}. >`,
        {
          codeStyle: 'md',
        }
      );
    });

    /* Guild quests */

    this.dispatch.hook('S_UPDATE_GUILD_QUEST_STATUS', 1, event => {
      this.saveObject('S_UPDATE_GUILD_QUEST_STATUS', event);
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_ACCEPT', params => {
      this.ipc_tera.send(
        'gamechat',
        `Received [${this.conv(params.guildQuestName)}]`,
        {
          codeStyle: 'ini',
        }
      );
      /* this.ipc_tera.send('gquests', `Received [${this.conv(params.guildQuestName)}]`, {
        codeStyle: 'ini'
      }); */
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_COMPLETE', params => {
      this.ipc_tera.send(
        'gamechat',
        `Completed [${this.conv(params.guildQuestName)}]`,
        {
          codeStyle: 'ini',
        }
      );
      /* this.ipc_tera.send('gquests', `Completed [${this.conv(params.guildQuestName)}]`, {
        codeStyle: 'ini'
      }); */
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_CARRYOUT', params => {
      /* if (params.targetValue > 25) {
        return;
      } // silence gather quests */
      this.ipc_tera.send(
        'gamechat',
        `${params.userName} advanced [${this.conv(params.guildQuestName)}] (${
          params.value
        }/${params.targetValue})`,
        {
          codeStyle: 'ini',
        }
      );
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_CANCEL', params => {
      this.ipc_tera.send(
        'gamechat',
        `${params.userName} canceled [${this.conv(params.guildQuestName)}]`,
        {
          codeStyle: 'ini',
        }
      );
      this.ipc_tera.send(
        'gquests',
        `${params.userName} canceled [${this.conv(params.guildQuestName)}]`,
        {
          codeStyle: 'ini',
        }
      );
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_FAIL_OVERTIME', params => {
      this.ipc_tera.send(
        'gamechat',
        `Failed [${this.conv(params.guildQuestName)}]`,
        {
          codeStyle: 'asciidoc',
        }
      );
      this.ipc_tera.send(
        'gquests',
        `Failed [${this.conv(params.guildQuestName)}]`,
        {
          codeStyle: 'asciidoc',
        }
      );
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_END_NOTICE', params => {
      this.ipc_tera.send(
        'gquests',
        `< WARNING > A guild quest is ending in 10min`,
        {
          codeStyle: 'md',
        }
      );
    });

    this.sysmsg.on('SMT_CHANGE_GUILDLEVEL', params => {
      this.ipc_tera.send(
        'announcements',
        `< Guild level is now ${params.GuildLevel}. >`,
        {
          codeStyle: 'md',
        }
      );
    });

    this.sysmsg.on('SMT_LEARN_GUILD_SKILL_SUCCESS', params => {
      this.saveObject('SMT_LEARN_GUILD_SKILL_SUCCESS', params);
      this.ipc_tera.send(
        'announcements',
        '< The guild has learned a new skill. >',
        {
          codeStyle: 'md',
        }
      );
    });

    this.sysmsg.on('SMT_GUILD_INCENTIVE_SUCCESS', params => {
      this.ipc_tera.send(
        'gamechat',
        '< Guild funds have been delivered via parcel post. >',
        {
          codeStyle: 'md',
        }
      );
    });

    // Rally notification

    this.sysmsg.on('SMT_GQUEST_URGENT_NOTIFY', params => {
      const today = new Date().getDay();
      if (today !== 2 && today !== 5) {
        this.ipc_tera.send('guildchat', `BAM spawning soon! Take the gquest!`);
      } else {
        this.ipc_tera.send(
          'guildchat',
          `(PVP) BAM spawning soon! Take the gquest!`
        );
      }
    });

    /* Misc Notices */

    this.sysmsg.on('SMT_MAX_ENCHANT_SUCCEED', params => {
      this.saveObject('SMT_MAX_ENCHANT_SUCCEED', params);
      if (this.allGuildies.indexOf(params.UserName) !== -1) {
        const enchantCount = params.ItemName[params.ItemName.length - 1];
        this.ipc_tera.send(
          'gamechat',
          `* ${
            params.UserName
          } has successfully enchanted (+${enchantCount}) < ${this.conv(
            params.ItemName
          )} >.`,
          {
            codeStyle: 'md',
          }
        );
      }
    });

    this.sysmsg.on('SMT_GACHA_REWARD', params => {
      if (this.allGuildies.indexOf(params.UserName) !== -1) {
        this.ipc_tera.send(
          'gamechat',
          `* ${params.UserName} obtained < ${this.conv(
            params.randomItemName
          )} > x ${params.randomItemCount} from <${this.conv(
            params.gachaItemName
          )}>.`,
          {
            codeStyle: 'md',
          }
        );
      }
    });

    /* Guild hooks */

    this.dispatch.hook('S_GUILD_QUEST_LIST', 1, event => {
      this.saveObject('S_GUILD_QUEST_LIST', event);

      if (!_.isEqual(this.guildQuestList, event.quests)) {
        this.guildQuestList = event.quests;

        this.saveObject('lastQuestList', this.guildQuestList);
      }

      this.lastUpdate[this.GINFO_TYPE.quests] = Date.now();
      const activeQuests = event.quests.filter(quest => quest.status !== 0);
      const currQuests = activeQuests.map(quest => {
        const name = this.conv(quest.name);
        if (quest.targets.length === 1 && name !== 'Crrafting Supplies') {
          const [target] = quest.targets;
          return { name, completed: target.completed, total: target.total };
        }
        const targets = quest.targets.map(target => ({
          name: this.conv(`@item:${target.info2}`),
          completed: target.completed,
          total: target.total,
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
        this.saveLog(`[${U.getTimestamp()}] Caught error: `, 'error');
        this.saveLog(err, 'error');
      }
    });

    // This is triggered at least once when the bot comes online. Unsure when else it triggers.
    this.dispatch.hook('S_GUILD_MEMBER_LIST', 1, event => {
      this.lastUpdate[this.GINFO_TYPE.members] = Date.now();

      if (event.first) {
        this.allGuildiesArray = [];
        this.currAllGuildies = [];
        this.currOnlineGuildies = [];
        this.clone = _.clone(event);
      }

      for (let i = 0, len = Object.keys(event.members).length; i < len; i++) {
        const member = event.members[i];
        this.currAllGuildies.push(member.name);
        this.allGuildiesArray.push(member);
        if (member.status !== 2 && member.name !== this.myName) {
          this.currOnlineGuildies.push(member.name);
        }
      }

      if (event.last && !_.isEqual(this.allGuildies, this.currAllGuildies)) {
        this.allGuildies = this.currAllGuildies;
        this.clone.members = this.allGuildiesArray;
        this.saveObject('S_GUILD_MEMBER_LIST', this.clone);
        this.saveGuild(this.clone);
      }

      if (
        event.last &&
        !_.isEqual(this.onlineGuildies, this.currOnlineGuildies)
      ) {
        this.onlineGuildies = this.currOnlineGuildies;
        this.ipc_tera.send('members', this.onlineGuildies);
      }
    });
  }

  conv(str) {
    const validString = TeraStrings(str);
    if (!validString) {
      this.saveLog(str, 'stringsToAdd');
      return `(${str}: Name not found). Ping @Popon#0788 for help.`;
    }
    return validString;
  }

  logOn(user) {
    this.onlineGuildies.push(user);
    this.ipc_tera.send('members', this.onlineGuildies);
  }

  logOff(user) {
    const index = this.onlineGuildies.indexOf(user);
    if (index !== -1) {
      this.onlineGuildies.splice(index, 1);
    }
    this.ipc_tera.send('members', this.onlineGuildies);
  }
}

module.exports = TeraHandler;
