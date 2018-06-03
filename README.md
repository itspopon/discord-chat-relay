# discord-chat-relay

Relay chat between Tera (Guild Chat only) & Discord

This is based off of [Meishuu's Tera-Discord-Relay](https://github.com/meishuu/tera-discord-relay)

Tera-strings may need updating in the future. Latest one I pulled was from [trini0n's fork](https://github.com/trini0n/tera-discord-relay/blob/ccb4af6a6fdeefb7480068d4ba5fb44ab0e5fbc4/tera/app/discord/node_modules/tera-strings/strings.json)

## REQUIREMENTS

* This requires Caali's proxy via https://discord.gg/maqBmJV
* Mlab account for database / logging

## INSTALLATION

* Ignore everything but module.json and the config folder
* Fill out the information in config/config-sample.json and rename to config.json.
* Place module.json and config/ folder in tera-proxy/bin/node_modules/
* Launch proxy and then start Tera and enjoy
* NOTE: If having trouble auto updating, delete everything in the tera-proxy/bin/node_modules/discord-tera-gchat folder except module.json and config/ and start proxy again. It will pull a fresh copy of the files based on module.json.
* NOTE2: May also need to go to tera-proxy/bin/config.json and change "updatelimit" to true
* NOTE3: If having trouble downloading node_modules, try deleting it, installing yarn, and redownloading node_modules with `yarn install`
