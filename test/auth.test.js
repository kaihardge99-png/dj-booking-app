const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { findUserByIdentifier } = require('../src/userAuth');

test('findUserByIdentifier matches usernames and emails case-insensitively', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      email TEXT,
      password TEXT
    );
    INSERT INTO users (username, email, password) VALUES ('Delirious', 'delirious@example.com', 'hash');
  `);

  const byUsername = await findUserByIdentifier(db, 'delirious');
  assert.equal(byUsername.username, 'Delirious');
  assert.equal(byUsername.email, 'delirious@example.com');

  const byEmail = await findUserByIdentifier(db, 'DELIRIOUS@EXAMPLE.COM');
  assert.equal(byEmail.id, 1);
});
