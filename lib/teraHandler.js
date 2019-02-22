const _ = require('lodash');

const Sysmsg = require('./sysmsg');
const TeraStrings = require('./tera-strings');
const U = require('./util');
const logger = require('./util/logger');

// How often to request guild info update from Tera
const REFRESH_THRESHOLD = 60 * 1000;
const REFRESH_TIMER = 15 * 1000;

class TeraHandler {
  constructor(dispatch, config, models, event) {
    this.dispatch = dispatch;
    this.config = config;
    this.models = models;
    this.event = event;

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

    /* Discord <-> Tera Events */

    this.event.on('fetch', data => {
      for (let i = 0, len = Object.keys(this.GINFO_TYPE).length; i < len; i++) {
        const type = this.GINFO_TYPE[i];
        this.requestGuildInfo(type);
      }
    });

    this.event.on('discordchat', data => {
      const { author, message } = data;
      const msgToTera = U.teraEscape(`<${author}> ${message}`);

      this.sendOrQueue('C_CHAT', 1, {
        channel: 2,
        message: `<FONT>${msgToTera}</FONT>`,
      });
    });

    this.event.on('discordinfo', data => {
      const { message } = data;
      const msgToTera = U.teraEscape(`${message}`);

      this.sendOrQueue('C_CHAT', 1, {
        channel: 2,
        message: `<FONT>* ${msgToTera}</FONT>`,
      });
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
          logger(`Guild log has been successfully saved!`);
        }
      );
    } catch (err) {
      console.error(err);
      logger('Error: ' + err.message);
    }
  }

  saveObject(name, data) {
    const Unsorted = new this.models.TeraUnsorted({ name, data });
    Unsorted.save(err => {
      if (err) {
        console.error(err);
        logger('Error: ' + err.message);
      }

      logger(`${name} log has been successfully saved!`);
    });
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

    this.teraToDiscordEvents();
  }

  sendOrQueue(...args) {
    if (this.config.devMode) {
      logger(JSON.stringify(args));
      return;
    }

    if (!this.loaded) {
      this.messageQueue.push(args);
    } else {
      this.dispatch.toServer(...args);
    }
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
        logger(`[${U.getTimestamp()}] Caught error: `);
        logger('Error: ' + err.message);
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

  teraToDiscordEvents() {
    // When the relay character logs in
    this.dispatch.hook('S_LOGIN', 10, event => {
      this.myName = event.name;
      logger(
        `[${U.getTimestamp()}][client] Logged into character: ${this.myName}`
      );
    });

    // On new application
    this.dispatch.hook('S_ANSWER_INTERACTIVE', 2, event => {
      const className = U.modelToClass(event.model);

      if (this.currentApplicants.has(event.name)) {
        const applicationMsg = this.messageMap.get(event.name);

        this.event.send('apply', {
          name: event.name,
          level: event.level,
          className,
          applicationMsg,
        });
      }
    });

    // On guild application list
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

    // On guild chat
    this.dispatch.hook('S_CHAT', 2, event => {
      if (event.channel === 2 && event.authorName !== this.myName) {
        this.event.send('terachat', {
          name: event.authorName,
          message: event.message,
        });
      }
    });

    // On whisper
    this.dispatch.hook('S_WHISPER', 2, event => {
      if (event.recipient === this.myName) {
        this.event.send('terawhisper', {
          name: event.authorName,
          message: event.message,
        });
      }
    });

    // When character is loaded in the game
    this.dispatch.hook('S_LOAD_TOPO', 3, event => {
      this.loaded = true;
      if (!this.state.loggedIn) {
        this.state.loggedIn = true;
        this.event.send('botstate', { state: this.state.loggedIn });
      }
      while (this.messageQueue.length > 0) {
        this.dispatch.toServer(...this.messageQueue.shift());
      }
    });

    /* Guild notices */

    // Someone joined the guild
    this.sysmsg.on('SMT_GC_MSGBOX_APPLYLIST_1', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYLIST_1', params);

      this.event.send('joinedguild', { name: params.Name });

      this.requestMemberList();
    });

    // An application was rejected
    this.sysmsg.on('SMT_GC_MSGBOX_APPLYLIST_2', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYLIST_2', params);

      this.event.send('applyrejected', { name: params.Name });

      this.requestMemberList();
    });

    // An application was accepted
    this.sysmsg.on('SMT_GC_MSGBOX_APPLYRESULT_1', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYRESULT_1', params);

      this.event.send('applyaccepted', {
        guildie: params.Name1,
        newMember: params.Name2,
      });

      this.requestMemberList();
    });

    // An application was accepted by someone in the guild
    /* Redundant but I'll leave it here anyway
      this.sysmsg.on('SMT_GC_MSGBOX_APPLYRESULT_2', params => {
      this.saveObject('SMT_GC_MSGBOX_APPLYRESULT_2', params);

      this.event.send('applyrejected2', { guildie: params.Name1, reject: params.Name2 });

      this.requestMemberList();
    }); */

    // These are just logs
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

    // Someone left the guild
    this.sysmsg.on('SMT_GUILD_LOG_LEAVE', params => {
      this.event.send('leftguild', { name: params.UserName });

      this.logOff(params.UserName);
      this.requestMemberList();
    });

    // Someone got kicked from the guild
    this.sysmsg.on('SMT_GUILD_LOG_BAN', params => {
      this.event.send('kicked', { name: params.UserName });

      this.logOff(params.UserName);
      this.requestMemberList();
    });

    // Someone logged in (with message)
    this.sysmsg.on('SMT_GUILD_MEMBER_LOGON', params => {
      this.event.send('login', {
        name: params.UserName,
        message: params.Comment,
      });

      this.logOn(params.UserName);
    });

    // Someone logged in (no message)
    this.sysmsg.on('SMT_GUILD_MEMBER_LOGON_NO_MESSAGE', params => {
      this.event.send('login', { name: params.UserName });

      this.logOn(params.UserName);
    });

    // Someone logged out
    this.sysmsg.on('SMT_GUILD_MEMBER_LOGOUT', params => {
      this.event.send('logout', { name: params.UserName });

      this.logOff(params.UserName);
    });

    // The guild master has changed
    this.sysmsg.on('SMT_GC_SYSMSG_GUILD_CHIEF_CHANGED', params => {
      this.event.send('gmchanged', { name: params.Name });
    });

    // Someone achieved a laurel
    this.sysmsg.on('SMT_ACCOMPLISH_ACHIEVEMENT_GRADE_GUILD', params => {
      this.event.send('laurel', { name: params.name, laurel: params.grade });
    });

    /* Announcements */
    // Guild level up
    this.sysmsg.on('SMT_CHANGE_GUILDLEVEL', params => {
      this.saveObject('SMT_CHANGE_GUILDLEVEL', params);
      this.event.send('guildlevel', { level: params.GuildLevel });
    });

    // Guild learned a new skill
    this.sysmsg.on('SMT_LEARN_GUILD_SKILL_SUCCESS', params => {
      this.saveObject('SMT_LEARN_GUILD_SKILL_SUCCESS', params);
      this.event.send('guildlevel', {});
    });

    /* Guild quests */
    // Update guild quests
    this.dispatch.hook('S_UPDATE_GUILD_QUEST_STATUS', 1, event => {
      this.saveObject('S_UPDATE_GUILD_QUEST_STATUS', event);
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    // Accept a quest
    this.sysmsg.on('SMT_GQUEST_NORMAL_ACCEPT', params => {
      this.event.send('acceptquest', {
        quest: this.conv(params.guildQuestName),
      });
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    // Completed a quest
    this.sysmsg.on('SMT_GQUEST_NORMAL_COMPLETE', params => {
      this.event.send('completequest', {
        quest: this.conv(params.guildQuestName),
      });
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    // Advance a quest
    this.sysmsg.on('SMT_GQUEST_NORMAL_CARRYOUT', params => {
      this.event.send('advancequest', {
        quest: this.conv(params.guildQuestName),
        name: params.userName,
        value: params.value,
        target: params.targetValue,
      });
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    // Cancel a quest
    this.sysmsg.on('SMT_GQUEST_NORMAL_CANCEL', params => {
      this.event.send('cancelquest', {
        name: params.userName,
        quest: this.conv(params.guildQuestName),
      });
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    // Fail a quest
    this.sysmsg.on('SMT_GQUEST_NORMAL_FAIL_OVERTIME', params => {
      this.event.send('failquest', {
        quest: this.conv(params.guildQuestName),
      });
      this.requestGuildInfo(this.GINFO_TYPE.quests);
    });

    // Ending quest
    this.sysmsg.on('SMT_GQUEST_NORMAL_END_NOTICE', params => {
      this.event.send('endingquest', {});
    });

    // Guild funds
    this.sysmsg.on('SMT_GUILD_INCENTIVE_SUCCESS', params => {
      this.event.send('guildfunds', {});
    });

    // Rally
    this.dispatch.hook('S_NOTIFY_GUILD_QUEST_URGENT', 1, event => {
      const today = new Date().getDay();
      const data = {};
      if (today !== 2 && today !== 5) {
        data.pvp = false;
      } else {
        data.pvp = true;
      }
      data.type = event.type;
      this.event.send('rally', data);
    });

    /* Misc Notices */

    // Guildie sucessful enchant
    this.sysmsg.on('SMT_MAX_ENCHANT_SUCCEED', params => {
      this.saveObject('SMT_MAX_ENCHANT_SUCCEED', params);
      if (this.allGuildies.indexOf(params.UserName) !== -1) {
        const enchantCount = params.ItemName[params.ItemName.length - 1];
        this.event.send('enchant', {
          name: params.UserName,
          item: this.conv(params.ItemName),
          level: enchantCount,
        });
      }
    });

    // Guildie won item from lootbox
    this.sysmsg.on('SMT_GACHA_REWARD', params => {
      if (this.allGuildies.indexOf(params.UserName) !== -1) {
        this.event.send('lootbox', {
          name: params.UserName,
          item: params.randomItemName,
          count: params.randomItemCount,
          box: params.gachaItemName,
        });
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
        this.event.send('updatequests', {
          quests: this.quests,
          numCompleted: event.completedQuests,
        });
      }
    });

    this.dispatch.hook('S_GUILD_INFO', 1, event => {
      try {
        this.lastUpdate[this.GINFO_TYPE.details] = Date.now();

        this.guildId = event.id;

        if (this.motd !== event.motd) {
          this.motd = event.motd;
          this.event.send('motd', { motd: this.motd });
        }
      } catch (err) {
        console.error(`[${U.getTimestamp()}] Caught error: `, err);
        logger(`[${U.getTimestamp()}] Caught error: `);
        logger('Error: ' + err.message);
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
        this.event.send('members', { members: this.onlineGuildies });
      }
    });
  }

  conv(str) {
    const validString = TeraStrings(str);
    if (!validString) {
      logger(`New string to add: ${str}`);
      return `(${str}: Name not found). Ping @Popon#0788 for help.`;
    }
    return validString;
  }

  logOn(user) {
    this.onlineGuildies.push(user);
    this.event.send('members', { members: this.onlineGuildies });
  }

  logOff(user) {
    const index = this.onlineGuildies.indexOf(user);
    if (index !== -1) {
      this.onlineGuildies.splice(index, 1);
    }
    this.event.send('members', { members: this.onlineGuildies });
  }
}

module.exports = TeraHandler;
