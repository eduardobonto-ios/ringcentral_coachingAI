// Tests for the day-index maths: Manila calendar arithmetic, and counting a call log per agent.
//
// Both are pure, so they run against the same fixtures as ringcentralMap.test.ts with no
// RingCentral credentials and no database. Run: npm test (from server/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayWindow, monthWindow, manilaDayOf, recentDays } from './manilaDay.js';
import { countByExtension, isStale } from './callDayIndex.js';
import { extensionIndex } from './ringcentralMap.js';
import type { RcCallRecord, RcExtension } from './ringcentral.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));

const callLog = load('call-log.json') as { records: RcCallRecord[] };
const extensions: RcExtension[] = (load('extensions.json').records as any[])
  .filter((r) => r.contact?.email)
  .map((r) => ({
    id: String(r.id),
    extensionNumber: String(r.extensionNumber),
    name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(' '),
    email: r.contact.email,
    jobTitle: r.contact.jobTitle || undefined,
  }));

// --- Manila calendar arithmetic ----------------------------------------------------------

test('a day window starts at Manila midnight, not UTC midnight', () => {
  const { from, to } = dayWindow('2026-09-23');
  // 00:00 +08:00 is 16:00 the previous day in UTC. Getting this wrong shifts every count by
  // eight hours, which silently moves early-morning calls onto the day before.
  assert.equal(from, '2026-09-22T16:00:00.000Z');
  assert.equal(to, '2026-09-23T16:00:00.000Z');
});

test('an invalid date is rejected rather than silently coerced', () => {
  assert.throws(() => dayWindow('23-09-2026'), /Invalid date/);
  assert.throws(() => dayWindow(''), /Invalid date/);
});

test('a call just before Manila midnight belongs to that Manila day', () => {
  // 15:59 UTC is 23:59 Manila the same evening; one minute later it is the next day.
  assert.equal(manilaDayOf('2026-09-23T15:59:00.000Z'), '2026-09-23');
  assert.equal(manilaDayOf('2026-09-23T16:00:00.000Z'), '2026-09-24');
});

test('month windows cover every day, including a leap February', () => {
  assert.equal(monthWindow('2026-09').days.length, 30);
  assert.equal(monthWindow('2026-02').days.length, 28);
  assert.equal(monthWindow('2024-02').days.length, 29);
  assert.equal(monthWindow('2026-12').days.at(-1), '2026-12-31');
});

test('a month window brackets the whole month in Manila time', () => {
  const { from, to } = monthWindow('2026-09');
  assert.equal(from, '2026-08-31T16:00:00.000Z');
  assert.equal(to, '2026-09-30T16:00:00.000Z');
});

test('an invalid month is rejected', () => {
  assert.throws(() => monthWindow('2026-9'), /Invalid month/);
  assert.throws(() => monthWindow('2026-09-01'), /Invalid month/);
});

test('recentDays counts back inclusively and crosses a month boundary', () => {
  assert.deepEqual(recentDays('2026-09-23', 3), ['2026-09-21', '2026-09-22', '2026-09-23']);
  assert.deepEqual(recentDays('2026-10-02', 3), ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(recentDays('2026-09-23', 1), ['2026-09-23']);
});

// --- counting a call log -----------------------------------------------------------------

test('counting attributes calls to agents the same way the listing does', () => {
  const counts = countByExtension(callLog.records, extensionIndex(extensions));

  // Every counted extension resolves to a real agent with an email, so a count can always be
  // scoped to a viewer when the calendar reads it back.
  for (const [id, { extension, count }] of counts) {
    assert.equal(extension.id, id);
    assert.ok(extension.email, `extension ${id} counted without an email`);
    assert.ok(count > 0);
  }
});

test('counting ignores exactly what isCoachable() ignores', () => {
  const byExtension = extensionIndex(extensions);
  const total = [...countByExtension(callLog.records, byExtension).values()].reduce((n, c) => n + c.count, 0);

  // Short calls, unrecorded calls and non-Voice records must not inflate the badge: a day shown
  // as "9 calls" that opens to 3 coachable ones is worse than showing nothing.
  const coachableWithAgent = callLog.records.filter(
    (r) => (r.duration ?? 0) >= 90 && r.recording?.contentUri && (!r.type || r.type === 'Voice'),
  );
  assert.ok(total <= coachableWithAgent.length);
  assert.ok(total > 0, 'the fixture should contain at least one coachable call');
});

test('a call whose extension is not on the roster is dropped, not counted as unknown', () => {
  // Matches visibleTo(): a call with no identifiable agent has nobody for the coaching to be
  // about, so it must not show up as a coachable call on anyone's calendar.
  const counts = countByExtension(callLog.records, new Map());
  assert.equal(counts.size, 0);
});

test('two calls by the same agent land in one row, not two', () => {
  const byExtension = extensionIndex(extensions);
  const one = callLog.records.find((r) => (r.duration ?? 0) >= 90 && r.recording?.contentUri)!;
  const counts = countByExtension([one, { ...one, id: `${one.id}-dup` }], byExtension);

  assert.equal(counts.size, 1);
  assert.equal([...counts.values()][0].count, 2);
});

// --- freshness of today -------------------------------------------------------------------

test('a day with no rows at all is stale', () => {
  assert.equal(isStale([], '2026-09-24'), true);
  assert.equal(isStale([{ day: '2026-09-23', indexed_at: new Date().toISOString() }], '2026-09-24'), true);
});

test('a day indexed just now is fresh', () => {
  assert.equal(isStale([{ day: '2026-09-24', indexed_at: new Date().toISOString() }], '2026-09-24'), false);
});

test('a day indexed this morning is stale by the working afternoon', () => {
  // The case that motivated this: the 02:10 cron writes a near-empty count for a day that has
  // barely started, and without expiry that zero would read as "no calls" until tomorrow.
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
  assert.equal(isStale([{ day: '2026-09-24', indexed_at: twoHoursAgo }], '2026-09-24'), true);
});

test('freshness follows the newest row, not the first', () => {
  const rows = [
    { day: '2026-09-24', indexed_at: new Date(Date.now() - 3 * 3600_000).toISOString() },
    { day: '2026-09-24', indexed_at: new Date().toISOString() },
  ];
  assert.equal(isStale(rows, '2026-09-24'), false);
});

test('an unparseable timestamp counts as stale rather than fresh', () => {
  assert.equal(isStale([{ day: '2026-09-24', indexed_at: 'not a date' }], '2026-09-24'), true);
});
