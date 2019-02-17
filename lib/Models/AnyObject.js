const mongoose = require('mongoose');

const { Schema } = mongoose;
const anyobjectSchema = new Schema({ name: String, data: Object });

module.exports.anyobjectSchema = anyobjectSchema;
