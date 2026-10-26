const assert = require('node:assert/strict');
const { test } = require('node:test');

const pruneExpired = require('../lib/prune');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25, 12);

const createMessages = (initial) => {
  const data = { ...initial };
  const queries = [];
  const updates = [];
  const ref = {
    orderByChild: child => ({
      endAt: cutoff => ({
        once: async () => {
          queries.push({ child, cutoff });
          const keys = Object.keys(data).filter((key) => {
            const value = data[key][child];
            return value === undefined || value === null || (typeof value === 'number' && value <= cutoff);
          });
          return {
            forEach: callback => keys.some(key => callback({ key, val: () => data[key] })),
          };
        },
      }),
    }),
    update: async (changes) => {
      updates.push(changes);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === null) delete data[key];
      });
    },
  };
  return {
    ref, data, queries, updates,
  };
};

test('messages older than the ttl are removed and newer ones are kept', async () => {
  const messages = createMessages({
    old: { timestamp: NOW - (8 * DAY) },
    older: { timestamp: NOW - (400 * DAY) },
    recent: { timestamp: NOW - (6 * DAY) },
    fresh: { timestamp: NOW - 1000 },
  });

  const removed = await pruneExpired(messages.ref, { ttl: 7, now: NOW });

  assert.equal(removed, 2);
  assert.deepEqual(Object.keys(messages.data).sort(), ['fresh', 'recent']);
});

test('messages with no timestamp are treated as expired', async () => {
  const messages = createMessages({
    legacy: { timeReceived: NOW - (1500 * DAY), text: 'from years ago' },
    nulled: { timestamp: null },
    current: { timestamp: NOW },
  });

  const removed = await pruneExpired(messages.ref, { ttl: 7, now: NOW });

  assert.equal(removed, 2);
  assert.deepEqual(Object.keys(messages.data), ['current']);
});

test('the query asks for the cutoff on the indexed timestamp', async () => {
  const messages = createMessages({});

  await pruneExpired(messages.ref, { ttl: 30, now: NOW });

  assert.deepEqual(messages.queries, [{ child: 'timestamp', cutoff: NOW - (30 * DAY) }]);
});

test('a fractional ttl is a part of a day', async () => {
  const messages = createMessages({});

  await pruneExpired(messages.ref, { ttl: 0.5, now: NOW });

  assert.equal(messages.queries[0].cutoff, NOW - (DAY / 2));
});

test('everything that expired goes in one update that only deletes', async () => {
  const messages = createMessages({
    a: { timestamp: 1 },
    b: { timestamp: 2 },
    c: { timestamp: NOW },
  });

  await pruneExpired(messages.ref, { ttl: 7, now: NOW });

  assert.deepEqual(messages.updates, [{ a: null, b: null }]);
});

test('nothing is written when nothing expired', async () => {
  const messages = createMessages({ fresh: { timestamp: NOW } });

  assert.equal(await pruneExpired(messages.ref, { ttl: 7, now: NOW }), 0);
  assert.deepEqual(messages.updates, []);
});

test('a ttl of zero, or anything that is not a positive number, turns pruning off', async () => {
  const messages = createMessages({ ancient: { timestamp: 1 } });

  const ttls = [0, -5, NaN, undefined, null, 'seven'];

  const results = await Promise.all(ttls.map(ttl => pruneExpired(messages.ref, { ttl, now: NOW })));

  assert.deepEqual(results, ttls.map(() => 0));
  assert.deepEqual(messages.queries, []);
  assert.deepEqual(messages.updates, []);
  assert.deepEqual(Object.keys(messages.data), ['ancient']);
});
