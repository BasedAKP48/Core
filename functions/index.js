const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize the Firebase app using firebase-functions built-in config object.
admin.initializeApp(functions.config().firebase);

if (!process.env.FUNCTION_NAME || process.env.FUNCTION_NAME === 'processMessage') {
  //exports.processMessage = require('./process.js'); // Uncomment for a passive listener
}

if (!process.env.FUNCTION_NAME || process.env.FUNCTION_NAME === 'incrementMessageCounter') {
  exports.incrementMessageCounter = require('./counter.js');
}

if (!process.env.FUNCTION_NAME || process.env.FUNCTION_NAME === 'github') {
  exports.github = require('./github.js');
}
