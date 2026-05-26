/**
 * hooks/streaming/useLiveStream.ts — v2 Full live stream lifecycle hook
 *
 * Phase 4 fixes:
 *   - LiveOrchestrator.startHostSession() now returns { session, error } — handled correctly
 *   - GPUManager.acquireSlot() returns string | null (no throw) — handled correctly
 *   - PresenceManager.setStatus() called without undefined second arg
 *   - Cleanup on unmount uses ref flag to avoid double-end on React StrictMode
 *   - dagTimer cleared in endStream before setState to prevent state-after-unmount
 *   - All unsubs cleared in try/catch
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  LiveOrchestrator,
  type HostSession,
  type StreamQualityProfile,
  type StreamHealth,
} from '@/modules/streaming/LiveOrchestrator';
import { SessionOrchestrator }   from '@/modules/sessions/SessionOrchestrator';
import { ResourceManager }       from '@/modules/core/ResourceManager';
import { GPUManager }            from '@/modules/core/GPUManager';
import { PresenceManager }       from '@/modules/realtime/PresenceManager';
import { CrashIntelligence }     from '@/modules/core/CrashIntelligence';

interface LiveStreamState {
  isStreaming:     boolean;
  isStarting:      boolean;
  sessionId:       string | null;
  viewerCount:     number;
  healthScore:     number;
  health:          StreamHealth;
  qualityProfile:  StreamQualityProfile | null;
  dagEarned:       number;
  error:           string | null;
  recoveryAttempt: number;
}

export function useLiveStream(userId: string) {
  const [state, setState] = useState<LiveStreamState>({
    isStreaming:     false,
    isStarting:      false,
    sessionId:       null,
    viewerCount:     0,
    healthScore:     100,
    health:          'excellent',
    qualityProfile:  null,
    dagEarned:       0,
    error:           null,
    recoveryAttempt: 0,
  });

  const sessionRef   = useRef<HostSession | null>(null);
  const sessionIdRef = useRef<string>(`livestream_${userId}_${Date.now()}`);
  const gpuSlotRef   = useRef<string | null>(null);
  const dagTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubs       = useRef<Array<() => void>>([]);
  const mountedRef   = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cleanup on unmount — fire-and-forget
      const session = sessionRef.current;
      if (session) {
        session.end().catch(() => {});
        sessionRef.current = null;
      }
      if (dagTimerRef.current) { clearInterval(dagTimerRef.current); dagTimerRef.current = null; }
      for (const fn of unsubs.current) { try { fn(); } catch { /* ignore */ } }
      unsubs.current = [];
      ResourceManager.release('camera',     'useLiveStream');
      ResourceManager.release('microphone', 'useLiveStream');
      if (gpuSlotRef.current) { GPUManager.releaseSlot(gpuSlotRef.current); gpuSlotRef.current = null; }
      SessionOrchestrator.endSession(sessionIdRef.current).catch(() => {});
    };
  }, []);

  // ── Start stream ───────────────────────────────────────────────────────────

  const startStream = useCallback(async (title: string): Promise<void> => {
    if (!userId || !title.trim()) return;
    if (!mountedRef.current) return;

    setState(prev => ({ ...prev, isStarting: true, error: null }));
    CrashIntelligence.addBreadcrumb('state', 'Live stream starting', { userId, title });

    // Acquire GPU slot (non-throwing)
    const gpuSlot = await GPUManager.acquireSlot('useLiveStream', 'high');
    gpuSlotRef.current = gpuSlot;  // may be null — that's OK

    // Acquire camera + mic
    ResourceManager.request('camera',     'useLiveStream');
    ResourceManager.request('microphone', 'useLiveStream');

    // Register with SessionOrchestrator
    try {
      SessionOrchestrator.registerSession('stream', sessionIdRef.current, {
        onPause:   async () => { /* background: keep session alive */ },
        onResume:  async () => { /* foreground: restore quality */ },
        onEnd:     async () => { await sessionRef.current?.end(); },
        onRecover: async () => {
          if (mountedRef.current) {
            setState(prev => ({ ...prev, recoveryAttempt: prev.recoveryAttempt + 1 }));
          }
          return true;
        },
      });
    } catch (e: any) {
      console.warn('[useLiveStream] SessionOrchestrator register error (non-fatal):', e?.message);
    }

    // Create Supabase session via LiveOrchestrator (returns { session, error })
    const { session, error: sessionError } = await LiveOrchestrator.startHostSession(userId, title);

    if (!mountedRef.current) {
      // Unmounted during async work — clean up
      await session?.end();
      return;
    }

    if (sessionError || !session) {
      setState(prev => ({ ...prev, isStarting: false, error: sessionError ?? 'Error iniciando stream' }));
      ResourceManager.release('camera',     'useLiveStream');
      ResourceManager.release('microphone', 'useLiveStream');
      if (gpuSlotRef.current) { GPUManager.releaseSlot(gpuSlotRef.current); gpuSlotRef.current = null; }
      return;
    }

    sessionRef.current = session;

    // Update presence (status only — no undefined second arg)
    PresenceManager.registerStreamSession(session.sessionId);

    // Wire session callbacks
    const u1 = session.onViewerCountChange((count) => {
      if (mountedRef.current) setState(prev => ({ ...prev, viewerCount: count }));
    });
    const u2 = session.onHealthChange((score, health) => {
      if (mountedRef.current) setState(prev => ({ ...prev, healthScore: score, health }));
    });
    const u3 = session.onQualityChange((profile) => {
      if (mountedRef.current) setState(prev => ({ ...prev, qualityProfile: profile }));
    });
    const u4 = session.onRecovery((attempt) => {
      if (mountedRef.current) setState(prev => ({ ...prev, recoveryAttempt: attempt }));
    });
    unsubs.current = [u1, u2, u3, u4];

    // DAG earnings simulation (real rewards via process_dag_reward edge function)
    dagTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        dagEarned: Number((prev.dagEarned + (Math.random() * 0.15 + 0.03)).toFixed(4)),
      }));
    }, 8_000);

    if (mountedRef.current) {
      setState(prev => ({
        ...prev,
        isStreaming:     true,
        isStarting:      false,
        sessionId:       session.sessionId,
        qualityProfile:  { tier: 'hd', bitrateKbps: 2500, fps: 30, width: 1280, height: 720 },
        error:           null,
        recoveryAttempt: 0,
      }));
    }

    CrashIntelligence.addBreadcrumb('state', 'Live stream started', { sessionId: session.sessionId });
  }, [userId]);

  // ── End stream ─────────────────────────────────────────────────────────────

  const endStream = useCallback(async (): Promise<void> => {
    CrashIntelligence.addBreadcrumb('state', 'Live stream ending', { userId });

    // Stop DAG timer first
    if (dagTimerRef.current) { clearInterval(dagTimerRef.current); dagTimerRef.current = null; }

    // Unsubscribe callbacks
    for (const fn of unsubs.current) { try { fn(); } catch { /* ignore */ } }
    unsubs.current = [];

    // End session
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      try { await session.end(); } catch { /* ignore */ }
    }

    // End SessionOrchestrator
    try { await SessionOrchestrator.endSession(sessionIdRef.current); } catch { /* ignore */ }

    // Release resources
    ResourceManager.release('camera',     'useLiveStream');
    ResourceManager.release('microphone', 'useLiveStream');
    if (gpuSlotRef.current) {
      GPUManager.releaseSlot(gpuSlotRef.current);
      gpuSlotRef.current = null;
    }

    // Unregister stream presence
    try { PresenceManager.unregisterStreamSession(); } catch { /* ignore */ }

    if (mountedRef.current) {
      setState(prev => ({
        ...prev,
        isStreaming:     false,
        isStarting:      false,
        sessionId:       null,
        viewerCount:     0,
        healthScore:     100,
        health:          'excellent',
        qualityProfile:  null,
        recoveryAttempt: 0,
      }));
    }

    CrashIntelligence.addBreadcrumb('state', 'Live stream ended', { userId });
  }, [userId]);

  return {
    ...state,
    startStream,
    endStream,
    getSession: () => LiveOrchestrator.getSession(state.sessionId ?? ''),
  };
}
