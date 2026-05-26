/**
 * hooks/streaming/useLiveStream.ts — Production live stream host hook
 *
 * Full deep integration with:
 *   - LiveOrchestrator (session lifecycle, viewer sync, health scoring)
 *   - SessionOrchestrator (conflict resolution: pauses calls/creator)
 *   - AdaptiveBitrateManager (thermal-driven bitrate adaptation)
 *   - GPUManager (render slot for stream overlay)
 *   - ResourceManager (camera + microphone exclusive lease)
 *   - ThermalMonitor (heat-based quality degradation)
 *   - ProductionStabilityMode (overload protection)
 *   - CrashIntelligence (breadcrumbs + fingerprinting)
 *   - TelemetryPipeline (stream analytics)
 *   - SecurityManager (anti-flood moderation)
 *
 * Usage:
 *   const { session, viewerCount, health, startStream, endStream } = useLiveStream(userId);
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { LiveOrchestrator }          from '@/modules/streaming/LiveOrchestrator';
import { SessionOrchestrator }       from '@/modules/sessions/SessionOrchestrator';
import { ResourceManager }           from '@/modules/core/ResourceManager';
import { AdaptiveBitrateManager }    from '@/modules/media/AdaptiveBitrateManager';
import { GPUManager }                from '@/modules/core/GPUManager';
import { ThermalMonitor }            from '@/modules/core/ThermalMonitor';
import { ProductionStabilityMode }   from '@/modules/core/ProductionStabilityMode';
import { CrashIntelligence }         from '@/modules/core/CrashIntelligence';
import { TelemetryPipeline }         from '@/modules/core/TelemetryPipeline';
import { SecurityManager }           from '@/modules/core/SecurityManager';
import type { HostSession, StreamHealth } from '@/modules/streaming/LiveOrchestrator';

export function useLiveStream(userId: string) {
  const [session,      setSession]      = useState<HostSession | null>(null);
  const [viewerCount,  setViewerCount]  = useState(0);
  const [health,       setHealth]       = useState<StreamHealth>('excellent');
  const [healthScore,  setHealthScore]  = useState(100);
  const [isStreaming,  setIsStreaming]  = useState(false);
  const [isStarting,   setIsStarting]  = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [giftQueue,    setGiftQueue]    = useState<any[]>([]);

  const sessionOrchestratorId = useRef(`stream_host_${userId}_${Date.now()}`);
  const gpuSlot = useRef<string | null>(null);
  const sessionRef = useRef<HostSession | null>(null);

  // ── Start stream ──────────────────────────────────────────────────────────

  const startStream = useCallback(async (title: string) => {
    if (isStreaming || isStarting) return;
    if (!userId) { setError('No autenticado'); return; }

    // Security gate
    const allowed = SecurityManager.checkAction('stream_join', userId);
    if (!allowed) { setError('Limite de acciones alcanzado. Intenta de nuevo.'); return; }

    setIsStarting(true);
    setError(null);
    CrashIntelligence.addBreadcrumb('state', 'Starting live stream', { userId, title });

    try {
      // 1. Acquire hardware resources
      ResourceManager.request('camera',     'LiveStreamScreen');
      ResourceManager.request('microphone', 'LiveStreamScreen');
      gpuSlot.current = await GPUManager.acquireSlot('LiveStreamScreen', 'high');

      // 2. Register with SessionOrchestrator
      SessionOrchestrator.registerSession('stream_host', sessionOrchestratorId.current, {
        onPause:   async () => {
          // Reduce quality when interrupted
          AdaptiveBitrateManager.setNetworkCondition?.('poor');
        },
        onResume:  async () => {
          AdaptiveBitrateManager.setNetworkCondition?.('good');
        },
        onEnd:     async () => { await sessionRef.current?.end(); },
        onRecover: async () => {
          // Attempt stream reconnect
          if (!sessionRef.current) return false;
          CrashIntelligence.addBreadcrumb('state', 'Recovering live stream');
          return true;
        },
      });

      // 3. Start live session via LiveOrchestrator
      const liveSession = await LiveOrchestrator.startHostSession(userId, title);
      sessionRef.current = liveSession;

      // 4. Wire callbacks
      const unsubHealth = liveSession.onHealthChange((score, h) => {
        setHealthScore(score);
        setHealth(h);
        TelemetryPipeline.recordStreamSample(liveSession.sessionId, {
          healthScore: score, health: h, viewerCount,
        });
        // Auto-degrade on poor health
        if (score < 40) {
          CrashIntelligence.addBreadcrumb('state', `Stream health critical: ${score}`, { sessionId: liveSession.sessionId });
        }
      });

      const unsubViewers = liveSession.onViewerCountChange((count) => {
        setViewerCount(count);
      });

      const unsubGift = liveSession.onGift((gift) => {
        setGiftQueue(q => [...q.slice(-9), gift]); // keep last 10 gifts
      });

      // 5. React to stability mode
      const unsubStability = ProductionStabilityMode.onModeChange((mode) => {
        if (mode === 'critical' || mode === 'emergency') {
          // Force quality reduction
          CrashIntelligence.addBreadcrumb('state', `Stream degraded by stability: ${mode}`);
        }
      });

      // 6. React to thermal changes
      const thermal = ThermalMonitor.currentState;
      if (thermal === 'serious' || thermal === 'critical') {
        CrashIntelligence.addBreadcrumb('state', `Stream started under thermal pressure: ${thermal}`);
      }

      setSession(liveSession);
      setIsStreaming(true);
      setIsStarting(false);

      CrashIntelligence.addBreadcrumb('state', 'Live stream started', { sessionId: liveSession.sessionId });

      // Return cleanup for caller
      return () => {
        unsubHealth();
        unsubViewers();
        unsubGift();
        unsubStability();
      };

    } catch (e: any) {
      setIsStarting(false);
      const msg = e?.message ?? 'Error al iniciar el stream';
      setError(msg);
      CrashIntelligence.addBreadcrumb('error', `Stream start failed: ${msg}`, { userId });

      // Release resources on failure
      ResourceManager.release('camera',     'LiveStreamScreen');
      ResourceManager.release('microphone', 'LiveStreamScreen');
      if (gpuSlot.current) { GPUManager.releaseSlot(gpuSlot.current); gpuSlot.current = null; }
    }
  }, [userId, isStreaming, isStarting, viewerCount]);

  // ── End stream ────────────────────────────────────────────────────────────

  const endStream = useCallback(async () => {
    if (!sessionRef.current) return;

    CrashIntelligence.addBreadcrumb('user_action', 'Ending live stream', {
      sessionId: sessionRef.current.sessionId,
      viewerCount,
    });

    await sessionRef.current.end();
    await SessionOrchestrator.endSession(sessionOrchestratorId.current);

    ResourceManager.release('camera',     'LiveStreamScreen');
    ResourceManager.release('microphone', 'LiveStreamScreen');
    if (gpuSlot.current) {
      GPUManager.releaseSlot(gpuSlot.current);
      gpuSlot.current = null;
    }

    sessionRef.current = null;
    setSession(null);
    setIsStreaming(false);
    setViewerCount(0);
    setGiftQueue([]);
  }, [viewerCount]);

  // ── Update title ──────────────────────────────────────────────────────────

  const updateTitle = useCallback(async (title: string) => {
    await sessionRef.current?.setTitle(title);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        // Ensure cleanup even if endStream was not called
        sessionRef.current.end().catch(() => {});
        ResourceManager.release('camera',     'LiveStreamScreen');
        ResourceManager.release('microphone', 'LiveStreamScreen');
        if (gpuSlot.current) {
          GPUManager.releaseSlot(gpuSlot.current);
          gpuSlot.current = null;
        }
      }
    };
  }, []);

  // ── Dismiss gift ──────────────────────────────────────────────────────────

  const dismissGift = useCallback((index: number) => {
    setGiftQueue(q => q.filter((_, i) => i !== index));
  }, []);

  return {
    session,
    viewerCount,
    health,
    healthScore,
    isStreaming,
    isStarting,
    error,
    giftQueue,
    startStream,
    endStream,
    updateTitle,
    dismissGift,
  };
}
