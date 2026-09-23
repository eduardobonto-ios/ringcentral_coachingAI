// Tests for day-sample selection.
//
// Pure, so it needs no RingCentral and no database. What it protects is not arithmetic but a
// claim: the day summary says it describes a day, and it can only honestly do that if the calls
// it read are spread across one. Run: npm test (from server/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spreadSample } from './dailyCoaching.js';

const day = (n: number) => Array.from({ length: n }, (_, i) => i);

test('a day with fewer calls than the limit is taken whole', () => {
  assert.deepEqual(spreadSample(day(3), 5), [0, 1, 2]);
  assert.deepEqual(spreadSample(day(5), 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(spreadSample([], 5), []);
});

test('a sample spans the whole day, not just its start', () => {
  // The failure this guards against is taking the first five calls of a shift and describing
  // them as the day — the morning is not the day.
  const picked = spreadSample(day(22), 5);
  assert.equal(picked.length, 5);
  assert.equal(picked[0], 0, 'should include the first call');
  assert.equal(picked.at(-1), 21, 'should include the last call');
  assert.ok(picked[2] > 8 && picked[2] < 13, `middle pick ${picked[2]} should be near the middle of the day`);
});

test('picks are distinct, so the sample is as wide as it claims', () => {
  for (const n of [6, 7, 11, 22, 60]) {
    const picked = spreadSample(day(n), 5);
    assert.equal(new Set(picked).size, 5, `n=${n} produced a duplicate pick`);
  }
});

test('picks stay in order, so the summary sees the day as it happened', () => {
  const picked = spreadSample(day(22), 5);
  assert.deepEqual(picked, [...picked].sort((a, b) => a - b));
});

test('degenerate limits do not throw', () => {
  assert.deepEqual(spreadSample(day(10), 1), [0]);
  assert.deepEqual(spreadSample(day(10), 0), []);
  assert.deepEqual(spreadSample(day(10), -1), []);
});

test('a limit larger than the day returns every call once', () => {
  const picked = spreadSample(day(4), 99);
  assert.deepEqual(picked, [0, 1, 2, 3]);
});
