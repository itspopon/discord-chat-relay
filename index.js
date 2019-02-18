const fs = require('fs');
const path = require('path');

const models = require('./lib/models.js');
const DiscordHandler = require('./lib/discordHandler.js');
const TeraHandler = require('./lib/teraHandler.js');
const U = require('./lib/util');

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

    /* INIT Discord & Tera listeners */
    const discordHandler = new DiscordHandler(dispatch, config);
    const teraHandler = new TeraHandler(dispatch, config, models);

    this.destructor = () => {
      teraHandler.setLoginStatus(false);
    };
  }
}

module.exports = DiscordChatRelay;
