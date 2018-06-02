const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const AnyObject = require('./Models/AnyObject.js');
const Guild = require('./Models/Guild.js');
const Logs = require('./Models/Logs.js');
const U = require('./util');

/* DB CONNECTION */

const dbconfig = JSON.parse(fs.readFileSync(path.join(__dirname, '/../config/dbconfig.json'), 'utf8'));

const user = encodeURIComponent(dbconfig.USER);
const pass = encodeURIComponent(dbconfig.PASS);
const host = dbconfig.HOST;

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

const TeraGuild = mongoose.model('TeraGuild', Guild.guildSchema, 'Guild');
const TeraUnsorted = mongoose.model('TeraUnsorted', AnyObject.anyobjectSchema, 'Unsorted');
const TeraLogs = mongoose.model('TeraLogs', Logs.logSchema, `Logs`);

module.exports = {
  TeraGuild,
  TeraUnsorted,
  TeraLogs
};
