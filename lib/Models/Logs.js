const mongoose = require('mongoose');

const { Schema } = mongoose;
const logSchema = new Schema({ date: String, log: Array });

module.exports.logSchema = logSchema;
