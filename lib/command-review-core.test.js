import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('./command-review-core.js', import.meta.url), 'utf8');
const context = {Date, console};
vm.createContext(context);
vm.runInContext(source, context);
const core = context.CommandReviewCore;

function item(id, source = 'Briefing') {
  return {id, source, title: id + ' title', page: 'today', urgency: 'act', score: 88};
}

test('captures Morning 5 once and preserves its original handling state', () => {
  const first = core.captureDay({}, {morningFive: [item('a'), item('b', 'Radar')]}, '2026-08-16', '2026-08-16T01:00:00Z');
  assert.equal(first.changed, true);
  assert.equal(first.review.days['2026-08-16'].items.length, 2);
  assert.deepEqual(Array.from(first.review.days['2026-08-16'].items, row => row.rank), [1, 2]);

  const handled = core.setItemState(first.review, '2026-08-16', item('a'), 'acted', '2026-08-16T10:00:00Z');
  const second = core.captureDay(handled.review, {morningFive: [item('a'), item('b', 'Radar')]}, '2026-08-16', '2026-08-16T11:00:00Z');
  assert.equal(second.changed, false);
  assert.equal(second.review.days['2026-08-16'].items[0].state, 'acted');
});

test('does not count an empty Command Center as a captured review day', () => {
  const result = core.captureDay({}, {morningFive: []}, '2026-08-16', '2026-08-16T01:00:00Z');
  assert.equal(result.changed, false);
  assert.equal(result.review.days['2026-08-16'], undefined);
});

test('tracks an acted queue item outside Morning 5', () => {
  const result = core.setItemState({}, '2026-08-16', item('queue-only', 'Markets'), 'acted', '2026-08-16T05:00:00Z');
  const tracked = result.review.days['2026-08-16'].items[0];
  assert.equal(tracked.id, 'queue-only');
  assert.equal(tracked.morningFive, false);
  assert.equal(tracked.state, 'acted');
});

test('closing a day explicitly marks all remaining items ignored', () => {
  const captured = core.captureDay({}, {morningFive: [item('a'), item('b')]}, '2026-08-16', '2026-08-16T01:00:00Z');
  const reviewed = core.setItemState(captured.review, '2026-08-16', item('a'), 'reviewed', '2026-08-16T10:00:00Z');
  const closed = core.completeDay(reviewed.review, '2026-08-16', '2026-08-16T12:00:00Z');
  assert.ok(closed.review.days['2026-08-16'].completedAt);
  assert.deepEqual(Array.from(closed.review.days['2026-08-16'].items, row => row.state), ['reviewed', 'ignored']);
});

test('a new Morning 5 item reopens a previously closed review', () => {
  let review = core.captureDay({}, {morningFive: [item('a')]}, '2026-08-16', '2026-08-16T01:00:00Z').review;
  review = core.completeDay(review, '2026-08-16', '2026-08-16T12:00:00Z').review;
  const updated = core.captureDay(review, {morningFive: [item('a'), item('b')]}, '2026-08-16', '2026-08-16T13:00:00Z');
  assert.equal(updated.review.days['2026-08-16'].completedAt, '');
  assert.equal(updated.review.days['2026-08-16'].items[1].state, 'pending');
});

test('normalization bounds review history to 35 days', () => {
  const raw = {days: {}};
  for (let day = 1; day <= 40; day++) {
    const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
    raw.days[date] = {items: [item('item-' + day)]};
  }
  const normalized = core.normalizeReview(raw);
  assert.equal(Object.keys(normalized.days).length, 35);
  assert.equal(Object.keys(normalized.days)[0], '2026-01-06');
});

test('weekly summary measures discipline and only reports linked closed decision outcomes', () => {
  let review = core.captureDay({}, {morningFive: [item('decision-d1', 'Decisions'), item('brief-1')]}, '2026-08-16', '2026-08-16T01:00:00Z').review;
  review = core.setItemState(review, '2026-08-16', item('decision-d1', 'Decisions'), 'acted', '2026-08-16T08:00:00Z').review;
  review = core.completeDay(review, '2026-08-16', '2026-08-16T12:00:00Z').review;
  const summary = core.weeklySummary(review, [
    {id: 'd1', status: 'closed', outcome: 'win', beatBenchmark: true},
    {id: 'd2', status: 'closed', outcome: 'loss'}
  ], '2026-08-16');
  assert.equal(summary.capturedDays, 1);
  assert.equal(summary.completedDays, 1);
  assert.equal(summary.handlingRate, 100);
  assert.equal(summary.totals.acted, 1);
  assert.equal(summary.totals.ignored, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.outcomes)), {sample: 1, win: 1, loss: 0, scratch: 0, beatBenchmark: 1, missedBenchmark: 0});
});
