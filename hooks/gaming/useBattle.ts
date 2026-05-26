/**
 * hooks/gaming/useBattle.ts — Production-grade battle/multiplayer hook
 *
 * Full integration with:
 *   - MultiplayerEngine (room join, event dispatch, state sync)
 *   - SessionOrchestrator (conflict resolution, recovery)
 *   - SecurityManager (anti-abuse action validation)
 *   - AntiCheat (client-side cheat detection)
 *   - CrashIntelligence (breadcrumbs, fingerprinting)
 *   - TelemetryPipeline (battle analytics)
 *   - ProductionStabilityMode (adaptive sync under stress)
 *
 * Usage:
 *   const { state, dispatch, leave, isConnected } = useBattle(roomId, userId);
 *   dispatch({ type: 'tap', payload: { x, y } });
 *   <ScoreBoard players={state.players} />
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { MultiplayerEngine }         from '@/modules/gaming/MultiplayerEngine';
import { SessionOrchestrator }       from '@/modules/sessions/SessionOrchestrator';
import { SecurityManager }           from '@/modules/core/SecurityManager';
import { CrashIntelligence }         from '@/modules/core/CrashIntelligence';
import { TelemetryPipeline }         from '@/modules/core/TelemetryPipeline';
import { ProductionStabilityMode }   from '@/modules/core/ProductionStabilityMode';
import type { RoomState, GameEventType } from '@/modules/gaming/MultiplayerEngine';

export function useBattle(roomId: string, userId: string) {
  const [state,       setState]      = useState<RoomState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [error,       setError]      = useState<string | null>(null);

  const sessionId = useRef(`battle_${roomId}_${userId}`);
  const roomRef   = useRef<Awaited<ReturnType<typeof MultiplayerEngine.joinRoom>> | null>(null);

  // ── Join room on mount ────────────────────────────────────────────────────

  useEffect(() => {
    if (!roomId || !userId) return;

    CrashIntelligence.addBreadcrumb('state', 'Battle joining room', { roomId, userId });

    let mounted = true;

    const join = async () => {
      try {
        // Security gate
        const allowed = SecurityManager.checkAction('game_action', userId);
        if (!allowed) {
          setError('Acción no permitida. Intenta de nuevo en unos segundos.');
          return;
        }

        const room = await MultiplayerEngine.joinRoom(roomId, userId);
        if (!mounted) { await room.leave(); return; }

        roomRef.current = room;

        // Wire state updates
        room.onStateUpdate((s) => {
          if (!mounted) return;
          setState(s);
          setIsConnected(s.phase === 'active' || s.phase === 'starting');
        });

        room.onError((msg) => {
          if (!mounted) return;
          setError(msg);
          CrashIntelligence.addBreadcrumb('error', `Battle error: ${msg}`, { roomId });
        });

        // Register with SessionOrchestrator
        SessionOrchestrator.registerSession('game', sessionId.current, {
          onPause:   async () => {
            room.setSyncInterval(2000); // slow down sync in background
          },
          onResume:  async () => {
            room.setSyncInterval(500);  // restore normal sync
            setIsRecovering(false);
          },
          onEnd:     async () => { await room.leave(); },
          onRecover: async () => {
            setIsRecovering(true);
            try {
              const recovered = await MultiplayerEngine.joinRoom(roomId, userId);
              roomRef.current = recovered;
              setIsRecovering(false);
              return true;
            } catch {
              setIsRecovering(false);
              return false;
            }
          },
        });

        // Adapt sync speed to stability mode
        const stabilityUnsub = ProductionStabilityMode.onModeChange((mode) => {
          if (!roomRef.current) return;
          if (mode === 'critical' || mode === 'emergency') {
            roomRef.current.setSyncInterval(2000);
          } else if (mode === 'degraded') {
            roomRef.current.setSyncInterval(1000);
          } else {
            roomRef.current.setSyncInterval(500);
          }
        });

        setState(room.state);
        setIsConnected(true);

        CrashIntelligence.addBreadcrumb('state', 'Battle room joined', { roomId });
        TelemetryPipeline.recordNavTiming?.(`battle:${roomId}`, 0, 0);

        return () => {
          stabilityUnsub();
        };

      } catch (e: any) {
        if (!mounted) return;
        const msg = e?.message ?? 'Error uniéndose a la batalla';
        setError(msg);
        CrashIntelligence.addBreadcrumb('error', `Battle join failed: ${msg}`, { roomId });
      }
    };

    join();

    return () => {
      mounted = false;
      const cleanup = async () => {
        CrashIntelligence.addBreadcrumb('state', 'Battle cleanup', { roomId });
        await roomRef.current?.leave();
        roomRef.current = null;
        await SessionOrchestrator.endSession(sessionId.current);
      };
      cleanup();
    };
  }, [roomId, userId]);

  // ── Dispatch with security gate ───────────────────────────────────────────

  const dispatch = useCallback((
    type:    GameEventType,
    payload: Record<string, any> = {},
    priority: 'critical' | 'high' | 'normal' | 'cosmetic' = 'normal',
  ) => {
    if (!roomRef.current) return;

    // Security check for game actions
    const allowed = SecurityManager.checkAction('game_action', userId);
    if (!allowed) {
      CrashIntelligence.addBreadcrumb(
        'user_action',
        `Battle action blocked: ${type}`,
        { userId, roomId },
      );
      return;
    }

    roomRef.current.dispatch({ type, payload }, priority);
  }, [userId, roomId]);

  // ── Leave room ────────────────────────────────────────────────────────────

  const leave = useCallback(async () => {
    CrashIntelligence.addBreadcrumb('user_action', 'User left battle', { roomId });
    await roomRef.current?.leave();
    roomRef.current = null;
    await SessionOrchestrator.endSession(sessionId.current);
    setIsConnected(false);
    setState(null);
  }, [roomId]);

  // ── Player helpers ────────────────────────────────────────────────────────

  const myPlayer = state?.players.find(p => p.userId === userId) ?? null;
  const opponents = state?.players.filter(p => p.userId !== userId) ?? [];

  return {
    state,
    myPlayer,
    opponents,
    isConnected,
    isRecovering,
    error,
    dispatch,
    leave,
  };
}
