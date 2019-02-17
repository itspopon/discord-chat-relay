const mongoose = require('mongoose');

const { Schema } = mongoose;
const guildSchema = new Schema({ guildData: Object });

module.exports.guildSchema = guildSchema;
