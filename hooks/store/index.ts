/**
 * hooks/store/index.ts — Reactive store hooks
 *
 * React hooks that subscribe to domain stores and return live state.
 * These replace direct useState + Context patterns for cross-screen state.
 *
 * Pattern:
 *   1. Store holds source of truth (singleton, no React)
 *   2. Hook subscribes with useState + useEffect
 *   3. Component uses hook — re-renders only when relevant slice changes
 */

import { useState, useEffect } from 'react';
import { AuthStore, AuthState }       from '@/store/auth.store';
import { CallStore, CallState }       from '@/store/call.store';
import { StreamStore, StreamState }   from '@/store/stream.store';
import { BattleStore, BattleState }   from '@/store/battle.store';
import { GameStore, GameState }       from '@/store/game.store';
import { MediaStore, MediaState }     from '@/store/media.store';

export function useAuthStore(): AuthState {
  const [state, setState] = useState<AuthState>(AuthStore.getState());
  useEffect(() => AuthStore.subscribe(setState), []);
  return state;
}

export function useCallStore(): CallState {
  const [state, setState] = useState<CallState>(CallStore.getState());
  useEffect(() => CallStore.subscribe(setState), []);
  return state;
}

export function useStreamStore(): StreamState {
  const [state, setState] = useState<StreamState>(StreamStore.getState());
  useEffect(() => StreamStore.subscribe(setState), []);
  return state;
}

export function useBattleStore(): BattleState {
  const [state, setState] = useState<BattleState>(BattleStore.getState());
  useEffect(() => BattleStore.subscribe(setState), []);
  return state;
}

export function useGameStore(): GameState {
  const [state, setState] = useState<GameState>(GameStore.getState());
  useEffect(() => GameStore.subscribe(setState), []);
  return state;
}

export function useMediaStore(): MediaState {
  const [state, setState] = useState<MediaState>(MediaStore.getState());
  useEffect(() => MediaStore.subscribe(setState), []);
  return state;
}
