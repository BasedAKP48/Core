const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Promise = require('bluebird');
const crypto = require('crypto');

// Reference to the root of our database, for convenience.
const rootRef = admin.database().ref();
const GitHubEvents = {
  push: (e) => {
    let description = e.commits.map((c) => {
      let msg = c.message.split('\n')[0];
      return `[\`${c.id.slice(0, 7)}\`](${c.url}) | "${msg}" - [${c.committer.username}](https://github.com/${c.committer.username})`;
    });
    let discord_embed = {
      title: `[${e.repository.full_name}:${e.ref.split('/').splice(2, Infinity).join('/')}] ${e.commits.length} new ${e.commits.length == 1 ? 'commit' : 'commits'}${e.forced ? ' FORCE PUSHED' : ''}`,
      description: description.join('\n'),
      url: e.compare,
      color: 0x4183c4,
      author: {
        name: e.sender.login,
        url: e.sender.html_url,
        icon_url: e.sender.avatar_url
      },
      footer: {
        text: "Data via GitHub.",
        icon_url: "https://akp48.akpmakes.tech/img/github.com.png"
      }
    };
    return {txt: 'push event caught!', extra: { discord_embed }} ;
  },
  commit_comment: (e) => {
    return null;
  },
  create: (e) => {
    return null;
  },
  delete: (e) => {
    return null;
  },
  deployment: (e) => {
    return null;
  },
  deployment_status: (e) => {
    return null;
  },
  fork: (e) => {
    return null;
  },
  gollum: (e) => {
    return null;
  },
  installation: (e) => {
    return null;
  },
  installation_repositories: (e) => {
    return null;
  },
  integration_installation: (e) => {
    return null;
  },
  integration_installation_repositories: (e) => {
    return null;
  },
  issue_comment: (e) => {
    return null;
  },
  issues: (e) => {
    return null;
  },
  label: (e) => {
    return null;
  },
  marketplace_purchase: (e) => {
    return null;
  },
  member: (e) => {
    return null;
  },
  membership: (e) => {
    return null;
  },
  milestone: (e) => {
    return null;
  },
  organization: (e) => {
    return null;
  },
  org_block: (e) => {
    return null;
  },
  page_build: (e) => {
    return null;
  },
  project_card: (e) => {
    return null;
  },
  project_column: (e) => {
    return null;
  },
  project: (e) => {
    return null;
  },
  public: (e) => {
    return null;
  },
  pull_request_review_comment: (e) => {
    return null;
  },
  pull_request_review: (e) => {
    return null;
  },
  pull_request: (e) => {
    return null;
  },
  repository: (e) => {
    return null;
  },
  release: (e) => {
    return null;
  },
  status: (e) => {
    return null;
  },
  team: (e) => {
    return null;
  },
  team_add: (e) => {
    return null;
  },
  watch: (e) => {
    return null;
  },
  default: (t, e) => {
    return {txt: t + ' event caught!'};
  }
}

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

module.exports = functions.https.onRequest(processGitHubWebhook);
