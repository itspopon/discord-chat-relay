const fs = require('fs');
const path = require('path');

const models = require('./lib/models.js');
const DiscordHandler = require('./lib/DiscordHandler.js');
const TeraHandler = require('./lib/TeraHandler.js');

const Events = require('./lib/Events');

class DiscordChatRelay {
  constructor(dispatch) {
    /* CONFIG FILE */
    const config = JSON.parse(
      fs.readFileSync(path.join(__dirname, '/config/config.json'), 'utf8')
    );

    if (!config) {
      console.error('[Relay] No config file found');
      process.exit(1);
    }

    dispatch.hook('S_LOGIN', 10, event => {
      console.log('[Relay] Login!');
    });

    const events = new Events();

    /* INIT Discord & Tera listeners */
    const discord = new DiscordHandler(dispatch, config, events);
    const tera = new TeraHandler(dispatch, config, models, events);

    this.destructor = () => {
      tera.setLoginStatus(false);
    };
  }
}

module.exports = DiscordChatRelay;
