// TODO: make a getMessage() function
const _ = require('lodash');
const Discord = require('discord.js');
const U = require('./util');

class DiscordHandler {
  constructor(dispatch, config, event) {
    this.dispatch = dispatch;
    this.config = config;
    this.event = event;

    this.discordBot = new Discord.Client({
      fetchAllMembers: true,
      sync: true,
    });

    this.guild = {
      motd: '',
      members: [],
      quests: [],
      questsCompleted: 0,
    };
    this.lastTopic = '';

    this.discordBot.on('ready', () => {
      this.discordBot.user.setActivity('TERA');
      // Main
      this.server = U.getServer(this.discordBot, this.config.serverId);
      this.channel = U.getTextChannel(
        this.server,
        this.config.channels.gamechat
      );
      // Misc
      this.announcementsChannel = U.getTextChannel(
        this.server,
        this.config.channels.announcements
      );
      this.firewallChannel = U.getTextChannel(
        this.server,
        this.config.channels.firewall
      );
      this.gquestsChannel = U.getTextChannel(
        this.server,
        this.config.channels.gquests
      );
      this.guildchatChannel = U.getTextChannel(
        this.server,
        this.config.channels.guildchat
      );
      this.whisperChannel = U.getTextChannel(
        this.server,
        this.config.channels.whisper
      );
      console.log('--- loading submodules...');
      this.init();
    });

    this.discordBot.on('warn', warn => {
      console.warn(`[${U.getTimestamp()}][Relay] warning: `, warn);
    });

    this.discordBot.on('disconnect', () => {
      console.log('disconnected');
      this.discordBot.destroy();
      process.exit();
    });

    // If this isn't enough use on('debug', message => {...})
    this.discordBot.on('error', err => {
      console.error(`[${U.getTimestamp()}][Relay] websocket error: `, err);
    });

    // connect bot to discord
    // console.log('connecting...');
    this.discordBot.login(this.config.token).catch(reason => {
      console.error(
        `[${U.getTimestamp()}][Relay] failed to login with bot:`,
        reason
      );
      this.discordBot.destroy();
      process.exit();
    });
  }

