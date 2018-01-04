const admin = require('firebase-admin');
const serviceAccount = require("./serviceAccount.json");
const { initialize, PresenceSystem } = require('@basedakp48/plugin-utils');
const pkg = require('./package.json');

const presenceSystem = new PresenceSystem();

initialize(admin, serviceAccount);

// Reference to the root of our database, for convenience.
const rootRef = admin.database().ref();
const cid = utils.getCID(rootRef, __dirname);

presenceSystem.initialize({
  rootRef,
  cid,
  pkg,
  instanceName: 'Core',
  listenMode: 'core'
});

rootRef.child('pendingMessages').on('child_added', processMessage);
let initialized = false;
rootRef.child('.info/connected').on('value', (v) => {
  if (v.val() === true) {
    console.log('Core is now connected and listening for messages');
    initialized = true;
  } else if (initialized) {
    console.log('Core has disconnected from Firebase! Automatically attempting to reconnect...');
  }
});

// The fields that a message is required to contain.
const REQUIRED_MESSAGE_FIELDS = [
  'uid', // User ID
  ['cid', 'target'], // Client ID (incoming) or Target ID (outgoing)
  'text', // The message text
  'channel', // What channel the message came from
];

// The fields that a message can contain. Manually added all required fields for "efficiency."
const ALLOWED_MESSAGE_FIELDS = [
  'uid', // User ID
  'cid', // Client ID (incoming)
  'target', // Target ID (outgoing)
  'text', // The message text
  'channel', // What channel the message came from
  'type', // What type of message this is
  'extra_client_info', // Anything a client might need to "remember" about a message can go here.
  'timeReceived', // The time the message was received. If not included, this will be generated.
];

/**
 * Messages must have certain properties before they can be acted upon by the core and plugins.
 * This function ensures that any incoming messages include all required properties before being moved to the messages
 * queue.
 */
function processMessage(e) {
  let msg = e.val();

  console.log(msg);

  // if we don't have a message, just return.
  if(!msg) { return; }

  // for each required field, make sure the message has the field.
  for (let i = 0; i < REQUIRED_MESSAGE_FIELDS.length; i++) {
    let field = REQUIRED_MESSAGE_FIELDS[i];
    if (!hasOne(msg, field)) {
      return e.ref.remove(); // if not, remove the raw message from the queue, as it is malformed.
    }
  }

  // for each field in the message, verify that the key is allowed.
  // if the key is not allowed, it is extraneous, and should be removed.
  for (let k in msg) {
    if (msg.hasOwnProperty(k) && !ALLOWED_MESSAGE_FIELDS.includes(k)) {
      delete msg[k];
    }
  }

  // add the time received, if the providing plugin did not populate it.
  if (!msg.timeReceived) {
    msg.timeReceived = Date.now();
  }

  // Is this an outgoing message?
  let outgoing = msg.hasOwnProperty('target');
  if (outgoing) {
    msg.cid = msg.target;
    delete msg.target;
  }

  // Set some defaults
  msg.direction = outgoing ? 'out' : 'in';
  msg.type = msg.type || 'text';

  // Is this an internal message?
  if (msg.type.toLowerCase() === 'internal' || msg.type.toLowerCase() === 'akpacket') {
    msg.type = 'internal';  // force a standardized type
    return rootRef.child(`clients/${msg.cid}`).push(msg).then(() => {
      return e.ref.remove();
    });
  }

  // push the message into the messages queue and remove it from the raw messages queue.
  return rootRef.child('messages').push(msg).then(() => {
    if (outgoing) {
      rootRef.child(`clients/${msg.cid}`).push(msg);
    }
  }).then(() => {
    return e.ref.remove();
  });
}

function hasOne(object, array) {
  if (!Array.isArray(array)) array = [array];
  let count = 0;
  for (let i = 0; i < array.length; i++) {
    let key = array[i];
    if (object.hasOwnProperty(key) && object[key] !== null && object[key] !== undefined) {
      count++;
    }
  }
  return count === 1;
}
