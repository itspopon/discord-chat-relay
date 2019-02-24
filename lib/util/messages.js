const format = require('string-template');

const logger = require('./logger');

const messages = new Map();

// Name, level, class, message
messages.set(
  'apply',
  '{0} (Level {1} {2}) applied to the guild. Their message: {3}'
);

// Name
messages.set('applyrejected', "> {0}'s guild application was rejected.");

// Guildie, new member
messages.set('applyaccepted', '+ {0} accepted {1} into the guild.');

// Guildie, person rejected
messages.set('applyrejected2', "> {0} rejected {1}'s guild application.");

// Name
messages.set('joinedguild', '+ {0} joined the guild.');

// Name
messages.set('leftguild', '- {0} has left the guild.');

// Name
messages.set('kicked', '- {0} was kicked out of the guild.');

// Name
messages.set('login1', '<:Aw:489893064005910554> `{0} logged in.`');

// Name, message
messages.set(
  'login2',
  '<:Aw:489893064005910554> `{0} logged in. Message: {1}`'
);

// Name
messages.set('logout', '<:Cry:489897676704317450> `{0} logged out.`');

// Name
messages.set('gmchanged', '= ${0} is now the Guild Master. =');

// Name, laurel
messages.set('laurel', '< ${0} earned a {1}. >');

// Name, item level, item name
messages.set('enchant', '* {0} has successfully enchanted (+{1}) < {2} >.');

// Name, item, count, box
messages.set('lootbox', '* {0} obtained < {1} > x {2} from <{3}>.');

// Level
messages.set('guildlevel', '< Guild level is now {0}. >');

// :)
messages.set('guildskill', '< The guild has learned a new skill. >');

// :)
messages.set(
  'guildfunds',
  '< Guild funds have been delivered via parcel post. >'
);

// Quest
messages.set('acceptquest', 'Received [{0}]');



const getMessage = (id, values, opts) => {
  const specialCases = ['login'];

  const isSpecialCase = specialCases.includes(id);

  if (!messages.has(id) && !isSpecialCase) {
    logger('Unkown message: ' + id, 'error');
    return 'Unkown message: ' + id;
  }

  if (isSpecialCase) {
    switch (id) {
      case 'login':
        // Check if values contains a message
        id = values.length > 1 ? 'login1' : 'login2';
        break;
      default:
        logger('Unkown special case: ' + id, 'error');
        break;
    }
  }

  const msg = messages.get(id);

  if (opts.code) msg[1] = { code: opts.code };
  if (opts.allowPing) msg[1].disableEveryone = true;

  return format(msg, values);
};
