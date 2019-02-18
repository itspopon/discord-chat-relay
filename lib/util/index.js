const emoji = require('./emoji');

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const getTimestamp = () => {
  const d = new Date(Date.now());
  let str = '';

  // Time
  str +=
    d.getUTCHours() < 10
      ? `0${d.getUTCHours().toString()}`
      : d.getUTCHours().toString();
  str += ':';
  str +=
    d.getUTCMinutes() < 10
      ? `0${d.getUTCMinutes().toString()}`
      : d.getUTCMinutes().toString();
  str += ':';
  str +=
    d.getUTCSeconds() < 10
      ? `0${d.getUTCSeconds().toString()}`
      : d.getUTCSeconds().toString();
  // Timezone
  str += ' UTC';

  return str;
};

// This version doesn't have spaces and is mainly for the database
const getDateAndTimestamp = () => {
  const d = new Date(Date.now());
  let str = '';

  // Year
  str += `${d.getFullYear().toString()}`;
  // Month
  str += `_${months[d.getMonth()]}`;
  // Day
  str +=
    d.getDate() < 10
      ? `_0${d.getDate().toString()}_`
      : `_${d.getDate().toString()}_`;
  // Time
  str +=
    d.getUTCHours() < 10
      ? `0${d.getUTCHours().toString()}`
      : d.getUTCHours().toString();
  str += ':';
  str +=
    d.getUTCMinutes() < 10
      ? `0${d.getUTCMinutes().toString()}`
      : d.getUTCMinutes().toString();
  str += ':';
  str +=
    d.getUTCSeconds() < 10
      ? `0${d.getUTCSeconds().toString()}`
      : d.getUTCSeconds().toString();
  // Timezone
  str += '_UTC';

  return str;
};

const getDate = () => {
  const d = new Date(Date.now());
  let str = '';

  // Year
  str += `${d.getFullYear().toString()}`;
  // Month
  str += `_${months[d.getMonth()]}`;
  // Day
  str += `_${d.getDate().toString()}`;

  return str;
};

const getYearAndMonth = () => {
  const d = new Date(Date.now());
  let str = '';

  // Year
  str += `${d.getFullYear().toString()}`;
  // Month
  str += `_${months[d.getMonth()]}`;

  return str;
};

// helpers
function escapeRegExp(s) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

const unHtml = (() => {
  const replacements = {
    quot: '"',
    amp: '&',
    lt: '<',
    gt: '>',
  };

  return function unHtml(s) {
    return s
      .replace(/<.*?>/g, '')
      .replace(/&(quot|amp|lt|gt);/g, (_, $1) => replacements[$1]);
  };
})();

function emojify(s) {
  return emoji.replaceColons(s);
}

const unemojify = (() => {
  const shortcuts = {
    broken_heart: '</3',
    confused: ':-/',
    frowning: ':(',
    heart: '<3',
    hearts: '<3',
    neutral_face: ':|',
    open_mouth: ':o',
    smile: ':D',
    smiley: ':)',
    stuck_out_tongue: ':P',
    sunglasses: '8)',
    unamused: ':s',
    wink: ';)',
  };

  const regex = new RegExp(`:(${Object.keys(shortcuts).join('|')}):`, 'g');

  return function unemojify(s) {
    return emoji.replaceUnicode(s).replace(regex, (_, $1) => shortcuts[$1]);
  };
})();

const modelToClass = model => {
  let className;
  switch (model % 100) {
    case 1:
      className = 'Warrior';
      break;
    case 2:
      className = 'Lancer';
      break;
    case 3:
      className = 'Slayer';
      break;
    case 4:
      className = 'Berserker';
      break;
    case 5:
      className = 'Sorcerer';
      break;
    case 6:
      className = 'Archer';
      break;
    case 7:
      className = 'Priest';
      break;
    case 8:
      className = 'Mystic';
      break;
    case 9:
      className = 'Reaper';
      break;
    case 10:
      className = 'Gunner';
      break;
    case 11:
      className = 'Brawler';
      break;
    case 12:
      className = 'Ninja';
      break;
    case 13:
      className = 'Valkyrie';
      break;
    default:
      className = 'UNKNOWN_CLASS';
  }
  return className;
};

