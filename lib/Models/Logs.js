const mongoose = require('mongoose');

const { Schema } = mongoose;
const logSchema = new Schema({ tag: String, log: Array });

module.exports.logSchema = logSchema;
