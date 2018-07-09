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
      quests: [],
      questsCompleted: 0
    };
    this.lastTopic = '';

    this.discordBot.on('ready', () => {
      this.discordBot.user.setActivity('TERA');
      // Main
      this.server = U.getServer(this.discordBot, this.config.serverId);
      this.channel = U.getTextChannel(this.server, this.config.channels.gamechat);
      // Misc
      this.announcementsChannel = U.getTextChannel(this.server, this.config.channels.announcements);
      this.firewallChannel = U.getTextChannel(this.server, this.config.channels.firewall);
      this.gquestsChannel = U.getTextChannel(this.server, this.config.channels.gquests);
      this.guildchatChannel = U.getTextChannel(this.server, this.config.channels.guildchat);
      console.log('--- loading submodules...');
      this.init();
    });

    this.discordBot.on('warn', warn => {
      console.warn(`[${U.getTimestamp()}][discordHandler.js] warning: `, warn);
    });

    this.discordBot.on('disconnect', () => {
      console.log('disconnected');
      this.discordBot.destroy();
      process.exit();
    });

    // If this isn't enough use on('debug', message => {...})
    this.discordBot.on('error', err => {
      console.error(`[${U.getTimestamp()}][discordHandler.js] websocket error: `, err);
    });

    // connect bot to discord
    console.log('connecting...');
    this.discordBot.login(this.config.token).catch(reason => {
      console.error(`[${U.getTimestamp()}][discordHandler.js] failed to login:`, reason);
      this.discordBot.destroy();
      process.exit();
    });
  }

  init() {
    // Warn if main components are disabled
    if (this.server && this.channel) {
      console.log('- loaded %s', 'gamechat');
    } else {
      console.log('* %s is disabled', 'gamechat');
      console.log('*** init failed');
      return;
    }

    // Warn if helpers are disabled
    console.log(this.firewallChannel ? '- loaded %s' : '* %s is disabled', 'firewallChannel');
    console.log(this.announcementsChannel ? '- loaded %s' : '* %s is disabled', 'announcementsChannel');
    console.log(this.gquestsChannel ? '- loaded %s' : '* %s is disabled', 'gquestsChannel');
    console.log(this.guildchatChannel ? '- loaded %s' : '* %s is disabled', 'guildchatChannel');

    // Trigger initial fetch
    this.ipc_discord.send('fetch');

    this.discordIPCToDiscordMsg();
    this.discordMsgToTeraIPC();

    console.log('--- init complete');
  }

  // Send message to discord but only if not in devMode
  dSend(discordChannel, options) {
    if (this.config.devMode) {
      console.log(JSON.stringify(options));
      return;
    }
    console.log(JSON.stringify(options));
    discordChannel.send(...options);
  }

  discordIPCToDiscordMsg() {
    this.ipc_discord.on('chat', (author, message) => {
      // convert TERA HTML to Discord text
      const msg = U.emojify(U.toDiscord(U.unHtml(message), this.server));
      this.dSend(this.channel, [
        `\`[${author}]\`: ${msg}`,
        {
          disableEveryone: true
        }
      ]);
    });

    this.ipc_discord.on('whisper', (author, message) => {
      // convert TERA HTML to Discord text
      const msg = U.emojify(U.toDiscord(U.unHtml(message), this.server));
      this.dSend(this.channel, [
        `[Received Whisper][${author}]: ${msg}`,
        {
          disableEveryone: true
        }
      ]);
    });

    this.ipc_discord.on('motd', motd => {
      this.guild.motd = motd;
      this.updateTopic();
    });

    // Online members
    this.ipc_discord.on('members', members => {
      members.sort((a, b) => a.localeCompare(b));
      this.guild.members = members;
      this.updateTopic();
    });

    this.ipc_discord.on('quest', (quests, numCompleted) => {
      // Add progress to quests
      this.guild.questsCompleted = numCompleted;
      this.guild.quests = quests.map(quest => {
        let progress;

        // If quest is more than a single event(?). I.e. has progress-tracking-capability(?)
        if (quest.targets) {
          const targets = quest.targets.map(target => `${target.name}: ${target.completed}/${target.total}`);
          progress = targets.join(', ');
        } else {
          progress = `${quest.completed}/${quest.total}`;
        }

        return { name: quest.name, progress };
      });
      this.updateTopic();
    });

    this.ipc_discord.on('botState', state => {
      if (state.loggedIn) {
        this.setChannelWritePerms(null);
        this.dSend(this.channel, [
          '< H.T.T chat bot is now online >',
          {
            code: 'md'
          }
        ]);
      } else {
        this.setChannelWritePerms(false);
        this.dSend(this.channel, [
          '< H.T.T chat bot is now offline >',
          {
            code: 'md'
          }
        ]);
      }
    });

    this.ipc_discord.on('firewall', (msg, options = { codeStyle: undefined }) => {
      const { codeStyle } = options;
      this.dSend(this.firewallChannel, [
        msg,
        {
          code: codeStyle,
          disableEveryone: true
        }
      ]);
    });

    this.ipc_discord.on('gamechat', (msg, options = { codeStyle: undefined }) => {
      const { codeStyle } = options;
      this.dSend(this.channel, [
        msg,
        {
          code: codeStyle,
          disableEveryone: true
        }
      ]);
    });

    this.ipc_discord.on('guildchat', (msg, options = { codeStyle: undefined }) => {
      const { codeStyle } = options;
      this.dSend(this.guildchatChannel, [
        msg,
        {
          code: codeStyle,
          disableEveryone: true
        }
      ]);
    });

    this.ipc_discord.on('announcements', (msg, options = { codeStyle: undefined }) => {
      const { codeStyle } = options;
      this.dSend(this.announcementsChannel, [
        msg,
        {
          code: codeStyle,
          disableEveryone: true
        }
      ]);
    });

    this.ipc_discord.on('gquests', (msg, options = { codeStyle: undefined }) => {
      const { codeStyle } = options;
      this.dSend(this.gquestsChannel, [
        msg,
        {
          code: codeStyle,
          disableEveryone: true
        }
      ]);
    });
  }

  discordMsgToTeraIPC() {
    this.discordBot.on('message', message => {
      // Discord commands in any channel would go here

      if (message.channel.id !== this.channel.id || message.author.id === this.discordBot.user.id) {
        return;
      }

      // Discord commands only in gamechat channel
      switch (message.content) {
        case '.gc topic':
        case '.gtopic':
          this.dSend(this.channel, [this.channel.topic]);
          break;
        case '.gc info':
        case '.ginfo':
          this.dSend(this.channel, [
            {
              embed: {
                title: 'GUILD INFO',
                description: `\`\`\`md\n< MOTD >\n\n# ${this.guild.motd}\n\n< ONLINE >\n\n${this.guild.members.reduce(
                  (allMembers, member) => `${allMembers}* ${member}\n`,
                  ''
                )}\`\`\``,
                url: 'https://discordapp.com',
                color: 10627677,
                timestamp: new Date(Date.now()).toISOString(),
                image: {
                  url: 'https://cdn.discordapp.com/icons/265232682126934016/a55c5d3ebc01b5caf609d2a31b2fd18c.webp'
                }
              }
            }
          ]);
          break;
        default:
          break;
      }

      // Send to Tera
      const author = U.getName(this.server, message.author);

      if (message.type === 'PINS_ADD') {
        this.ipc_discord.send('info', `${author} pinned a message.`);
      } else {
        const str = U.unemojify(U.fromDiscord(message.content, this.server));
        const uploads = message.attachments.map(attachment => attachment.url);
        if (uploads.length) {
          if (str) {
            this.ipc_discord.send('chat', author, `${str} [uploaded: ${uploads.join(', ')}]`);
          } else {
            this.ipc_discord.send('info', `${author} uploaded: ${uploads.join(', ')}`);
          }
        } else {
          this.ipc_discord.send('chat', author, str);
        }
      }
    });
  }

  setChannelWritePerms(canSendMsgs) {
    if (this.config.devMode) return;

    this.channel
      .overwritePermissions(this.config.roles.muteWhenOffline, {
        SEND_MESSAGES: canSendMsgs
      })
      .catch(console.error);
  }

  updateTopic() {
    const parts = [];

    // member list
    const online = this.guild.members.length > 0 ? this.guild.members.join(', ') : '(Nobody)';
    parts.push(`< Online: ${online} >`);

    // guild quest
    /* if (this.guild.quests.length > 0) {
      parts.push(`< Quests (${this.guild.questsCompleted}/5): ${this.guild.quests.map(quest => `${quest.name} [${quest.progress}] `)} >`);
    }
 */
    // motd
    if (this.guild.motd.length > 0) {
      parts.push(`< MotD: ${U.emojify(U.unHtml(this.guild.motd))} >`);
    }

    parts.push(`< Last updated: ${U.getTimestamp()} >`);

    // update
    const topic = parts.join(' \n\n');
    if (topic !== this.lastTopic) {
      this.lastTopic = topic;
      if (!this.config.devMode) {
        this.channel.setTopic(topic);
      }
    }
  }
}

module.exports = DiscordHandler;
