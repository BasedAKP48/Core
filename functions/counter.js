const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Reference to the root of our database, for convenience.
const rootRef = admin.database().ref();

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

module.exports = functions.database.ref('/messages/{pushId}').onWrite(incrementCounter);
