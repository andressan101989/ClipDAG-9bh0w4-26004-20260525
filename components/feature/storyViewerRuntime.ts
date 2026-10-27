export interface StoryIdentity {
  id: string;
  createdAt?: string;
}

export type StoryNavigationDirection = 'previous' | 'next';

export function sortStoriesDeterministically<T extends StoryIdentity>(stories: readonly T[]): T[] {
  return [...stories].sort((left, right) => {
    const byTime = String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
    return byTime || right.id.localeCompare(left.id);
  });
}

export function resolveStoryAnchor<T extends Pick<StoryIdentity, 'id'>>(
  stories: readonly T[],
  requestedId: string | null | undefined,
  fallbackIndex: number,
): { id: string; index: number } | null {
  if (stories.length === 0) return null;
  const anchoredIndex = requestedId ? stories.findIndex(story => story.id === requestedId) : -1;
  const index = anchoredIndex >= 0
    ? anchoredIndex
    : Math.min(Math.max(Number.isInteger(fallbackIndex) ? fallbackIndex : 0, 0), stories.length - 1);
  return { id: stories[index].id, index };
}

export function storyNavigationTarget<T extends Pick<StoryIdentity, 'id'>>(
  stories: readonly T[],
  currentStoryId: string | null | undefined,
  direction: StoryNavigationDirection,
): string | null {
  if (!currentStoryId) return null;
  const index = stories.findIndex(story => story.id === currentStoryId);
  if (index < 0) return null;
  const target = direction === 'next' ? index + 1 : index - 1;
  return target >= 0 && target < stories.length ? stories[target].id : null;
}

export function isRealtimeRecoveryStatus(status: string): boolean {
  return status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED';
}

export function realtimeRetryDelay(attempt: number, jitterUnit = Math.random()): number {
  const boundedAttempt = Math.min(Math.max(Math.trunc(attempt), 0), 20);
  const base = Math.min(30_000, 1_000 * (2 ** boundedAttempt));
  const jitter = 0.75 + (Math.min(Math.max(jitterUnit, 0), 1) * 0.5);
  return Math.min(30_000, Math.round(base * jitter));
}

export function nextRealtimeRetry(
  attempt: number,
  jitterUnit = Math.random(),
): { attempt: number; delay: number } {
  const current = Math.max(0, Math.floor(Number.isFinite(attempt) ? attempt : 0));
  return { attempt: current + 1, delay: realtimeRetryDelay(current, jitterUnit) };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

export function storyInteractionPayloadKey(
  storyId: string,
  elementId: string,
  payload: object,
): string {
  return JSON.stringify([storyId, elementId, canonical(payload)]);
}

export function normalizeStorySliderValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function storySliderValueAt(locationX: number, width: number): number {
  const boundedWidth = Number.isFinite(width) && width > 0 ? width : 1;
  return normalizeStorySliderValue(locationX / boundedWidth);
}

export function stepStorySliderValue(
  value: number,
  direction: 'increment' | 'decrement',
  step = 0.05,
): number {
  const boundedStep = Number.isFinite(step) && step > 0 ? step : 0.05;
  const signedStep = direction === 'increment' ? boundedStep : -boundedStep;
  return normalizeStorySliderValue(Math.round((normalizeStorySliderValue(value) + signedStep) * 1_000_000) / 1_000_000);
}

export function shouldNavigateStory(input: {
  interactionFocused: boolean;
  holdTriggered: boolean;
}): boolean {
  return !input.interactionFocused && !input.holdTriggered;
}
