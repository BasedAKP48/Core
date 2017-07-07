const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Promise = require('bluebird');
const Rollbar = require('rollbar');

// Initialize the Firebase app using firebase-functions built-in config object.
admin.initializeApp(functions.config().firebase);

// Initialize Rollbar, which handles error tracking.
const rollbar = new Rollbar(functions.config().app.rollbar.token);

// Reference to the root of our database, for convenience.
const rootRef = admin.database().ref();

// The fields that a message is required to contain.
const REQUIRED_MESSAGE_FIELDS = [
  'uid', // User ID
  'cid', // Client ID
  'text', // The message text
  'channel', // What channel the message came from
  'msgType' // What type of message this is
];

// The fields that a message can contain, but aren't required.
const OPTIONAL_MESSAGE_FIELDS = [
  'extra_client_info', // Anything a client might need to "remember" about a message can go here.
  'timeReceived' // The time the message was received. If not included, this will be generated.
];

const DEFAULT_PERMISSIONS_OBJECT = {
  BasedAKP48: {
    User: true
  }
};

/**
 * Messages must have certain properties before they can be acted upon by the core and plugins.
 * This function ensures that any incoming messages include all required properties before being moved to the messages
 * queue.
 */
function processMessage(e) {
  let msg = e.data.val();
  // if we don't have a message, just return.
  if(!msg) { return; }

  // for each required field, make sure the message has the field.
  for (let i = 0; i < REQUIRED_MESSAGE_FIELDS.length; i++) {
    let field = REQUIRED_MESSAGE_FIELDS[i];
    if(!msg[field]) {
      rollbar.error(`Caught a malformed message!`, msg);
      return e.data.adminRef.remove(); // if not, remove the raw message from the queue, as it is malformed.
    }
  }

  // for each field in the message, verify that the keys provided are either required or optional.
  // if the keys aren't in either of our arrays, they are extraneous, and should be removed.
  for (let k in msg) {
    if (msg.hasOwnProperty(k)) {
      if(!OPTIONAL_MESSAGE_FIELDS.includes(k) && !REQUIRED_MESSAGE_FIELDS.includes(k)) {
        delete msg[k];
      }
    }
  }

  // add the time received, if the providing plugin did not populate it.
  if(!msg.timeReceived) {
    msg.timeReceived = Date.now();
  }

  return new Promise((resolve) => {
    // get permissions of the user who sent this message
    rootRef.child(`permissions/${msg.uid.replace(/\./g, '_')}`).once('value', (d) => {
      let permissions = d.val();
      if(!permissions) {
        // if no permissions found, set the default permissions object as the user's permissions.
        d.ref.set(DEFAULT_PERMISSIONS_OBJECT).then(() => {
          msg.permissions = permissions;
          resolve(msg);
        });
      } else {
        msg.permissions = permissions;
        resolve(msg);
      }
    });
  }).then((msg) => {
    // push the message into the messages queue and remove it from the raw messages queue.
    return rootRef.child('messages').push().set(msg).then(() => {
      return e.data.adminRef.remove();
    });
  });
}

function incrementCounter(e) {
  // Messages only count if they are new, and aren't removed.
  if (e.data.previous.exists() || !e.data.exists()) {
    return;
  }

  // increment total message count inside a transaction to be sure we increment properly.
  return rootRef.child('totalMessageCount').transaction((count) => {
    return (count || 0) + 1;
  }).then(()=>{}); // The then() call is to work around a firebase-admin bug.
};

exports.processIncomingChatMessage = functions.database.ref('/incomingMessages/{pushId}').onWrite(processMessage);
exports.incrementMessageCounter = functions.database.ref('/messages/{pushId}').onWrite(incrementCounter);