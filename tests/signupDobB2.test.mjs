import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLocalCalendarDate, signupErrorMessage, signupMetadata, validateSignupDob } from '../utils/signupDob.ts';

test('DOB input is required and serialized as a calendar date', () => {
  assert.equal(validateSignupDob(''), 'required');
  assert.equal(formatLocalCalendarDate(new Date(2008, 8, 20)), '2008-09-20');
  assert.equal(validateSignupDob('2008-09-20', new Date(2026, 8, 20)), null);
});

test('DOB input rejects malformed and future dates before submit', () => {
  const today = new Date(2026, 8, 20);
  for (const value of ['2008/09/20', '2008-02-30', '2008-99-01', 'abc']) {
    assert.equal(validateSignupDob(value, today), 'invalid');
  }
  assert.equal(validateSignupDob('2026-09-21', today), 'future');
});

test('client rejects under-13 signup for UX while accepting the exact 13th birthday', () => {
  const today = new Date(2026, 8, 20);
  assert.equal(validateSignupDob('2013-09-21', today), 'underage');
  assert.equal(validateSignupDob('2013-09-20', today), null);
  assert.equal(validateSignupDob('2008-09-20', today), null);
  assert.equal(validateSignupDob('2012-02-29', new Date(2025, 1, 28)), 'underage');
  assert.equal(validateSignupDob('2012-02-29', new Date(2025, 2, 1)), null);
  assert.equal(validateSignupDob('2013-09-20', new Date('2026-09-20T00:30:00Z')), null);
});

test('signup metadata keeps username and sends only the calendar DOB input', () => {
  assert.deepEqual(signupMetadata('nelyon_user', '2008-09-20'), {
    username: 'nelyon_user',
    date_of_birth: '2008-09-20',
  });
});

test('stable server age rejection has a clear Spanish message', () => {
  assert.match(signupErrorMessage('You must be at least 13 years old to create a Nelyon account.'), /13 años/);
  assert.equal(signupErrorMessage('Network error'), 'Network error');
});
