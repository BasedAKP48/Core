const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize the Firebase app using firebase-functions built-in config object.
admin.initializeApp(functions.config().firebase);

// Reference to the root of our database, for convenience.
const rootRef = admin.database().ref();

// The fields that a message is required to contain.
const REQUIRED_MESSAGE_FIELDS = [
  'uid', // User ID
  'text', // The message text
  'cid' // Client ID
];

// The fields that a message can contain, but aren't required.
const OPTIONAL_MESSAGE_FIELDS = [];

/**
 * Messages must have certain properties before they can be acted upon by the core and plugins.
 * These functions ensure that any incoming messages include all required properties before being moved to the messages
 * queue.
 */
exports.processIncomingChatMessage = functions.database.ref('/inbound_raw_messages/{pushId}').onWrite(processMessage);
exports.processIncomingResponseMessage = functions.database.ref('/inbound_raw_responses/{pushId}').onWrite(processMessage);

function processMessage(e) {
  let msg = e.data.val();
  if(!msg) { return; }
  for (let i = 0; i < REQUIRED_MESSAGE_FIELDS.length; i++) {
    let field = REQUIRED_MESSAGE_FIELDS[i];
    if(!msg[field]) {
      return e.data.adminRef.remove(); // remove the raw message from the queue, as it is malformed.
    }
  }

  for (let k in msg) {
    if (msg.hasOwnProperty(k)) {
      if(!OPTIONAL_MESSAGE_FIELDS.includes(k) && !REQUIRED_MESSAGE_FIELDS.includes(k)) {
        delete msg[k];
      }
    }
  }

  return rootRef.child('messages').push().set(msg).then(() => {
    return e.data.adminRef.remove();
  });
}