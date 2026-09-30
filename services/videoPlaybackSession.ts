export type VideoViewExitReason = 'swipe' | 'background' | 'unmount' | 'unknown' | 'ended';

export interface FinalizedVideoView {
  clientEventId: string;
  watchDurationMs: number;
  exitReason: VideoViewExitReason;
}

export interface VideoPlaybackSession {
  start(): string;
  finish(exitReason: VideoViewExitReason): FinalizedVideoView | null;
  activeEventId(): string | null;
}

interface VideoPlaybackSessionOptions {
  now: () => number;
  createEventId: () => string;
}

export function createVideoPlaybackSession({
  now,
  createEventId,
}: VideoPlaybackSessionOptions): VideoPlaybackSession {
  let active: { clientEventId: string; startedAtMs: number } | null = null;

  return {
    start() {
      if (!active) {
        active = {
          clientEventId: createEventId(),
          startedAtMs: now(),
        };
      }
      return active.clientEventId;
    },

    finish(exitReason) {
      if (!active) return null;
      const finalized = {
        clientEventId: active.clientEventId,
        watchDurationMs: Math.round(Math.max(0, now() - active.startedAtMs)),
        exitReason,
      } satisfies FinalizedVideoView;
      active = null;
      return finalized;
    },

    activeEventId() {
      return active?.clientEventId ?? null;
    },
  };
}