const teraEscape = str => {
  const entities = {
    '"': 'quot',
    '&': 'amp',
    '<': 'lt',
    '>': 'gt',
    "'": 'apos',
  };

  const escapeHtml = s => s.replace(/["&<>']/g, e => `&${entities[e]};`);

  return escapeHtml(str)
    .replace(/w-w/gi, match => match.split('-').join('-&#8206;'))
    .replace(/w{3,}/gi, match => match.split('').join('&#8206;'))
    .replace(/w w w/gi, match => match.split(' ').join('&#8206; '))
    .replace(/\n/g, ' ')
    .replace(/\t/g, '    ')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '?')
    .replace(/[^\x20-\x7E]/g, '?');
};

const formatDiscordMessage = (author, msg) => {
  return `\`\`\`ini\n[${author}]: ${msg}\`\`\``;
};

function replaceAll(string, search, replace) {
  return string.replace(new RegExp(escapeRegExp(search), 'gi'), replace);
}

function getServer(bot, serverId) {
  const server = bot.guilds.get(serverId);
  if (!server) {
    console.error('server "%s" not found', serverId);
    console.error('servers:');
    bot.guilds.forEach((s, id) => console.error('- %s (%s)', s.name, id));
    return null;
  }
  return server;
}

function getTextChannel(server, channelId) {
  const channel = server.channels.get(channelId);
  if (!channel || channel.type !== 'text') {
    console.error('text channel "%s" not found', channelId);
    console.error('channels:');
    server.channels.forEach((c, id) => {
      if (c.type !== 'text') {
        console.error('- #%s (%s)', c.name, id);
      }
    });
    return null;
  }
  return channel;
}

function getName(server, user) {
  const details = server.members.get(user && user.id);
  return (details && details.nickname) || (user && user.username) || '(???)';
}

function toDiscord(message, server) {
  // convert @mention
  // 1 - nicknames
  server.members.forEach(member => {
    if (member.nickname != null) {
      message = replaceAll(message, `@${member.nickname}`, member.toString());
    }
  });

  // 2 - usernames
  server.members.forEach(member => {
    message = replaceAll(
      message,
      `@${member.user.username}`,
      member.toString()
    );
  });

  // convert #channel
  server.channels.forEach(channel => {
    if (channel.type === 'text') {
      message = replaceAll(message, `#${channel.name}`, channel.toString());
    }
  });

  // convert @role
  server.roles.forEach(role => {
    message = replaceAll(message, `@${role.name}`, role.toString());
  });

  // TODO convert :emoji:
  server.emojis.forEach(emoji => {
    message = replaceAll(message, `:${emoji.name}:`, emoji.toString());
  });

  // return
  return message;
}

function fromDiscord(message, server) {
  return (
    message
      // @user, @!user
      .replace(/<@!?(\d+)>/g, (_, mention) => {
        const m = server.members.get(mention);
        return `@${(m && getName(server, m.user)) || '(???)'}`;
      })
      // #channel
      .replace(/<#(\d+)>/g, (_, mention) => {
        const m = server.channels.get(mention);
        return `#${(m && m.name) || '(???)'}`;
      })
      // @role
      .replace(/<@&(\d+)>/g, (_, mention) => {
        const m = server.roles.get(mention);
        return `@${(m && m.name) || '(???)'}`;
      })
      // :emoji:
      .replace(/<:(\w+):(\d+)>/g, (_, mention) => `:${mention}:`)
  );
}

// exports
module.exports = {
  getTimestamp,
  getDateAndTimestamp,
  getDate,
  getYearAndMonth,
  escapeRegExp,
  unHtml,
  emojify,
  unemojify,
  modelToClass,
  teraEscape,
  formatDiscordMessage,
  replaceAll,
  getServer,
  getTextChannel,
  getName,
  toDiscord,
  fromDiscord,
};
