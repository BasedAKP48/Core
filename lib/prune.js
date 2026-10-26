const DAY = 24 * 60 * 60 * 1000;

module.exports = async function pruneExpired(messagesRef, { ttl, now = Date.now() }) {
  if (!(ttl > 0)) return 0;

  const snapshot = await messagesRef.orderByChild('timestamp').endAt(now - (ttl * DAY)).once('value');
  const removals = {};
  snapshot.forEach((child) => {
    removals[child.key] = null;
  });

  const count = Object.keys(removals).length;
  if (count) await messagesRef.update(removals);
  return count;
};
