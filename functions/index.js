const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize the Firebase app using firebase-functions built-in config object.
admin.initializeApp(functions.config().firebase);

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

/**
 * Messages must have certain properties before they can be acted upon by the core and plugins.
 * These functions ensure that any incoming messages include all required properties before being moved to the messages
 * queue.
 */
exports.processIncomingChatMessage = functions.database.ref('/inbound_raw_messages/{pushId}').onWrite(processMessage);

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

  if(!msg.timeReceived) {
    msg.timeReceived = Date.now();
  }

  return rootRef.child('messages').push().set(msg).then(() => {
    return e.data.adminRef.remove();
  });
}

exports.incrementMessageCounter = functions.database.ref('/messages/{pushId}').onWrite((e) => {
  // Messages only count if they are new, and aren't removed.
  if (e.data.previous.exists() || !e.data.exists()) {
    return;
  }

  return rootRef.child('totalMessageCount').transaction((count) => {
    return (count || 0) + 1;
  });
});

exports.processTestCommand = functions.database.ref('/messages/{pushId}').onWrite((e) => {
  let msg = e.data.val();
  if(msg.text === '.test') {
    let response = {
      uid: 'BasedAKP48Core',
      cid: 'BasedAKP48Core',
      text: 'You have successfully completed testing.',
      channel: msg.channel,
      msgType: 'chatMessage',
      timeReceived: Date.now()
    }

    let responseRef = rootRef.child('messages').push();
    let responseKey = responseRef.key;

    let updateData = {};
    updateData[`messages/${responseKey}`] = response;
    updateData[`clients/${msg.cid}/${responseKey}`] = response;

    return rootRef.update(updateData);
  }
});