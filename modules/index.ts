/**
 * modules/index.ts — Master barrel for all ClipDAG feature modules
 *
 * Import from here instead of digging into module internals:
 *
 *   import { EventBus, PollingManager, UploadQueue } from '@/modules';
 *   import { CallManager, useCallState }             from '@/modules';
 *   import { StreamManager, useStreamState }         from '@/modules';
 *   import { AppLifecycle, Perf }                    from '@/modules';
 *
 * Module directory:
 *
 *   modules/core/        — EventBus, AppLifecycle, PerformanceMonitor
 *   modules/realtime/    — PollingManager (no WebSocket needed)
 *   modules/media/       — UploadQueue, CacheManager
 *   modules/calls/       — CallManager, useCallState
 *   modules/streaming/   — StreamManager, useStreamState
 *   modules/battle/      — BattleManager
 *
 * FUTURE MODULES (add when implementing):
 *   modules/gaming/      — MiniGame launcher, score board
 *   modules/ai/          — AI pipeline, prompt templates, model selector
 *   modules/webrtc/      — WebRTC peer connection pool (when WC unblocked)
 */

// ── Core infrastructure ───────────────────────────────────────────────────────
export { EventBus, AppLifecycle, Perf } from './core';
export type { AppEvents, AppEventName, AppEventPayload } from './core';

// ── Realtime ──────────────────────────────────────────────────────────────────
export { PollingManager } from './realtime';
export type { PollConfig } from './realtime';

// ── Media ─────────────────────────────────────────────────────────────────────
export { UploadQueue, CacheManager } from './media';
export type { UploadJob, UploadState, UploadStatus } from './media';

// ── Calls ─────────────────────────────────────────────────────────────────────
export { CallManager, useCallState } from './calls';
export type { CallType, CallStatus, CallSession } from './calls';

// ── Streaming ─────────────────────────────────────────────────────────────────
export { StreamManager, useStreamState } from './streaming';
export type { StreamStatus, LiveSession, StreamGift } from './streaming';

// ── Battle ────────────────────────────────────────────────────────────────────
export { BattleManager } from './battle';
export type { BattleStatus, BattleScore, Battle } from './battle';
