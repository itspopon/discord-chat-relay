const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const AnyObject = require('./Models/AnyObject.js');
const Guild = require('./Models/Guild.js');
const Logs = require('./Models/Logs.js');
const U = require('./util');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '/../config/config.json'), 'utf8'));

/* DB CONNECTION */

const user = encodeURIComponent(config.db.user);
const pass = encodeURIComponent(config.db.pass);
const { host } = config.db;

try {
  mongoose.connect(`mongodb://${user}:${pass}@${host}`);
} catch (err) {
  console.error('\n\nMongoose connection error: ', err);
}

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'Connection error:'));
db.once('open', () => {
  console.log('- connected to mlab database');
});

/* MODELS */

let TeraGuild;
let TeraUnsorted;
let TeraLogs;

if (config.devMode) {
  TeraGuild = mongoose.model('TeraGuild', Guild.guildSchema, '_Guild');
  TeraUnsorted = mongoose.model('TeraUnsorted', AnyObject.anyobjectSchema, '_Unsorted');
  TeraLogs = mongoose.model('TeraLogs', Logs.logSchema, `_Logs_${U.getYearAndMonth()}`);
} else {
  TeraGuild = mongoose.model('TeraGuild', Guild.guildSchema, 'Guild');
  TeraUnsorted = mongoose.model('TeraUnsorted', AnyObject.anyobjectSchema, 'Unsorted');
  TeraLogs = mongoose.model('TeraLogs', Logs.logSchema, `Logs_${U.getYearAndMonth()}`);
}

module.exports = {
  TeraGuild,
  TeraUnsorted,
  TeraLogs
};
