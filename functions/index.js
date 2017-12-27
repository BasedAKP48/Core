const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize the Firebase app using firebase-functions built-in config object.
admin.initializeApp(functions.config().firebase);

//exports.processMessage = require('./process.js'); // Uncomment for a passive listener
exports.incrementMessageCounter = require('./counter.js');
exports.github = require('./github.js');
