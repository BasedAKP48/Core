const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize the Firebase app using firebase-functions built-in config object.
admin.initializeApp(functions.config().firebase);

exports.incrementMessageCounter = require('./counter.js')(admin);
exports.github = require('./github.js');
