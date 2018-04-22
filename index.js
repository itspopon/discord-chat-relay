const fs = require('fs');
const path = require('path');

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
    const teraHandler = new TeraHandler(dispatch, config);

    this.destructor = () => {
      teraHandler.setLoginStatus(false);
    };

    // ping-pong
    dispatch.hook('sPing', 1, () => {
      console.log(`[${U.getTimestamp()}][index.js] ping ponging...`);
      dispatch.toServer('cPong', 1);
    });
  }
}

module.exports = DiscordChatRelay;
