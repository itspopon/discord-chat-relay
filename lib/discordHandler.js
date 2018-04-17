const Discord = require('discord.js');
const IpcServerModule = require('./ipc/IpcServer.js');
const U = require('./util');

class DiscordHandler {
  constructor(dispatch, config) {
    this.dispatch = dispatch;
    this.config = config;
    this.discordBot = new Discord.Client({
      fetchAllMembers: true,
      sync: true
    });
    this.ipc_discord = new IpcServerModule(this.config.socketName);
    this.guild = {
      motd: '',
      members: [],
      quest: []
    };
    this.lastTopic = '';

    this.discordBot.on('ready', () => {
      this.discordBot.user.setActivity('TERA');

      this.server = U.getServer(this.discordBot, this.config.serverId);
      this.channel = U.getTextChannel(this.server, this.config.channels.gchat);
      this.gquestChannel = U.getTextChannel(
        this.server,
        this.config.channels.gquests
      );
      this.gquestRemindersChannel = U.getTextChannel(
        this.server,
        this.config.channels.gquestReminders
      );

      console.log('loading submodules...');
      this.initGchatModule();
    });

    this.discordBot.on('warn', warn => {
      console.warn(warn);
    });

    this.discordBot.on('disconnect', () => {
      console.log('disconnected');
      this.discordBot.destroy();
      process.exit();
    });

    // connect bot to discord
    console.log('connecting...');
    this.discordBot.login(this.config.token).catch(reason => {
      console.error('failed to login:', reason);
      this.discordBot.destroy();
      process.exit();
    });
  }

  initGchatModule() {
    // Warn if main components are disabled
    if (!this.server || !this.channel) {
      console.warn('* gchat module is disabled');
      return;
    }
    // Warn if helpers are disabled
    if (!this.gquestChannel) {
      console.warn('* gquest logging channel disabled');
    }
    if (!this.gquestRemindersChannel) {
      console.warn('* gquest reminder channel disabled');
    }
    console.log(`routing gchat to #${this.channel.name} (${this.channel.id})`);

    // Trigger initial fetch for
    this.ipc_discord.send('fetch');

    this.discordIPCToDiscordMsg();
    this.discordMsgToTeraIPC();

    console.log('- loaded %s', 'gchat');
  }

  discordIPCToDiscordMsg() {
    this.ipc_discord.on('chat', (author, message) => {
      // convert TERA HTML to Discord text
      message = U.emojify(U.toDiscord(U.unHtml(message), this.server));
      this.channel.send(`\`[${author}]\`: ${message}`);
    });

    this.ipc_discord.on('whisper', (author, message) => {
      // convert TERA HTML to Discord text
      message = U.emojify(U.toDiscord(U.unHtml(message), this.server));
      this.channel.send(`[Received Whisper][${author}]: ${message}`);
    });

    this.ipc_discord.on('motd', motd => {
      this.guild.motd = motd;
      this.updateTopic();
    });

    this.ipc_discord.on('members', members => {
      members.sort((a, b) => a.localeCompare(b));
      this.guild.members = members;
      this.updateTopic();
    });

    this.ipc_discord.on('quest', quest => {
      this.guild.quest = quest;
      this.updateTopic();
    });

    this.ipc_discord.on('sysmsg', message => {
      // don't convert mentions; highlights from TERA login message are abusable
      this.channel.send(message, {
        disable_everyone: true
      });
    });

    this.ipc_discord.on('stateUpdate', state => {
      if (state.loggedIn) {
        this.enableReadPerms();
        this.sendMsgToDiscord(
          `\`\`\`md\n< H.T.T chat bot is now online >\n\`\`\``
        );
      } else {
        this.disableReadPerms();
        this.sendMsgToDiscord(
          `\`\`\`md\n< H.T.T chat bot is now offline >\n\`\`\``
        );
      }
    });

    this.ipc_discord.on(
      'sysmsg_gquestaccepted',
      (message, gquestMsg, nadekoAliasMsg) => {
        this.channel.send(message);
        this.gquestChannel.send(gquestMsg);
        this.gquestRemindersChannel.send(nadekoAliasMsg);
      }
    );

    this.ipc_discord.on('sysmsg_gquestcomplete', message => {
      this.channel.send(message);
      this.gquestChannel.send(message);
    });
  }

  discordMsgToTeraIPC() {
    this.discordBot.on('message', message => {
      if (message.channel.id !== this.channel.id) return;
      if (message.author.id === this.discordBot.user.id) return;

      const author = U.getName(this.server, message.author);

      if (message.type === 'PINS_ADD') {
        this.ipc_discord.send('info', `${author} pinned a message.`);
      } else {
        const str = U.unemojify(U.fromDiscord(message.content, this.server));
        const uploads = message.attachments.map(attachment => attachment.url);
        if (uploads.length) {
          if (str) {
            this.ipc_discord.send(
              'chat',
              author,
              `${str} [uploaded: ${uploads.join(', ')}]`
            );
          } else {
            this.ipc_discord.send(
              'info',
              `${author} uploaded: ${uploads.join(', ')}`
            );
          }
        } else {
          this.ipc_discord.send('chat', author, str);
        }
      }
    });
  }

  enableReadPerms() {
    this.channel
      .overwritePermissions(this.config.roles.muteWhenOffline, {
        SEND_MESSAGES: true
      })
      .catch(console.error);
  }

  disableReadPerms() {
    this.channel
      .overwritePermissions(this.config.roles.muteWhenOffline, {
        SEND_MESSAGES: false
      })
      .catch(console.error);
  }

  sendMsgToDiscord(msg) {
    this.channel.send(msg, {
      disable_everyone: true
    });
  }

  updateTopic() {
    const parts = [];

    // member list
    const online =
      this.guild.members.length > 0
        ? this.guild.members.join(', ')
        : '(Nobody)';
    parts.push('Online: ' + online);

    // guild quest
    if (this.guild.quest.length > 0) {
      const quests = this.guild.quest.map(quest => {
        let progress;

        if (quest.targets) {
          const targets = quest.targets.map(
            target => `${target.name}: ${target.completed}/${target.total}`
          );
          progress = targets.join(', ');
        } else {
          progress = `${quest.completed}/${quest.total}`;
        }

        return `${quest.name} [${progress}]`;
      });

      parts.push('Quests: ' + quests.join(', '));
    }

    // motd
    if (this.guild.motd.length > 0) {
      parts.push('MotD: ' + U.emojify(U.unHtml(this.guild.motd)));
    }

    // update
    const topic = parts.join(' // ');
    if (topic !== this.lastTopic) {
      this.channel.setTopic(topic);
      this.lastTopic = topic;
    }
  }
}

module.exports = DiscordHandler;
