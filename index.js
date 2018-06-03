const fs = require('fs');
const path = require('path');

const models = require('./lib/models.js');
const DiscordHandler = require('./lib/discordHandler.js');
const TeraHandler = require('./lib/teraHandler.js');
const U = require('./lib/util');

class DiscordChatRelay {
  constructor(dispatch) {
    /* CONFIG FILE */
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '/config/config.json'), 'utf8'));

    if (!config) {
      console.error('no config file found');
      process.exit(1);
    }

    /* INIT Discord & Tera listeners */
    const discordHandler = new DiscordHandler(dispatch, config);
    const teraHandler = new TeraHandler(dispatch, config, models);

    this.destructor = () => {
      teraHandler.setLoginStatus(false);
    };

    // ping-pong
    dispatch.hook('S_PING', 1, () => {
      console.log(`[${U.getDateAndTimestamp()}][index.js] ping ponging...`);
      dispatch.toServer('C_PONG', 1);
    });
  }
}

module.exports = DiscordChatRelay;
