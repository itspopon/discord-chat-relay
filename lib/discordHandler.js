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

      this.server = U.getServer(this.discordBot, this.config.serverId);
      this.channel = U.getTextChannel(this.server, this.config.channels.gchat);
      this.gquestChannel = U.getTextChannel(
        this.server,
        this.config.channels.gquests
      );
      this.guildAnnouncementsChannel = U.getTextChannel(
        this.server,
        this.config.channels.guildannouncements
      );

      console.log('loading submodules...');
      this.initGchatModule();
    });

    this.discordBot.on('warn', (warn) => {
      console.warn(`[${U.getTimestamp()}][discordHandler.js] warning: `, warn);
    });

    this.discordBot.on('disconnect', () => {
      console.log('disconnected');
      this.discordBot.destroy();
      process.exit();
    });

    this.discordBot.on('error', (err) => {
      console.error(
        `[${U.getTimestamp()}][discordHandler.js] websocket error: `,
        err
      );
    });

    this.discordBot.on('debug', (debugMsg) => {
      // console.log(`[${U.getTimestamp()}][discordHandler.js] debug: `, debugMsg);
    });

    // connect bot to discord
    console.log('connecting...');
    this.discordBot.login(this.config.token).catch((reason) => {
      console.error(
        `[${U.getTimestamp()}][discordHandler.js] failed to login:`,
        reason
      );
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
    if (!this.guildAnnouncementsChannel) {
      console.warn('* guild announcement channel disabled');
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
      const msg = U.emojify(U.toDiscord(U.unHtml(message), this.server));
      this.channel.send(`\`[${author}]\`: ${msg}`);
    });

    this.ipc_discord.on('whisper', (author, message) => {
      // convert TERA HTML to Discord text
      const msg = U.emojify(U.toDiscord(U.unHtml(message), this.server));
      this.channel.send(`[Received Whisper][${author}]: ${msg}`);
    });

    this.ipc_discord.on('motd', (motd) => {
      this.guild.motd = motd;
      this.updateTopic();
    });

    // Online members
    this.ipc_discord.on('members', (members) => {
      console.log('\n\nRECEIVED members: ', members);
      members.sort((a, b) => a.localeCompare(b));
      this.guild.members = members;
      this.updateTopic();
    });

    this.ipc_discord.on('quest', (quests, numCompleted) => {
      // Add progress to quests
      this.guild.questsCompleted = numCompleted;
      this.guild.quests = quests.map((quest) => {
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

    this.ipc_discord.on(
      'sysmsg',
      (message, options = { codeStyle: undefined, logChan: undefined }) => {
        const { codeStyle, logChan } = options;

        // don't convert mentions; highlights from TERA login message are abusable
        this.channel.send(message, {
          code: codeStyle,
          disable_everyone: true
        });

        if (logChan) {
          if (logChan === this.config.channels.gquests) {
            this.gquestChannel.send(message, {
              code: codeStyle,
              disable_everyone: true
            });
          } else if (logChan === this.config.channels.guildannouncements) {
            this.guildAnnouncementsChannel.send(message, {
              code: codeStyle,
              disable_everyone: true
            });
          }
        }
      }
    );

    this.ipc_discord.on('stateUpdate', (state) => {
      if (state.loggedIn) {
        this.setChannelReadPerms(true);
        this.channel.send('< H.T.T chat bot is now online >', {
          code: 'md'
        });
      } else {
        this.setChannelReadPerms(false);
        this.channel.send('< H.T.T chat bot is now offline >', {
          code: 'md'
        });
      }
    });
  }

  discordMsgToTeraIPC() {
    this.discordBot.on('message', (message) => {
      // Discord commands in any channel would go here

      if (message.channel.id !== this.channel.id) {
        return;
      }
      if (message.author.id === this.discordBot.user.id) {
        return;
      }

      // Discord commands only in gchat channel
      switch (message.content) {
        case '.gc topic':
        case '.gtopic':
          this.channel.send(this.channel.topic);
          break;
        case '.gc info':
        case '.ginfo':
          this.channel.send({
            embed: {
              title: 'GUILD INFO',
              description: `\`\`\`md\n< MOTD >\n\n# ${
                this.guild.motd
              }\n\n< ONLINE >\n\n${this.guild.members.reduce(
                (allMembers, member) => `${allMembers}* ${member}\n`,
                ''
              )}\`\`\``,
              url: 'https://discordapp.com',
              color: 10627677,
              timestamp: new Date(Date.now()).toISOString(),
              image: {
                url:
                  'https://cdn.discordapp.com/icons/265232682126934016/a55c5d3ebc01b5caf609d2a31b2fd18c.webp'
              }
            }
          });
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

  setChannelReadPerms(canSendMsgs) {
    this.channel
      .overwritePermissions(this.config.roles.muteWhenOffline, {
        SEND_MESSAGES: canSendMsgs
      })
      .catch(console.error);
  }

  updateTopic() {
    const parts = [];

    // member list
    const online
      = this.guild.members.length > 0
        ? this.guild.members.join(', ')
        : '(Nobody)';
    parts.push(`< Online: ${online} >`);

    // guild quest
    /* if (this.guild.quests.length > 0) {
      parts.push(`< Quests (${this.guild.questsCompleted}/5): ${this.guild.quests.map(quest => `${quest.name} [${quest.progress}] `)} >`);
    } */

    // motd
    if (this.guild.motd.length > 0) {
      parts.push(`< MotD: ${U.emojify(U.unHtml(this.guild.motd))} >`);
    }

    parts.push(`< Last updated: ${U.getTimestamp()} >`);

    // update
    const topic = parts.join(' \n\n');
    if (topic !== this.lastTopic) {
      this.channel.setTopic(topic);
      this.lastTopic = topic;
    } else {
      console.log(
        `[${U.getTimestamp()}][discordHandler.js] topic supposedly equal(?) quests: `,
        this.guild.quests,
        ' | questsCompleted: ',
        this.guild.questsCompleted,
        ' | lastTopic: ',
        this.lastTopic
      );
    }
  }
}

module.exports = DiscordHandler;