  init() {
    // Warn if main components are disabled
    if (this.server && this.channel) {
      console.log('Relay - Listening to chat');
    } else {
      console.log('Relay - Could not find chat channel');
      console.log('*** init failed');
      return;
    }

    // Trigger initial fetch
    this.event.send('fetch', {});

    this.discordMessageListener();

    // Popo Events

    this.event.on('botstate', data => {
      if (data.state) {
        this.setChannelWritePerms(null);
      } else {
        this.setChannelWritePerms(false);
      }
      const message = `< Popo's cute little bot ${
        data.state ? 'is ready for action!' : 'is sleepy... :sleeping:'
      } >`;
      this.dSend(this.channel, [message, { code: 'md' }]);
    });

    // Sending guild chat to discord
    this.event.on('terachat', data => {
      // convert TERA HTML to Discord text
      const msg = U.emojify(U.toDiscord(U.unHtml(data.message), this.server));
      this.dSend(this.channel, [
        U.formatDiscordMessage(data.name, msg),
        {
          disableEveryone: true,
        },
      ]);
    });

    // Sending whisper to discord
    this.event.on('terawhisper', data => {
      // convert TERA HTML to Discord text
      const msg = U.emojify(U.toDiscord(U.unHtml(data.message), this.server));
      this.dSend(this.whisperChannel, [
        U.formatDiscordMessage(data.name, msg),
        {
          disableEveryone: true,
        },
      ]);
    });

    // Set motd
    this.event.on('motd', data => {
      this.guild.motd = data.motd;
      this.updateTopic();
    });

    // Online members
    this.event.on('members', data => {
      data.members.sort((a, b) => a.localeCompare(b));
      this.guild.members = data.members;
      this.updateTopic();
    });

    // Update quests
    this.event.on('updatequests', data => {
      // Add progress to quests
      this.guild.questsCompleted = data.numCompleted;
      this.guild.quests = data.quests.map(quest => {
        let progress;

        // If quest is more than a single event(?). I.e. has progress-tracking-capability(?)
        if (quest.targets) {
          const targets = quest.targets.map(
            target => `${target.name}: ${target.completed}/${target.total}`
          );
          progress = targets.join(', ');
        } else {
          progress = `${quest.completed}/${quest.total}`;
        }

        return { name: quest.name, progress };
      });
      this.updateTopic();
    });

    // Someone applied to the guild
    this.event.on('apply', data => {
      const message = [
        `${data.name} (Level ${data.level} ${
          data.className
        }) applied to the guild. Their message: ${data.applicationMsg}`,
        {
          code: true,
          disableEveryone: true,
        },
      ];

      this.dSend(this.firewallChannel, message);
      this.dSend(this.channel, message);
    });

    // Application rejected by someone
    this.event.on('applyrejected', data => {
      const message = [
        `> ${data.name}'s guild application was rejected.`,
        {
          code: 'diff',
          disableEveryone: true,
        },
      ];

      this.dSend(this.firewallChannel, message);
      this.dSend(this.channel, message);
    });

    // Application accepted by someone
    this.event.on('applyaccepted', data => {
      const message = [
        `+ ${data.guildie} accepted ${data.newMember} into the guild.`,
        {
          code: 'diff',
          disableEveryone: true,
        },
      ];

      this.dSend(this.firewallChannel, message);
      this.dSend(this.channel, message);
    });

    // Application rejected
    this.event.on('applyrejected2', data => {
      const message = [
        `> ${data.guildie} rejected ${data.reject}'s guild application.`,
        {
          code: 'diff',
          disableEveryone: true,
        },
      ];

      this.dSend(this.firewallChannel, message);
      this.dSend(this.channel, message);
    });

    // Someone joined the guild
    this.event.on('joinedguild', data => {
      const message = [
        `+ ${data.name} joined the guild.`,
        {
          codeStyle: 'diff',
        },
      ];
      this.dSend(this.firewallChannel, message);
      this.dSend(this.channel, message);
    });

    // Someone left the guild
    this.event.on('leftguild', data => {
      const message = [
        `- ${data.name} has left the guild. Please unfriend that person.`,
        { code: 'diff' },
      ];
      this.dSend(this.firewallChannel, message);
      this.dSend(this.channel, message);
    });

    // Someone was kicked out of the guild
    this.event.on('kicked', data => {
      const message = [
        `- ${
          data.name
        } was kicked out of the guild. Please unfriend that person.`,
        { code: 'diff' },
      ];
      this.dSend(this.firewallChannel, message);
      this.dSend(this.channel, message);
    });

    // Login
    this.event.on('login', data => {
      const message = [`<:Aw:489893064005910554> \`${data.name} logged in. `];
      if (data.message) message[0] += `Message: ${_.unescape(data.message)}\``;
      this.dSend(this.channel, message);
    });

    // Logout
    this.event.on('logout', data => {
      const message = [
        `<:Cry:489897676704317450> \`${data.name} logged out.\``,
      ];
      this.dSend(this.channel, message);
    });

    // The GM has changed
    this.event.on('gmchanged', data => {
      const message = [
        `= ${data.name} is now the Guild Master. =`,
        { code: 'asciidoc' },
      ];
      this.dSend(this.channel, message);
    });

    // Guildie Earned a laurel
    this.event.on('laurel', data => {
      const message = [
        `< ${data.name} earned a ${this.conv(data.laurel)}. >`,
        { code: 'md' },
      ];
      this.dSend(this.channel, message);
    });

    // Guildie enchanted
    this.event.on('enchant', data => {
      const message = [
        `* ${data.name} has successfully enchanted (+${data.level}) < ${
          data.item
        } >.`,
        { code: 'md' },
      ];
      this.dSend(this.channel, message);
    });

    // Guildie won item from loot box
    this.event.on('lootbox', data => {
      const message = [
        `* ${data.name} obtained < ${data.item} > x ${data.count} from <${
          data.box
        }>.`,
        { code: 'md' },
      ];
      this.dSend(this.channel, message);
    });

    // Guild Level
    this.event.on('guildlevel', data => {
      const message = [`< Guild level is now ${data.level}. >`, { code: 'md' }];
      this.dSend(this.announcementsChannel, message);
    });

    // Guild Skill
    this.event.on('guildlevel', data => {
      const message = [
        '< The guild has learned a new skill. >',
        { code: 'md' },
      ];
      this.dSend(this.announcementsChannel, message);
    });

    // Guild funds distributed
    this.event.on('guildfunds', data => {
      const message = [
        '< Guild funds have been delivered via parcel post. >',
        { code: 'md' },
      ];
      this.dSend(this.announcementsChannel, message);
    });

    // Rally
    this.event.on('rally', data => {
      let message = '';
      if (data.pvp) message += '(PVP) ';
      switch (data.type) {
        case 0:
          message += 'Rally is spawning noon. Take the gquest!';
          break;
        case 1:
          message += 'Rally has spawned!';
          break;
        case 3:
          message += 'Rally is dead.';
          break;
      }
      this.dSend(this.channel, message);
      this.dSend(this.channels.announcements, message);
    });

    /* Quest events */
    // Accepted a quest
    this.event.on('acceptquest', data => {
      const message = [`Received [${data.quest}]`, { code: 'ini' }];
      this.dSend(this.channel, message);
      this.dSend(this.channels.gquests, message);
    });

    // Completed a quest
    this.event.on('completequest', data => {
      const message = [`Completed [${data.quest}]`, { code: 'ini' }];
      this.dSend(this.channel, message);
      this.dSend(this.channels.gquests, message);
    });

    // Advanced a quest
    this.event.on('advancequest', data => {
      const message = [
        `${data.name} advanced [${data.quest}] (${data.value}/${data.target})`,
        { code: 'ini' },
      ];
      this.dSend(this.channel, message);
      this.dSend(this.channels.gquests, message);
    });

    // Canceled a quest
    this.event.on('cancelquest', data => {
      const message = [
        `${data.name} canceled [${data.quest}]`,
        { code: 'ini' },
      ];
      this.dSend(this.channel, message);
      this.dSend(this.channels.gquests, message);
    });

    // Failed a quest
    this.event.on('failquest', data => {
      const message = [`Failed [${data.quest}]`, { code: 'asciidoc' }];
      this.dSend(this.channel, message);
      this.dSend(this.channels.gquests, message);
    });

    // Ending quest
    this.event.on('endingquest', data => {
      const message = [
        `< WARNING > A guild quest is ending in 10min`,
        { code: 'md' },
      ];
      this.dSend(this.channel, message);
      this.dSend(this.channels.gquests, message);
    });

    console.log('Relay is ready. ----');
  }

