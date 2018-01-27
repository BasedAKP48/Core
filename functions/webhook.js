const functions = require('firebase-functions');
const admin = require('firebase-admin');
const parse = require('url').parse;

const root = admin.database().ref().child('webhooks');

function processWebhook(req, res) {
  console.log(req.path);
  const url = parse(req.url);
  const token = url.pathname;
  if (!token || token === '/') { // Called /webhook/ directly
    return res.send(400); // Bad request
  }

  return root.child(`tokens/${token}`)
    .once('value')
    .then((value) => {
      const listeners = value.val();
      if (!listeners) {
        res.send(400); // Bad request
        return null;
      }
      // HEAD's only need to resolve
      if (req.method === 'HEAD') {
        res.send(200);
        return null;
      }
      // We have listeners, send the data.
      const data = root.child('data').push();
      // Remove on disconnect
      data.onDisconnect().remove();
      // Set data
      data.set({
        body: req.body,
        headers: req.headers,
        method: req.method,
        query: req.query,
        timestamp: admin.database.ServerValue.TIMESTAMP,
      });
      // Tell listeners to listen for data
      Object.keys(listeners).forEach((CID) => {
        const key = value.ref.child(`${CID}/hooks/${data.key}`);
        key.onDisconnect().remove();
        key.set(true);
      });
      return data;
    })
    .then(data => new Promise((resolve) => {
      if (!data) {
        resolve();
        return;
      }
      // Listen for "status" update
      const hookStatus = data.child('status');
      // 504: Gateway timeout, after 5 seconds
      setTimeout(() => exit(504), 5000);
      hookStatus.on('value', (v2) => {
        const status = parseInt(v2.val(), 10);
        if (!status) return;
        // Send status
        exit(status);
      });

      function exit(status) {
        hookStatus.off('value');
        res.send(status);
        resolve(true);
      }
    }))
    // Wacky hack to trigger "onDisconnect"
    .then((goOffline) => {
      if (!goOffline) return;
      admin.database().goOffline();
      admin.database().goOnline();
    });
}

module.exports = functions.https.onRequest(processWebhook);
