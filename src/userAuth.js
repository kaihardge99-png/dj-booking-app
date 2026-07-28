function normalizeIdentifier(identifier) {
  return (identifier || '').trim().toLowerCase();
}

async function findUserByIdentifier(db, identifier) {
  const normalized = normalizeIdentifier(identifier);
  const stmt = db.prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?');
  const result = stmt.get(normalized, normalized);
  return result instanceof Promise ? result : Promise.resolve(result);
}

module.exports = {
  normalizeIdentifier,
  findUserByIdentifier,
};
