import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const effect = readFileSync(
  new URL('../components/feature/StoryReactionEffect.tsx', import.meta.url),
  'utf8',
);

test('the first fullscreen reaction mounts its animated nodes before the effect starts', () => {
  assert.doesNotMatch(effect, /if \(!visible \|\| !reaction\) return null/);
  assert.doesNotMatch(effect, /setVisible\(/);
  assert.match(effect, /if \(!reaction\) return null/);
  assert.match(effect, /Animated\.timing\(progress/);
  assert.match(effect, /animation\.start\(/);
});

test('the corrective remains presentation-only and preserves deterministic cleanup', () => {
  assert.match(effect, /pointerEvents="none"/);
  assert.match(effect, /animationRef\.current\?\.stop\(\)/);
  assert.match(effect, /progress\.stopAnimation\(\)/);
  assert.match(effect, /generationRef\.current \+= 1/);
  assert.doesNotMatch(effect, /supabase|postgres_changes|setStoryReaction|chat/i);
});
