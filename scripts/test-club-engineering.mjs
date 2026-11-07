import assert from 'node:assert/strict';
import { screenGeometry, feedbackSample, brakeAccuracy, reactionOutcome } from '../public/club-engineering.js';

for (const inches of [49, 55, 65]) {
  const screen = screenGeometry(inches, 80);
  assert.ok(Math.abs(Math.hypot(screen.width, screen.height) / 2.54 - inches) < 1e-10);
  assert.ok(Math.abs(screen.width / screen.height - (inches === 49 ? 32 / 9 : 16 / 9)) < 1e-10);
  assert.ok(screenGeometry(inches, 50).horizontal > screenGeometry(inches, 140).horizontal);
}
assert.ok(screenGeometry(55).width > screenGeometry(49).width, '49 inch 32:9 is slightly narrower than 55 inch 16:9');
assert.ok(screenGeometry(49).vertical < screenGeometry(55).vertical);
assert.ok(Math.abs(screenGeometry(55).horizontal - 74.56) < .1);
for (const surface of ['asphalt', 'kerb', 'slide']) {
  for (let i = 0; i < 500; i++) {
    assert.ok(Math.abs(feedbackSample(i / 91, surface, 1)) <= 1);
    assert.equal(Math.abs(feedbackSample(i / 91, surface, 0)), 0);
    assert.ok(Math.abs(feedbackSample(i / 91, surface, .5) * 2 - feedbackSample(i / 91, surface, 1)) < 1e-12);
  }
}
assert.ok(brakeAccuracy(63, 65).within);
assert.ok(brakeAccuracy(67, 65).within);
assert.equal(brakeAccuracy(68, 65).within, false);
assert.equal(brakeAccuracy(61, 65).direction, 'more');
assert.equal(brakeAccuracy(80, 65).direction, 'less');
assert.equal(reactionOutcome('waiting', 0, 3000).kind, 'false');
assert.equal(reactionOutcome('countdown', 0, 3000).kind, 'false');
assert.equal(reactionOutcome('idle', 0, 3000).kind, 'ignore');
assert.equal(reactionOutcome('done', 0, 3000).kind, 'ignore');
assert.equal(reactionOutcome('go', 3000, 3070).kind, 'anticipation');
assert.deepEqual(reactionOutcome('go', 3000, 3250), { kind: 'valid', milliseconds: 250 });
console.log(JSON.stringify({ result: 'PASS', geometry: 'Exact diagonal/aspect/FOV', signal: 'Bounded and proportional', braking: 'Tolerance and direction', reaction: 'False start, anticipation and elapsed time' }));
