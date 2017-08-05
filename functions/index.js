const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Promise = require('bluebird');
const Rollbar = require('rollbar');
const crypto = require('crypto');

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

/**
 * Messages must have certain properties before they can be acted upon by the core and plugins.
 * This function ensures that any incoming messages include all required properties before being moved to the messages
 * queue.
 */
function processMessage(e, outgoing) {
  let msg = e.data.val();

  // if we don't have a message, just return.
  if(!msg) { return; }

  // for each required field, make sure the message has the field.
  for (let i = 0; i < REQUIRED_MESSAGE_FIELDS.length; i++) {
    let field = REQUIRED_MESSAGE_FIELDS[i];
    if(msg[field] === null || msg[field] === undefined) {
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

  // push the message into the messages queue and remove it from the raw messages queue.
  return rootRef.child('messages').push().set(msg).then(() => {
    if(outgoing) {
      return rootRef.child(`clients/${msg.cid}`).push().set(msg);
    }
  }).then(() => {
    return e.data.adminRef.remove();
  });
}

// Just calls processMessage with the outgoing flag set to true.
function processOutgoingMessage(e) {
  return processMessage(e, true);
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

function processGitHubWebhook(req, res) {
  rootRef.child('config/githubHookAlerts').once('value', (v) => {
    let config = v.val();

    let event_type = req.get('X-GitHub-Event');
    let signature = req.get('X-Hub-Signature');

    if(config.secret) {
      let computedSignature = `sha1=${crypto.createHmac("sha1", config.secret).update(JSON.stringify(req.body)).digest("hex")}`;
      if(!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
        return res.send(400);
      }
    }

    res.send(200);

    let content;

    if(GitHubEvents[event_type]) {
      content = GitHubEvents[event_type](req.body);
    } else {
      content = GitHubEvents.default(event_type, req.body);
    }

    if(!content) {
      return;
    }

    let response = {
      uid: 'BasedAKP48Core',
      text: content.txt,
      msgType: 'chatMessage',
      timeReceived: Date.now(),
      extra_client_info: content.extra || null
    }

    let respPromises = [];

    for (let client in config.alertClients) {
      if (config.alertClients.hasOwnProperty(client)) {
        let c = config.alertClients[client];
        c.channels.forEach((chan) => {
          let r = Object.assign({}, response);
          r.cid = c.client;
          r.channel = chan;
          respPromises.push(rootRef.child('outgoingMessages').push().set(r));
        });
      }
    }

    return Promise.all(respPromises);
  });
}

exports.processIncomingChatMessage = functions.database.ref('/incomingMessages/{pushId}').onWrite(processMessage);
exports.processOutgoingChatMessage = functions.database.ref('/outgoingMessages/{pushId}').onWrite(processOutgoingMessage);
exports.incrementMessageCounter = functions.database.ref('/messages/{pushId}').onWrite(incrementCounter);
exports.github = functions.https.onRequest(processGitHubWebhook);

const GitHubEvents = {
  push: (e) => {
    fields = [];
    if(e.head_commit) {
      e.head_commit.added = e.head_commit.added.map(s => `+${s}`);  
      e.head_commit.removed = e.head_commit.removed.map(s => `-${s}`);
      e.head_commit.modified = e.head_commit.modified.map(s => `!${s}`); 
      fields = [
        {
          name: "Hash",
          value: e.head_commit.id.slice(0, 7),
          inline: false
        },
        {
          name: "Message",
          value: e.head_commit.message,
          inline: false
        },
        {
          name: "Author",
          value: `${e.head_commit.author.username} <${e.head_commit.author.email}>`,
          inline: false
        },
        {
          name: "Committer",
          value: `${e.head_commit.committer.username} <${e.head_commit.committer.email}>`,
          inline: false
        },
        {
          name: "Changes",
          value: `${'```diff\n'}${e.head_commit.added.join('\n')}${'\n'}${e.head_commit.removed.join('\n')}${'\n'}${e.head_commit.modified.join('\n')}${'\n```'}`,
          inline: false
        }
      ];
    }
    
    let discord_embed = {
      title: "GitHub Push Event",
      description: `${e.commits.length} ${e.commits.length == 1 ? 'commit' : 'commits'} ${e.forced ? "force " : ""}pushed by [${e.sender.login}](${e.sender.html_url}) to ${e.created ? "new branch " : ""}[${e.ref.split('/').splice(2, Infinity).join('/')}](${e.compare}). ${fields.length ? 'Head commit:' : ''}`,
      url: e.head_commit.url,
      color: 0x4183c4,
      footer: {
        text: "Data via GitHub.",
        icon_url: "https://akp48.akpmakes.tech/img/github.com.png"
      },
      fields
    };
    return {txt: 'push event caught!', extra: { discord_embed }} ;
  },
  status: (e) => {
    return null;
  },
  default: (t, e) => {
    return {txt: t + ' event caught!'};
  }
}