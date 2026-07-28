const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfirmationEmailRecipients } = require('../src/emailRecipients');

test('getConfirmationEmailRecipients includes the admin inbox as a CC recipient', () => {
  const recipients = getConfirmationEmailRecipients('customer@example.com', ['admin@example.com', 'ops@example.com']);

  assert.deepEqual(recipients.to, ['customer@example.com']);
  assert.deepEqual(recipients.cc, ['admin@example.com', 'ops@example.com']);
});

test('getConfirmationEmailRecipients skips the customer address in CC list', () => {
  const recipients = getConfirmationEmailRecipients('customer@example.com', ['customer@example.com', 'admin@example.com']);

  assert.deepEqual(recipients.to, ['customer@example.com']);
  assert.deepEqual(recipients.cc, ['admin@example.com']);
});
