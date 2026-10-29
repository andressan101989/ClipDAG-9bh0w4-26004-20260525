import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layer = readFileSync(new URL('../components/feature/StoryInteractiveLayer.tsx', import.meta.url), 'utf8');

test('one layer renders every server-defined interactive kind', () => {
  for (const kind of ['poll', 'slider', 'quiz', 'question', 'reaction']) {
    assert.match(layer, new RegExp(`definition\\.type === '${kind}'`));
  }
  assert.equal((layer.match(/export function StoryInteractiveLayer/g) ?? []).length, 1);
});

test('poll and quiz options send stable option ids while quiz correctness comes only from server state', () => {
  assert.match(layer, /option_id:\s*option\.id/);
  assert.match(layer, /correctOptionId/);
  assert.doesNotMatch(layer, /correct_option_id\s*:/, 'viewer must not manufacture the answer key');
});

test('slider uses a normalized value and question text is bounded before server validation', () => {
  assert.match(layer, /normalizeStorySliderValue/);
  assert.match(layer, /maxLength=\{500\}/);
  assert.match(layer, /value:\s*sliderValue/);
  assert.match(layer, /text:\s*current\.draft\.trim\(\)/);
});

test('interactive controls own responder gestures and expose accessible labels and states', () => {
  assert.match(layer, /onStartShouldSetResponder=\{\(\) => true\}/);
  assert.match(layer, /onTouchStart=\{\(\) => onInteractionFocus\(true\)\}/);
  assert.match(layer, /onTouchEnd=\{\(\) => onInteractionFocus\(false\)\}/);
  assert.match(layer, /accessibilityRole="button"/);
  assert.match(layer, /accessibilityState=/);
});

test('aggregate results are rendered from server state rather than client counters', () => {
  assert.match(layer, /elementState\.aggregate/);
  assert.doesNotMatch(layer, /set(?:Vote|Total|Count)s?\s*\(/);
});
