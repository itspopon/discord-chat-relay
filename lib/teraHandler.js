const _ = require('underscore');
const IpcClient = require('./ipc/IpcClient.js');
const Sysmsg = require('./sysmsg');
const TeraStrings = require('./tera-strings');

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
          this.sendOrQueue('C_CHAT', 1, {
            channel: 2,
            message: `<FONT>${_.escape(`<${author}> ${message}`)}</FONT>`
          });
          break;
        }

        case 'info': {
          const [message] = args;
          this.sendOrQueue('C_CHAT', 1, {
            channel: 2,
            message: `<FONT>* ${_.escape(message)}</FONT>`
          });
          break;
        }

        default:
          console.warn('[teraHandler.js] unknown event: ', event);
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

  requestGuildInfo() {
    const timers = {};

    const doRequest = type => {
      this.dispatch.toServer('C_REQUEST_GUILD_INFO', 1, {
        guildId: this.guildId,
        type
      });
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
      console.log(`[client] Logged into character: ${this.myName}`);
    });

    this.dispatch.hook('S_CHAT', 2, event => {
      if (event.channel === 2 && event.authorName !== this.myName) {
        this.ipc_tera.send('chat', event.authorName, event.message);
      } else if (
        ![
          0,
          1,
          2,
          3,
          4,
          9,
          11,
          12,
          13,
          14,
          15,
          16,
          17,
          18,
          21,
          26,
          27,
          32,
          212,
          214
        ].includes(event.channel)
      ) {
        // @@@
        console.log(
          '[teraHandler.js] Channel: {',
          event.channel,
          '} | Author: {',
          event.authorName,
          '} | Message: ',
          event.message
        );
      }
    });

    this.dispatch.hook('S_WHISPER', 2, event => {
      if (event.recipient === this.myName) {
        this.ipc_tera.send('whisper', event.authorName, event.message);
      }
    });

    this.dispatch.hook('S_LOAD_TOPO', 3, event => {
      this.loaded = true;
      while (this.messageQueue.length > 0) {
        this.dispatch.toServer(...this.messageQueue.shift());
      }
    });

    /* Guild notices */

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYLIST_1', params => {
      this.ipc_tera.send('sysmsg', `< ${params.Name} joined the guild. >`, {
        codeStyle: 'md'
      });
      this.requestGuildInfo(this.GINFO_TYPE.members);
    });

    this.sysmsg.on('SMT_GC_MSGBOX_APPLYRESULT_1', params => {
      this.ipc_tera.send(
        'sysmsg',
        `# ${params.Name1} accepted ${params.Name2} into the guild.`,
        {
          codeStyle: 'md'
        }
      );
      this.requestGuildInfo(this.GINFO_TYPE.members);
    });

    this.sysmsg.on('SMT_GUILD_LOG_LEAVE', params => {
      this.ipc_tera.send('sysmsg', `# ${params.UserName} has left the guild.`, {
        codeStyle: 'cs'
      });
      this.requestGuildInfo(this.GINFO_TYPE.members);
    });

    this.sysmsg.on('SMT_GUILD_LOG_BAN', params => {
      this.ipc_tera.send(
        'sysmsg',
        `# ${params.UserName} was kicked out of the guild.`,
        {
          codeStyle: 'cs'
        }
      );
      this.requestGuildInfo(this.GINFO_TYPE.members);
    });

    this.sysmsg.on('SMT_GUILD_MEMBER_LOGON', params => {
      this.ipc_tera.send(
        'sysmsg',
        `<:nya:308670487117037569> \`${params.UserName} logged in. Message: ${
          params.Comment
        }\``
      );
      this.requestGuildInfo(this.GINFO_TYPE.members);
    });

    this.sysmsg.on('SMT_GUILD_MEMBER_LOGON_NO_MESSAGE', params => {
      this.ipc_tera.send(
        'sysmsg',
        `<:nya:308670487117037569> \`${params.UserName} logged in.\``
      );
      this.requestGuildInfo(this.GINFO_TYPE.members);
    });

    this.sysmsg.on('SMT_GUILD_MEMBER_LOGOUT', params => {
      this.ipc_tera.send(
        'sysmsg',
        `<:uguu:424747266017067029> \`${params.UserName} logged out.\``
      );
      this.requestGuildInfo(this.GINFO_TYPE.members);
    });

    this.sysmsg.on('SMT_GC_SYSMSG_GUILD_CHIEF_CHANGED', params => {
      this.ipc_tera.send(
        'sysmsg',
        `= ${params.Name} is now the Guild Master. =`,
        {
          codeStyle: 'asciidoc'
        }
      );
    });

    this.sysmsg.on('SMT_ACCOMPLISH_ACHIEVEMENT_GRADE_GUILD', params => {
      this.ipc_tera.send(
        'sysmsg',
        `< ${params.name} earned a ${this.conv(params.grade)}. >`,
        {
          codeStyle: 'md'
        }
      );
    });

    /* Guild quests */

    this.dispatch.hook('S_UPDATE_GUILD_QUEST_STATUS', 1, event => {
      // @@@
      console.log('[teraHandler.js] Gquest status update. Event: ', event);
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_QUEST_COUNT_MAX', params => {
      // @@@
      console.log('[teraHandler.js] SMT_QUEST_COUNT_MAX params: ', params);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_ACCEPT', params => {
      // @@@
      console.log('[teraHandler.js] SMT_GQUEST_NORMAL_ACCEPT params: ', params);
      this.ipc_tera.send(
        'sysmsg',
        `Received [${this.conv(params.guildQuestName)}].`,
        {
          codeStyle: 'ini',
          logChan: this.config.channels.gquests
        }
      );
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_COMPLETE', params => {
      // @@@
      console.log(
        '[teraHandler.js] SMT_GQUEST_NORMAL_COMPLETE params: ',
        params
      );
      this.ipc_tera.send(
        'sysmsg',
        `Completed [${this.conv(params.guildQuestName)}].`,
        {
          codeStyle: 'ini',
          logChan: this.config.channels.gquests
        }
      );
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_CANCEL', params => {
      this.ipc_tera.send(
        'sysmsg',
        `${params.userName} canceled [${this.conv(params.guildQuestName)}].`,
        {
          codeStyle: 'ini',
          logChan: this.config.channels.gquests
        }
      );
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    // TODO:
    this.sysmsg.on('SMT_GQUEST_NORMAL_FAIL_OVERTIME', params => {
      this.ipc_tera.send(
        'sysmsg',
        `Failed [${this.conv(params.guildQuestName)}].`,
        {
          codeStyle: 'ini',
          logChan: this.config.channels.gquests
        }
      ); // ?
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    // TODO:
    this.sysmsg.on('SMT_GQUEST_NORMAL_END_NOTICE', params => {
      this.ipc_tera.send('sysmsg', 'A guild quest is ending in 10min.', {
        logChan: this.config.channels.gquests
      }); // ?
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    this.sysmsg.on('SMT_GQUEST_NORMAL_CARRYOUT', params => {
      if (params.targetValue > 25) {
        return;
      } // silence gather quests
      this.ipc_tera.send(
        'sysmsg',
        `${params.userName} advanced [${this.conv(params.guildQuestName)}]. (${
          params.value
        }/${params.targetValue})`,
        {
          codeStyle: 'ini'
        }
      );
    });

    this.sysmsg.on('SMT_CHANGE_GUILDLEVEL', params => {
      this.ipc_tera.send(
        'sysmsg',
        `< Guild level is now ${params.GuildLevel}. >`,
        {
          codeStyle: 'md',
          logChan: this.config.channels.guildannouncements
        }
      );
    });

    this.sysmsg.on('SMT_LEARN_GUILD_SKILL_SUCCESS', params => {
      this.ipc_tera.send('sysmsg', '< The guild has learned a new skill. >', {
        codeStyle: 'md'
      });
    });

    this.sysmsg.on('SMT_GUILD_INCENTIVE_SUCCESS', params => {
      this.ipc_tera.send(
        'sysmsg',
        '< Guild funds have been delivered via parcel post. >',
        {
          codeStyle: 'md'
        }
      );
    });

    /* Misc Notices */

    this.sysmsg.on('SMT_MAX_ENCHANT_SUCCEED', params => {
      if (this.allGuildies.indexOf(params.UserName) !== -1) {
        this.ipc_tera.send(
          'sysmsg',
          `* ${_.escapeHtml(
            `${params.UserName} has successfully enchanted (+${
              params.Added
            }) < ${this.conv(params.ItemName)} >.`
          )}`,
          'md'
        );
      }
    });

    this.sysmsg.on('SMT_GACHA_REWARD', params => {
      if (this.allGuildies.indexOf(params.UserName) !== -1) {
        this.ipc_tera.send(
          'sysmsg',
          `* ${_.escapeHtml(
            `* ${params.UserName} obtained < ${this.conv(
              params.randomItemName
            )} > x ${params.randomItemCount} from <${this.conv(
              params.gachaItemName
            )}>.`
          )}`,
          'md'
        );
      }
    });

    /* Guild hooks */

    this.dispatch.hook('S_GUILD_QUEST_LIST', 1, event => {
      // @@@
      console.log(
        '[teraHandler.js] Completed Quests: (',
        event.completedQuests,
        '/',
        event.maxQuests,
        ')'
      );
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
        this.ipc_tera.send('quest', this.quests, this.event.completedQuests);
      }
    });

    this.dispatch.hook('S_GUILD_INFO', 1, event => {
      this.lastUpdate[this.GINFO_TYPE.details] = Date.now();

      this.guildId = event.id;

      if (this.motd !== event.motd) {
        this.motd = event.motd;
        this.ipc_tera.send('motd', this.motd);
      }
    });

    this.dispatch.hook('S_GUILD_MEMBER_LIST', 1, event => {
      this.lastUpdate[this.GINFO_TYPE.members] = Date.now();

      if (!this.state.loggedIn) {
        this.setLoginStatus(true);
      }

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

      if (
        event.last &&
        !_.isEqual(this.onlineGuildies, this.currOnlineGuildies)
      ) {
        this.onlineGuildies = this.currOnlineGuildies;
        this.ipc_tera.send('members', this.onlineGuildies);
      }
    });
  }

  conv(s) {
    return TeraStrings(s) || '(???)';
  }
}

module.exports = TeraHandler;
