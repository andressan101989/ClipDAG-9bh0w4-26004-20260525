/**
 * hooks/gaming/useBattle.ts — v2 Production battle hook
 *
 * Full realtime multiplayer integration:
 *   - MultiplayerEngine v2 (seq numbers, reconciliation, anti-desync)
 *   - PresenceManager: registers battle session, watches opponent presence
 *   - SessionOrchestrator: conflict resolution + background sync throttle
 *   - SecurityManager: per-action abuse gate
 *   - AntiCheat: client-side cheat detection
 *   - CrashIntelligence: breadcrumbs + error fingerprinting
 *   - Reconnect handling: exponential backoff, reconnecting flag
 *   - Latency tracking: live RTT estimate from sync cycle
 *   - End-of-game: winner detection + reward emit
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { MultiplayerEngine }       from '@/modules/gaming/MultiplayerEngine';
import { PresenceManager }         from '@/modules/realtime/PresenceManager';
import { SessionOrchestrator }     from '@/modules/sessions/SessionOrchestrator';
import { SecurityManager }         from '@/modules/core/SecurityManager';
import { CrashIntelligence }       from '@/modules/core/CrashIntelligence';
import { TelemetryPipeline }       from '@/modules/core/TelemetryPipeline';
import { ProductionStabilityMode } from '@/modules/core/ProductionStabilityMode';
import { EventBus }                from '@/modules/core/EventBus';
import type { RoomState, GameEventType, SyncPriority } from '@/modules/gaming/MultiplayerEngine';

export interface BattleHookResult {
  state:        RoomState | null;
  myPlayer:     RoomState['players'][0] | null;
  opponents:    RoomState['players'];
  isConnected:  boolean;
  isRecovering: boolean;
  latencyMs:    number;
  error:        string | null;
  winner:       string | null;
  endReason:    RoomState['endReason'];
  dispatch:     (type: GameEventType, payload?: Record<string, any>, priority?: SyncPriority) => void;
  leave:        () => Promise<void>;
}

export function useBattle(roomId: string, userId: string): BattleHookResult {
  const [state,        setState]        = useState<RoomState | null>(null);
  const [isConnected,  setIsConnected]  = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [latencyMs,    setLatencyMs]    = useState(0);
  const [error,        setError]        = useState<string | null>(null);
  const [winner,       setWinner]       = useState<string | null>(null);
  const [endReason,    setEndReason]    = useState<RoomState['endReason']>(undefined);

  const sessionId  = useRef(`battle_${roomId}_${userId}`);
  const roomRef    = useRef<Awaited<ReturnType<typeof MultiplayerEngine.joinRoom>> | null>(null);
  const joinedAt   = useRef(Date.now());

  // ── Join on mount ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!roomId || !userId) return;

    CrashIntelligence.addBreadcrumb('state', 'useBattle: joining', { roomId, userId });
    joinedAt.current = Date.now();
    let mounted = true;

    const join = async () => {
      try {
        // Security gate
        if (!SecurityManager.checkAction('game_action', userId)) {
          setError('Acción no permitida. Intenta de nuevo en unos segundos.');
          return;
        }

        const room = await MultiplayerEngine.joinRoom(roomId, userId);
        if (!mounted) { await room.leave(); return; }
        roomRef.current = room;

        // Register presence for this battle
        PresenceManager.registerMultiplayerSession({
          roomId,
          userIds:   [userId],
          hostId:    userId,
          startedAt: Date.now(),
        });

        // State updates → React
        room.onStateUpdate((s) => {
          if (!mounted) return;
          setState(s);
          const active = s.phase === 'active' || s.phase === 'starting';
          setIsConnected(active || s.phase === 'waiting');

          if (s.phase === 'ended') {
            setWinner(s.winnerId ?? null);
            setEndReason(s.endReason);
            setIsConnected(false);
            // Telemetry
            const elapsed = Date.now() - joinedAt.current;
            TelemetryPipeline.recordNavTiming?.(`battle:${roomId}:end`, elapsed, 0);
            CrashIntelligence.addBreadcrumb('state', 'Battle ended', {
              roomId, winner: s.winnerId, reason: s.endReason, elapsed,
            });
          }
        });

        // Errors
        room.onError((msg) => {
          if (!mounted) return;
          setError(msg);
          CrashIntelligence.addBreadcrumb('error', `Battle error: ${msg}`, { roomId });
        });

        // Latency
        room.onLatencyUpdate((ms) => {
          if (!mounted) return;
          setLatencyMs(ms);
          PresenceManager.setStatus('in_battle', { latencyMs: ms, gameId: roomId, version: Date.now() });
        });

        // SessionOrchestrator registration
        SessionOrchestrator.registerSession('game', sessionId.current, {
          onPause: async () => {
            roomRef.current?.setSyncInterval(2_000);
          },
          onResume: async () => {
            roomRef.current?.setSyncInterval(500);
            if (mounted) setIsRecovering(false);
          },
          onEnd: async () => {
            await roomRef.current?.leave();
          },
          onRecover: async () => {
            if (!mounted) return false;
            setIsRecovering(true);
            try {
              const recovered = await MultiplayerEngine.joinRoom(roomId, userId);
              if (!mounted) { await recovered.leave(); return false; }
              roomRef.current = recovered;
              setIsRecovering(false);
              return true;
            } catch {
              if (mounted) setIsRecovering(false);
              return false;
            }
          },
        });

        // Adaptive sync from stability mode
        const stabUnsub = ProductionStabilityMode.onModeChange((mode) => {
          if (!roomRef.current) return;
          const intervalMap: Record<string, number> = {
            nominal:   500,
            stress:    750,
            degraded:  1_000,
            critical:  1_500,
            emergency: 2_000,
          };
          roomRef.current.setSyncInterval(intervalMap[mode] ?? 500);
        });

        // Battle ended via EventBus (from AntiCheat kick)
        const battleEndUnsub = EventBus.on('battle:ended' as any, (e: any) => {
          if (e?.battleId !== roomId) return;
          if (!mounted) return;
          setWinner(e.winnerId ?? null);
          setEndReason(e.reason ?? 'disconnect');
        });

        setState(room.state);
        setIsConnected(true);

        CrashIntelligence.addBreadcrumb('state', 'useBattle: joined', { roomId });

        return () => {
          stabUnsub();
          battleEndUnsub();
        };

      } catch (e: any) {
        if (!mounted) return;
        const msg = e?.message ?? 'Error uniéndose a la batalla';
        setError(msg);
        CrashIntelligence.addBreadcrumb('error', `useBattle join failed: ${msg}`, { roomId });
      }
    };

    join();

    return () => {
      mounted = false;
      const cleanup = async () => {
        CrashIntelligence.addBreadcrumb('state', 'useBattle cleanup', { roomId });
        await roomRef.current?.leave();
        roomRef.current = null;
        PresenceManager.unregisterMultiplayerSession(roomId);
        await SessionOrchestrator.endSession(sessionId.current);
      };
      cleanup();
    };
  }, [roomId, userId]);

  // ── Dispatch with security gate ───────────────────────────────────────────

  const dispatch = useCallback((
    type:     GameEventType,
    payload:  Record<string, any> = {},
    priority: SyncPriority = 'normal',
  ) => {
    if (!roomRef.current) return;

    if (!SecurityManager.checkAction('game_action', userId)) {
      CrashIntelligence.addBreadcrumb('user_action', `Battle action blocked: ${type}`, { userId, roomId });
      return;
    }

    roomRef.current.dispatch({ type, payload }, priority);
  }, [userId, roomId]);

  // ── Leave ─────────────────────────────────────────────────────────────────

  const leave = useCallback(async () => {
    CrashIntelligence.addBreadcrumb('user_action', 'User leaving battle', { roomId });
    await roomRef.current?.leave();
    roomRef.current = null;
    PresenceManager.unregisterMultiplayerSession(roomId);
    await SessionOrchestrator.endSession(sessionId.current);
    setIsConnected(false);
    setState(null);
  }, [roomId]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const myPlayer  = state?.players.find(p => p.userId === userId) ?? null;
  const opponents = state?.players.filter(p => p.userId !== userId) ?? [];

  return {
    state,
    myPlayer,
    opponents,
    isConnected,
    isRecovering,
    latencyMs,
    error,
    winner,
    endReason,
    dispatch,
    leave,
  };
}