  // Send message to discord but only if not in devMode
  dSend(discordChannel, options) {
    console.log(JSON.stringify(options));
    if (this.config.devMode) {
      return;
    }
    discordChannel.send(...options);
  }

  discordMessageListener() {
    this.discordBot.on('message', message => {
      if (
        message.channel.id !== this.channel.id ||
        message.author.id === this.discordBot.user.id
      ) {
        return;
      }

      // Send to Tera
      const author = U.getName(this.server, message.author);

      if (message.type === 'PINS_ADD') {
        this.event.send('discordinfo', {
          message: `${author} pinned a message.`,
        });
      } else {
        const str = U.unemojify(U.fromDiscord(message.content, this.server));
        const uploads = message.attachments.map(attachment => attachment.url);
        if (uploads.length) {
          if (str) {
            this.event.send('discordchat', {
              author,
              message: `${str} [uploaded: ${uploads.join(', ')}]`,
            });
          } else {
            this.event.send('discordinfo', {
              message: `${author} uploaded: ${uploads.join(', ')}`,
            });
          }
        } else {
          this.event.send('discordchat', { author, message: str });
        }
      }
    });
  }

  setChannelWritePerms(canSendMsgs) {
    if (this.config.devMode) return;

    this.channel
      .overwritePermissions(this.config.roles.muteWhenOffline, {
        SEND_MESSAGES: canSendMsgs,
      })
      .catch(console.error);
  }

  updateTopic() {
    const parts = [];

    // member list
    const online =
      this.guild.members.length > 0
        ? this.guild.members.join(', ')
        : '(Nobody)';
    parts.push(`< Online: ${online} >`);

    // guild quest
    if (this.guild.quests.length > 0) {
      parts.push(
        `< Quests (${this.guild.questsCompleted}/5): ${this.guild.quests.map(
          quest => `${quest.name} [${quest.progress}] `
        )} >`
      );
    }

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
