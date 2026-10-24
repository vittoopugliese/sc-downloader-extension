import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOMATION_PARAMETERS, automationEvents, automationValue, newAutomationClip, normalizeAutomationClip, retimeAutomation, scheduleAutomation, validateAutomation } from './stem-automation.mjs';

const target = { track: 'voice', param: 'gain' };
const point = (at, value, curve = 'linear') => ({ at, value, curve });
const clip = (at = 2, duration = 4, points = [point(0, 0), point(duration, 2)], extra = {}) => ({ id: `automation-${at}`, track: 'lane', target, at, duration, points, ...extra });
const tracks = [{ id: 'voice' }, { id: 'lane', kind: 'automation' }];

test('project validation rejects inert targets, missing channels, corrupt envelopes and duplicate clip IDs', () => {
  assert.equal(validateAutomation([clip()], tracks).length, 1);
  for (const change of [
    { target: { track: 'voice', param: 'fx.reverbDecay' } },
    { target: { track: 'lane', param: 'gain' } },
    { target: { track: 'missing', param: 'gain' } },
    { track: 'missing' }, { at: -1 }, { at: 299 }, { duration: 0 },
    { points: [point(0, 0), point(1, Infinity), point(4, 1)] },
    { points: [point(0, -1), point(4, 1)] },
    { points: [point(0, 0), point(2, 1), point(2, 2), point(4, 1)] },
    { points: [point(0, 0, 'other'), point(4, 1)] },
    { points: [point(1, 0), point(4, 1)] },
  ]) assert.throws(() => validateAutomation([clip(2, 4, undefined, change)], tracks));
  assert.throws(() => validateAutomation([clip(), clip()], tracks), /Invalid automation clip/);
  assert.doesNotThrow(() => validateAutomation([clip(2, 4, [point(0, 0), point(4, 100)], { target: { track: 'master', param: 'fx.reverb' } })], tracks));
  assert.equal(Object.values(AUTOMATION_PARAMETERS).filter(item => item.supported).length, 7);
});

test('new clips use physical knob values; normalizing sorts, clamps and retains endpoints without mutating', () => {
  const created = newAutomationClip({ id: 'new', track: 'lane', target, value: .75 });
  assert.deepEqual(created.points, [point(0, .75), point(4, .75)]);
  const input = clip(0, 4, [point(3, 99), point(1, -.4, 'hold'), point(1, .6), point(NaN, 1)]);
  const clean = normalizeAutomationClip(input);
  assert.deepEqual(clean.points, [point(0, .6), point(1, .6), point(3, 2), point(4, 2)]);
  assert.equal(input.points[0].value, 99);
});

test('seek evaluates linear and hold envelopes and resumes the knob baseline outside the clip', () => {
  const source = clip(2, 6, [point(0, 0), point(2, 1, 'hold'), point(4, .5), point(6, 1)]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(at => automationValue([source], target, at, .8)), [.8, 0, .5, 1, 1, .5, .75, .8]);
  assert.deepEqual(automationEvents([source], target, { from: 3, to: 7, baseline: .8 }), [
    { at: 3, value: .5, curve: 'set' }, { at: 4, value: 1, curve: 'linear' },
    { at: 6, value: .5, curve: 'set' }, { at: 7, value: .75, curve: 'linear' },
  ]);
});

test('event windows anchor ramps after silence and restore baseline at each clip end', () => {
  const a = clip(), b = clip(8, 2, [point(0, 1), point(2, 0)]);
  assert.deepEqual(automationEvents([a, b], target, { from: 0, to: 11, baseline: 1 }), [
    { at: 0, value: 1, curve: 'set' }, { at: 2, value: 0, curve: 'set' },
    { at: 6, value: 2, curve: 'linear' }, { at: 6, value: 1, curve: 'set' },
    { at: 8, value: 1, curve: 'set' }, { at: 10, value: 0, curve: 'linear' }, { at: 10, value: 1, curve: 'set' },
  ]);
  assert.deepEqual(automationEvents([], target, { from: 0, to: 1, baseline: .2 }), [{ at: 0, value: .2, curve: 'set' }]);
});

test('overlaps follow latest clip start, ties follow array order, muted clips never override', () => {
  const a = clip(0, 8, [point(0, 0), point(8, 2)]), b = clip(2, 2, [point(0, 1.5), point(2, 1.5)]);
  assert.deepEqual([1, 2, 3, 4, 6, 8].map(at => automationValue([b, a], target, at, 1)), [.25, 1.5, 1.5, 1, 1.5, 1]);
  assert.equal(automationValue([a, { ...b, mute: true }], target, 3, 1), .75);
  assert.equal(automationValue([b, { ...b, id: 'tie', points: [point(0, .4), point(2, .4)] }], target, 3, 1), .4);
  assert.deepEqual(automationEvents([a, b], target, { from: 1, to: 5, baseline: 1 }), [
    { at: 1, value: .25, curve: 'set' }, { at: 2, value: .5, curve: 'linear' }, { at: 2, value: 1.5, curve: 'set' },
    { at: 4, value: 1, curve: 'set' }, { at: 5, value: 1.25, curve: 'linear' },
  ]);
});

test('hold boundaries are steps, including seeking or ending a window precisely at a point', () => {
  const a = clip(0, 4, [point(0, .2, 'hold'), point(2, .8, 'hold'), point(4, 1)]);
  assert.deepEqual(automationEvents([a], target, { from: 1, to: 2, baseline: .5 }), [{ at: 1, value: .2, curve: 'set' }, { at: 2, value: .8, curve: 'set' }]);
  assert.deepEqual(automationEvents([a], target, { from: 2, to: 5, baseline: .5 }), [{ at: 2, value: .8, curve: 'set' }, { at: 4, value: .5, curve: 'set' }]);
});

test('AudioParam scheduling respects seek, transport rate, explicit cancellation and FX units', () => {
  const calls = [], param = {
    cancelScheduledValues: at => calls.push(['cancel', at]),
    setValueAtTime: (value, at) => calls.push(['set', value, at]),
    linearRampToValueAtTime: (value, at) => calls.push(['linear', value, at]),
  };
  const fxTarget = { track: 'voice', param: 'fx.reverb' }, fx = clip(2, 4, [point(0, 0), point(4, 100)], { target: fxTarget });
  scheduleAutomation(param, [fx], fxTarget, { from: 3, to: 6, when: 10, rate: 2, baseline: 35, scale: .01, cancel: true });
  assert.deepEqual(calls, [['cancel', 10], ['set', .25, 10], ['linear', 1, 11.5], ['set', .35000000000000003, 11.5]]);
  calls.length = 0;
  scheduleAutomation(param, [fx], fxTarget, { from: 2, to: 3, when: 20, baseline: 35 });
  assert.deepEqual(calls, [['set', 0, 20], ['linear', 25, 21]]);
});

test('tempo retiming preserves beat positions and values and does not mutate history snapshots', () => {
  const original = clip(), moved = retimeAutomation([original], .5)[0];
  assert.deepEqual([moved.at, moved.duration, ...moved.points.map(item => item.at)], [1, 2, 0, 2]);
  assert.equal(automationValue([moved], target, 2, 1), automationValue([original], target, 4, 1));
  moved.points[0].value = .2; assert.equal(original.points[0].value, 0);
  assert.throws(() => retimeAutomation([original], 0));
});
