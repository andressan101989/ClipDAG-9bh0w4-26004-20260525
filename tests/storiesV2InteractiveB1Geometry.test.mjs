import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const loadTs = async path => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`);
const geometry = await loadTs('../components/feature/storyStageGeometry.ts');

test('projection and inversion use the actual measured full-media stage', () => {
  const stage = { width: 390, height: 844, safeInsets: { top: 59, right: 0, bottom: 34, left: 0 } };
  const point = { x: 0.27, y: 0.63 };
  const projected = geometry.projectStoryStagePoint(point, stage);
  assert.deepEqual(geometry.invertStoryStagePoint(projected, stage), point);
  assert.ok(Math.abs(projected.x - 105.3) < 1e-10);
  assert.ok(Math.abs(projected.y - 531.72) < 1e-10);
});

test('rotation-aware half extents are exact at 0, 45 and 90 degrees', () => {
  assert.deepEqual(geometry.storyRotatedHalfExtents({ width: 100, height: 40 }, 1, 0), { x: 50, y: 20 });
  const fortyFive = geometry.storyRotatedHalfExtents({ width: 100, height: 40 }, 1, 45);
  assert.ok(Math.abs(fortyFive.x - 49.49747468305833) < 1e-10);
  assert.ok(Math.abs(fortyFive.y - 49.49747468305832) < 1e-10);
  const ninety = geometry.storyRotatedHalfExtents({ width: 100, height: 40 }, 1, 90);
  assert.ok(Math.abs(ninety.x - 20) < 1e-10);
  assert.ok(Math.abs(ninety.y - 50) < 1e-10);
});

test('rotation-aware clamp keeps the measured element inside safe stage chrome', () => {
  const stage = { width: 400, height: 800, safeInsets: { top: 80, right: 20, bottom: 120, left: 20 } };
  for (const rotation of [0, 45, 90]) {
    const clamped = geometry.clampStoryElementTransform(
      { x: -2, y: 9, scale: 1, rotation },
      { width: 100, height: 40 },
      stage,
    );
    const extents = geometry.storyRotatedHalfExtents({ width: 100, height: 40 }, clamped.scale, rotation);
    const projected = geometry.projectStoryStagePoint(clamped, stage);
    assert.ok(projected.x >= 20 + extents.x && projected.x <= 380 - extents.x);
    assert.ok(projected.y >= 80 + extents.y && projected.y <= 680 - extents.y);
  }
});

test('scale and rotation normalize and compact frames remain finite', () => {
  assert.equal(geometry.clampStoryScale(0), 0.5);
  assert.equal(geometry.clampStoryScale(9), 4);
  assert.equal(geometry.normalizeStoryRotation(181), -179);
  assert.equal(geometry.normalizeStoryRotation(-181), 179);
  const tiny = geometry.clampStoryElementTransform(
    { x: 0, y: 1, scale: 4, rotation: 45 },
    { width: 200, height: 100 },
    { width: 44, height: 44, safeInsets: { top: 20, right: 20, bottom: 20, left: 20 } },
  );
  assert.ok(Object.values(tiny).every(Number.isFinite));
  assert.deepEqual({ x: tiny.x, y: tiny.y }, { x: 0.5, y: 0.5 });
});

test('same persisted transform projects responsively without mutation', () => {
  const persisted = Object.freeze({ x: 0.2, y: 0.8, scale: 1.2, rotation: -35 });
  const phone = geometry.projectStoryElementTransform(persisted, { width: 390, height: 844, safeInsets: {} });
  const tablet = geometry.projectStoryElementTransform(persisted, { width: 1024, height: 768, safeInsets: {} });
  assert.ok(Math.abs(phone.x - 78) < 1e-10 && Math.abs(phone.y - 675.2) < 1e-10);
  assert.ok(Math.abs(tablet.x - 204.8) < 1e-10 && Math.abs(tablet.y - 614.4) < 1e-10);
  assert.deepEqual({ scale: phone.scale, rotation: phone.rotation }, { scale: 1.2, rotation: -35 });
  assert.deepEqual(persisted, { x: 0.2, y: 0.8, scale: 1.2, rotation: -35 });
});

test('viewer read-time fit keeps a rotated six-option card inside phone safe bounds without mutating tablet composition', () => {
  const persisted = Object.freeze({ x: 0.92, y: 0.9, scale: 4, rotation: 35 });
  const measuredSixOptionCard = { width: 260, height: 400 };
  const phone = {
    width: 320,
    height: 568,
    safeInsets: geometry.createStoryStageSafeInsets(
      { top: 47, right: 0, bottom: 21, left: 0 },
      { top: 92, bottom: 104 },
    ),
  };
  const fitted = geometry.fitStoryElementTransform(persisted, measuredSixOptionCard, phone);
  const projected = geometry.projectStoryElementTransform(fitted, phone);
  const extents = geometry.storyRotatedHalfExtents(measuredSixOptionCard, fitted.scale, fitted.rotation);
  assert.ok(fitted.scale < persisted.scale && fitted.scale >= 0.5);
  assert.ok(projected.x - extents.x >= phone.safeInsets.left - 1e-9);
  assert.ok(projected.x + extents.x <= phone.width - phone.safeInsets.right + 1e-9);
  assert.ok(projected.y - extents.y >= phone.safeInsets.top - 1e-9);
  assert.ok(projected.y + extents.y <= phone.height - phone.safeInsets.bottom + 1e-9);
  assert.deepEqual(persisted, { x: 0.92, y: 0.9, scale: 4, rotation: 35 });
});

test('editor and viewers derive canonical safe insets from shared system and chrome inputs', () => {
  assert.deepEqual(
    geometry.createStoryStageSafeInsets(
      { top: 59, right: 7, bottom: 34, left: 3 },
      { top: 115, bottom: 122, padding: 8 },
    ),
    { top: 123, right: 8, bottom: 130, left: 8 },
  );
});

test('two-finger gesture updates centroid, scale and rotation from one snapshot', () => {
  const result = geometry.deriveStoryGestureTransform(
    { x: 0.5, y: 0.5, scale: 1, rotation: 10 },
    [{ x: 100, y: 100 }, { x: 200, y: 100 }],
    [{ x: 120, y: 120 }, { x: 220, y: 220 }],
    { width: 400, height: 800, safeInsets: {} },
  );
  assert.ok(Math.abs(result.x - 0.55) < 1e-12);
  assert.ok(Math.abs(result.y - 0.5875) < 1e-12);
  assert.ok(Math.abs(result.scale - Math.SQRT2) < 1e-12);
  assert.equal(result.rotation, 55);
});

test('array order is the only z-order and reordering preserves identities', () => {
  const layers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(geometry.reorderStoryLayer(layers, 'a', 'front').map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(geometry.reorderStoryLayer(layers, 'c', 'back').map(item => item.id), ['c', 'a', 'b']);
  assert.deepEqual(layers.map(item => item.id), ['a', 'b', 'c']);
});
