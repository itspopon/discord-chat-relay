const models = require('../models.js');
const U = require('./index');

module.exports = logline => {
  const logWithTimestamp = `[${U.getDateAndTimestamp()}] ${logline}`;

    try {
      models.TeraLogs.findOneAndUpdate(
        { date: U.getDate() },
        { $push: { log: logWithTimestamp } },
        { upsert: true },
        () => console.log(logWithTimestamp)
      );
    } catch (err) {
      console.error(err);
    }
};