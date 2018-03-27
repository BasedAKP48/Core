const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');
const { initialize, PresenceSystem, getCID } = require('@basedakp48/plugin-utils');
const pkg = require('./package.json');

const presenceSystem = PresenceSystem();

initialize(serviceAccount);

// Reference to the root of our database, for convenience.
const rootRef = admin.database().ref();
const cid = getCID(rootRef, __dirname);

presenceSystem.initialize({
  rootRef,
  cid,
  pkg,
  instanceName: 'Core',
  listenMode: 'core',
});

presenceSystem.on('connect', () => {
  console.log('Core is now connected and listening for messages');
});

presenceSystem.on('disconnect', () => {
  console.log('Core has disconnected from Firebase! Automatically attempting to reconnect...');
});

rootRef.child('pendingMessages').on('child_added', processMessage);

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
  'data', // Anything a client might need to "remember" about a message can go here.
  'timeReceived', // (deprecated) The time the message was received.
  'timestamp', // The time the message was received. If not included, this will be generated.
];

/**
 * Messages must have certain properties before they can be acted upon by the core and plugins.
 * This function ensures that any incoming messages include all required properties before being
 * moved to the messages queue.
 */
function processMessage(e) {
  const msg = e.val();

  // if we don't have a message, just return.
  if (!msg) { return; }

  // for each required field, make sure the message has the field.
  for (let i = 0; i < REQUIRED_MESSAGE_FIELDS.length; i++) {
    const field = REQUIRED_MESSAGE_FIELDS[i];
    // if not, remove the raw message from the queue, as it is malformed.
    if (!hasOne(msg, field)) return e.ref.remove();
  }

  // for each field in the message, verify that the key is allowed.
  // if the key is not allowed, it is extraneous, and should be removed.
  Object.keys(msg).forEach((k) => {
    if (Object.hasOwnProperty.call(msg, k) && !ALLOWED_MESSAGE_FIELDS.includes(k)) delete msg[k];
  });

  // add the time received, if the providing plugin did not populate it.
  if (msg.timeReceived) {
    msg.timestamp = msg.timeReceived;
    delete msg.timeReceived;
  } else if (!msg.timestamp) {
    msg.timestamp = Date.now();
  }

  // Is this an outgoing message?
  const outgoing = Object.hasOwnProperty.call(msg, 'target');
  if (outgoing) {
    msg.cid = msg.target;
    delete msg.target;
  }

  // Set some defaults
  msg.direction = outgoing ? 'out' : 'in';
  msg.type = msg.type || 'text';

  // Is this an internal message?
  if (msg.type.toLowerCase() === 'internal' || msg.type.toLowerCase() === 'akpacket') {
    msg.type = 'internal'; // force a standardized type
    return rootRef.child(`clients/${msg.cid}`).push(msg).then(() => e.ref.remove());
  }

  // push the message into the messages queue and remove it from the raw messages queue.
  return rootRef.child('messages').push(msg).then(() => {
    if (outgoing) {
      rootRef.child(`clients/${msg.cid}`).push(msg);
    }
  }).then(() => e.ref.remove());
}

function hasOne(object, array) {
  if (!Array.isArray(array)) array = [array];
  let count = 0;
  for (let i = 0; i < array.length; i++) {
    const key = array[i];
    const objectHasKey = Object.hasOwnProperty.call(object, key);
    if (objectHasKey && object[key] !== null && object[key] !== undefined) {
      count += 1;
    }
  }
  return count === 1;
}
