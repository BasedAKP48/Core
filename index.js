const admin = require('firebase-admin');
const serviceAccount = require("./serviceAccount.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://basedakp48.firebaseio.com"
});

const rootRef = admin.database().ref();

rootRef.child('incomingMessages').on('child_added', (e) => { processMessage(e, false); });
rootRef.child('outgoingMessages').on('child_added', (e) => { processMessage(e, true); });

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
 * This function ensures that any incoming messages include all required properties before being moved to the messages
 * queue.
 */
function processMessage(e, outgoing) {
  let msg = e.val();

  console.log(msg);

  // if we don't have a message, just return.
  if(!msg) { return; }

  // for each required field, make sure the message has the field.
  for (let i = 0; i < REQUIRED_MESSAGE_FIELDS.length; i++) {
    let field = REQUIRED_MESSAGE_FIELDS[i];
    if(msg[field] === null || msg[field] === undefined) {
      return e.ref.remove(); // if not, remove the raw message from the queue, as it is malformed.
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

  // push the message into the messages queue and remove it from the raw messages queue.
  return rootRef.child('messages').push().set(msg).then(() => {
    if(outgoing) {
      return rootRef.child(`clients/${msg.cid}`).push().set(msg);
    }
  }).then(() => {
    return e.ref.remove();
  });
}