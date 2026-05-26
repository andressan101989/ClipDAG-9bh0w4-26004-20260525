/**
 * hooks/gaming/useMultiplayer.ts — React hook for multiplayer game rooms
 *
 * Wraps MultiplayerEngine for React components:
 *   - Join/leave room lifecycle with auto-cleanup on unmount
 *   - Subscribe to room state updates
 *   - Dispatch game events with AntiCheat validation
 *   - Real-time latency estimation
 *
 * Usage:
 *   const { state, dispatch, leave } = useMultiplayer(roomId, userId);
 *   dispatch({ type: 'tap', payload: { x, y } });
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { MultiplayerEngine } from '@/modules/gaming/MultiplayerEngine';
import type { RoomState, GameEventType, SyncPriority } from '@/modules/gaming/MultiplayerEngine';

export function useMultiplayer(roomId: string | null, userId: string | null) {
  const [state,      setState]      = useState<RoomState | null>(null);
  const [connected,  setConnected]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const roomRef = useRef<Awaited<ReturnType<typeof MultiplayerEngine.joinRoom>> | null>(null);

  useEffect(() => {
    if (!roomId || !userId) return;

    let cancelled = false;

    MultiplayerEngine.joinRoom(roomId, userId).then(room => {
      if (cancelled) { room.leave(); return; }
      roomRef.current = room;
      setConnected(true);
      setState(room.state);

      room.onStateUpdate(s => setState({ ...s }));
      room.onError(msg => setError(msg));
    }).catch(e => {
      if (!cancelled) setError(e?.message ?? 'Failed to join room');
    });

    return () => {
      cancelled = true;
      roomRef.current?.leave();
      roomRef.current = null;
      setConnected(false);
    };
  }, [roomId, userId]);

  const dispatch = useCallback((
    type:     GameEventType,
    payload:  Record<string, any> = {},
    priority: SyncPriority = 'normal',
  ) => {
    roomRef.current?.dispatch({ type, payload }, priority);
  }, []);

  const leave = useCallback(async () => {
    await roomRef.current?.leave();
    roomRef.current = null;
    setConnected(false);
  }, []);

  return { state, connected, error, dispatch, leave };
}
