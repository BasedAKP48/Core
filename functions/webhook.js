const functions = require('firebase-functions');
const admin = require('firebase-admin');

const root = admin.database().ref().child('webhooks');

function processWebhook(req, res) {
  const token = req.path;
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
        // We keep this one just in case someone doesn't delete their key (bad plugins!)
        key.onDisconnect().remove();
        key.set(true);
      });
      return data;
    })
    .then((data) => {
      if (!data) return;
      // Listen for "status" update
      const hookStatus = data.child('status');
      // 504: Gateway timeout, after 5 seconds
      setTimeout(() => exit(504), 5000);
      hookStatus.on('value', (value) => {
        const status = value.val();
        if (!parseInt(status, 10)) return;
        // Send raw status.
        exit(status);
      });

      function exit(status) {
        hookStatus.off('value');
        data.ref.remove();
        res.send(status);
      }
    })
    // Throw any random errors we shouldn't be getting to the console.
    .catch(e => console.error(e));
}

module.exports = functions.https.onRequest(processWebhook);
