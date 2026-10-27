import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compositionSource = read('../components/feature/storyComposition.tsx');
const interactiveSource = read('../components/feature/StoryInteractiveLayer.tsx');
const nativeViewerSource = read('../components/feature/StoryViewer.native.tsx');
const webViewerSource = read('../components/feature/StoryViewer.tsx');

const loadTs = async path => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(read(path), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`);

test('static text and stickers use measured read-time fit with the same viewer safe area', async () => {
  const geometry = await loadTs('../components/feature/storyStageGeometry.ts');
  const persisted = Object.freeze({ x: 0.95, y: 0.91, scale: 4, rotation: 47 });
  const splitPhone = {
    width: 320,
    height: 480,
    safeInsets: geometry.createStoryStageSafeInsets(
      { top: 47, right: 12, bottom: 21, left: 12 },
      { top: 92, bottom: 104 },
    ),
  };
  const measuredLongText = { width: 300, height: 220 };
  const fitted = geometry.fitStoryElementTransform(persisted, measuredLongText, splitPhone);
  const projected = geometry.projectStoryElementTransform(fitted, splitPhone);
  const extents = geometry.storyRotatedHalfExtents(measuredLongText, fitted.scale, fitted.rotation);

  assert.ok(fitted.scale < persisted.scale);
  assert.ok(projected.x - extents.x >= splitPhone.safeInsets.left - 1e-9);
  assert.ok(projected.x + extents.x <= splitPhone.width - splitPhone.safeInsets.right + 1e-9);
  assert.ok(projected.y - extents.y >= splitPhone.safeInsets.top - 1e-9);
  assert.ok(projected.y + extents.y <= splitPhone.height - splitPhone.safeInsets.bottom + 1e-9);
  assert.deepEqual(persisted, { x: 0.95, y: 0.91, scale: 4, rotation: 47 });

  assert.match(compositionSource, /fitStoryElementTransform/);
  assert.match(compositionSource, /projectStoryElementTransform/);
  assert.match(compositionSource, /onLayout=/);
  assert.match(compositionSource, /safeInsets:\s*StoryStageInsets/);
  assert.doesNotMatch(compositionSource, /left:\s*element\.x\s*\*\s*width/);
  for (const viewer of [nativeViewerSource, webViewerSource]) {
    assert.match(viewer, /<StoryCompositionOverlay[\s\S]*?safeInsets=\{interactiveStageInsets\}/);
  }
});

test('slider drag updates continuously but commits only on release', async () => {
  const runtime = await loadTs('../components/feature/storyViewerRuntime.ts');
  assert.equal(runtime.storySliderValueAt(-10, 200), 0);
  assert.equal(runtime.storySliderValueAt(75, 300), 0.25);
  assert.equal(runtime.storySliderValueAt(500, 200), 1);

  assert.match(interactiveSource, /PanResponder\.create/);
  assert.match(interactiveSource, /onPanResponderMove/);
  assert.match(interactiveSource, /onPanResponderRelease/);
  assert.match(interactiveSource, /onPanResponderTerminate/);
  const moveSection = interactiveSource.match(/onPanResponderMove:[\s\S]*?onPanResponderRelease:/)?.[0] ?? '';
  assert.doesNotMatch(moveSection, /onCommit|submit\(/, 'drag movement must remain local and bounded');
  const releaseSection = interactiveSource.match(/onPanResponderRelease:[\s\S]*?onPanResponderTerminate:/)?.[0] ?? '';
  assert.match(releaseSection, /onCommit/, 'release must submit one final normalized value');
});

test('slider exposes clamped adjustable increment and decrement actions', async () => {
  const runtime = await loadTs('../components/feature/storyViewerRuntime.ts');
  assert.equal(runtime.stepStorySliderValue(0.98, 'increment'), 1);
  assert.equal(runtime.stepStorySliderValue(0.02, 'decrement'), 0);
  assert.equal(runtime.stepStorySliderValue(0.5, 'increment'), 0.55);
  assert.equal(runtime.stepStorySliderValue(0.5, 'decrement'), 0.45);

  assert.match(interactiveSource, /accessibilityRole="adjustable"/);
  assert.match(interactiveSource, /accessibilityActions=\{\[/);
  assert.match(interactiveSource, /name:\s*'increment'/);
  assert.match(interactiveSource, /name:\s*'decrement'/);
  assert.match(interactiveSource, /onAccessibilityAction=/);
  assert.match(interactiveSource, /stepStorySliderValue/);
});
