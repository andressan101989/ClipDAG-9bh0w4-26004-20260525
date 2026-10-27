export const STORY_ELEMENT_MIN_SCALE = 0.5;
export const STORY_ELEMENT_MAX_SCALE = 4;

export interface StoryStageInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface StoryStageFrame {
  width: number;
  height: number;
  safeInsets?: StoryStageInsets;
}

export interface StoryStagePoint { x: number; y: number }
export interface StoryElementTransform extends StoryStagePoint { scale: number; rotation: number }
export interface StoryMeasuredElementFrame { width: number; height: number }

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export function clampStoryScale(scale: number): number {
  return clamp(finite(scale, 1), STORY_ELEMENT_MIN_SCALE, STORY_ELEMENT_MAX_SCALE);
}

export function normalizeStoryRotation(rotation: number): number {
  const normalized = ((finite(rotation, 0) + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function storyRotatedHalfExtents(
  frame: StoryMeasuredElementFrame,
  scale: number,
  rotation: number,
): StoryStagePoint {
  const radians = normalizeStoryRotation(rotation) * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const boundedScale = clampStoryScale(scale);
  const width = Math.max(0, finite(frame.width, 0));
  const height = Math.max(0, finite(frame.height, 0));
  return {
    x: boundedScale * (width * cosine + height * sine) / 2,
    y: boundedScale * (width * sine + height * cosine) / 2,
  };
}

export function projectStoryStagePoint(point: StoryStagePoint, stage: StoryStageFrame): StoryStagePoint {
  return {
    x: finite(point.x, 0.5) * Math.max(0, finite(stage.width, 0)),
    y: finite(point.y, 0.5) * Math.max(0, finite(stage.height, 0)),
  };
}

export function invertStoryStagePoint(point: StoryStagePoint, stage: StoryStageFrame): StoryStagePoint {
  const width = Math.max(0, finite(stage.width, 0));
  const height = Math.max(0, finite(stage.height, 0));
  return {
    x: width > 0 ? finite(point.x, width / 2) / width : 0.5,
    y: height > 0 ? finite(point.y, height / 2) / height : 0.5,
  };
}

export function projectStoryElementTransform(
  transform: StoryElementTransform,
  stage: StoryStageFrame,
): StoryElementTransform {
  return {
    ...projectStoryStagePoint(transform, stage),
    scale: clampStoryScale(transform.scale),
    rotation: normalizeStoryRotation(transform.rotation),
  };
}

function safeAxis(value: number, size: number, leading: number, trailing: number, extent: number): number {
  const minimum = Math.max(0, leading) + extent;
  const maximum = Math.max(0, size - Math.max(0, trailing) - extent);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) return size / 2;
  return clamp(value, minimum, maximum);
}

export function clampStoryElementTransform(
  transform: StoryElementTransform,
  measuredFrame: StoryMeasuredElementFrame,
  stage: StoryStageFrame,
): StoryElementTransform {
  const width = Math.max(0, finite(stage.width, 0));
  const height = Math.max(0, finite(stage.height, 0));
  const scale = clampStoryScale(transform.scale);
  const rotation = normalizeStoryRotation(transform.rotation);
  const extents = storyRotatedHalfExtents(measuredFrame, scale, rotation);
  const projected = projectStoryStagePoint(transform, { ...stage, width, height });
  const insets = stage.safeInsets ?? {};
  return {
    x: width > 0 ? safeAxis(projected.x, width, insets.left ?? 0, insets.right ?? 0, extents.x) / width : 0.5,
    y: height > 0 ? safeAxis(projected.y, height, insets.top ?? 0, insets.bottom ?? 0, extents.y) / height : 0.5,
    scale,
    rotation,
  };
}

function centroid(points: readonly StoryStagePoint[]): StoryStagePoint {
  if (points.length === 0) return { x: 0, y: 0 };
  return points.reduce(
    (result, point) => ({ x: result.x + point.x / points.length, y: result.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
}

function pointDistance(points: readonly StoryStagePoint[]): number {
  return points.length < 2 ? 0 : Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

function pointAngle(points: readonly StoryStagePoint[]): number {
  return points.length < 2 ? 0 : Math.atan2(
    points[1].y - points[0].y,
    points[1].x - points[0].x,
  ) * 180 / Math.PI;
}

export function deriveStoryGestureTransform(
  initial: StoryElementTransform,
  initialTouches: readonly StoryStagePoint[],
  currentTouches: readonly StoryStagePoint[],
  stage: StoryStageFrame,
): StoryElementTransform {
  const initialCentroid = centroid(initialTouches);
  const currentCentroid = centroid(currentTouches);
  const width = Math.max(1, finite(stage.width, 1));
  const height = Math.max(1, finite(stage.height, 1));
  const initialDistance = pointDistance(initialTouches);
  const currentDistance = pointDistance(currentTouches);
  const usesTwoTouches = initialTouches.length >= 2 && currentTouches.length >= 2 && initialDistance > 0;
  return {
    x: initial.x + (currentCentroid.x - initialCentroid.x) / width,
    y: initial.y + (currentCentroid.y - initialCentroid.y) / height,
    scale: usesTwoTouches ? clampStoryScale(initial.scale * currentDistance / initialDistance) : initial.scale,
    rotation: usesTwoTouches
      ? normalizeStoryRotation(initial.rotation + pointAngle(currentTouches) - pointAngle(initialTouches))
      : normalizeStoryRotation(initial.rotation),
  };
}

export function reorderStoryLayer<T extends { id: string }>(
  layers: readonly T[],
  id: string,
  destination: 'front' | 'back' | 'forward' | 'backward',
): T[] {
  const index = layers.findIndex(layer => layer.id === id);
  if (index < 0) return [...layers];
  const target = destination === 'front' ? layers.length - 1
    : destination === 'back' ? 0
      : destination === 'forward' ? Math.min(layers.length - 1, index + 1)
        : Math.max(0, index - 1);
  if (target === index) return [...layers];
  const next = [...layers];
  const [layer] = next.splice(index, 1);
  next.splice(target, 0, layer);
  return next;
}
