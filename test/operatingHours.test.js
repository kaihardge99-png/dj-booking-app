const test = require('node:test');
const assert = require('node:assert/strict');
const { getOperatingHoursForDate, getWeeklyOpeningHours, getOperatingHoursLabel } = require('../src/operatingHours');

test('getOperatingHoursForDate returns the expected hours for each weekday', () => {
  assert.deepEqual(getOperatingHoursForDate('2026-07-27'), { open: 10, close: 17 });
  assert.deepEqual(getOperatingHoursForDate('2026-07-30'), { open: 10, close: 22 });
  assert.equal(getOperatingHoursForDate('2026-07-26'), null);
});

test('getWeeklyOpeningHours returns the weekly schedule summary', () => {
  const schedule = getWeeklyOpeningHours();
  assert.match(schedule, /Mon - Wed/);
  assert.match(schedule, /Thu - Fri/);
  assert.match(schedule, /Sat/);
  assert.match(schedule, /Sun/);
});

test('getOperatingHoursLabel formats the label correctly', () => {
  assert.equal(getOperatingHoursLabel({ open: 10, close: 17 }), '10:00 AM - 5:00 PM');
  assert.equal(getOperatingHoursLabel({ open: 10, close: 22 }), '10:00 AM - 10:00 PM');
});
