import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  subscribeToLiveBattlePublicState,
  type LiveBattlePublicState,
  type LiveBattleServerClockAnchor,
} from '@/services/liveBattleSpectatorService';
import {
  getLiveBattlePublicProfiles,
  type LiveBattlePublicProfile,
} from '@/services/liveBattleService';

export function useLiveBattleSpectatorState(
  sessionId: string | null | undefined,
  enabled: boolean,
) {
  const generationRef = useRef(0);
  const [state, setState] = useState<LiveBattlePublicState | null>(null);
  const [clockAnchor, setClockAnchor] = useState<LiveBattleServerClockAnchor | null>(null);
  const [profiles, setProfiles] = useState<Map<string, LiveBattlePublicProfile>>(new Map());
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    const generation = ++generationRef.current;
    setState(null);
    setClockAnchor(null);
    setProfiles(new Map());
    setErrorCode(null);
    if (!enabled || !sessionId) return;

    let subscription;
    try {
      subscription = subscribeToLiveBattlePublicState(
        sessionId,
        next => {
          if (generation !== generationRef.current) return;
          setState(next);
          setErrorCode(null);
        },
        error => {
          if (generation === generationRef.current) setErrorCode(error.code);
        },
        anchor => {
          if (generation === generationRef.current) setClockAnchor(anchor);
        },
      );
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'live_battle_public_unavailable';
      setErrorCode(code);
      return;
    }

    let previousAppState: AppStateStatus = AppState.currentState;
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      const returningToForeground = previousAppState !== 'active' && nextAppState === 'active';
      previousAppState = nextAppState;
      if (returningToForeground && generation === generationRef.current) {
        void subscription.reconcile();
      }
    });

    return () => {
      generationRef.current += 1;
      appStateSubscription.remove();
      void subscription.unsubscribe().catch(() => undefined);
    };
  }, [enabled, sessionId]);

  useEffect(() => {
    if (!state) {
      setProfiles(new Map());
      return;
    }
    const generation = generationRef.current;
    void getLiveBattlePublicProfiles([state.localHostUserId, state.opponentHostUserId])
      .then(rows => {
        if (generation === generationRef.current) {
          setProfiles(new Map(rows.map(row => [row.userId, row])));
        }
      })
      .catch(() => {
        if (generation === generationRef.current) setProfiles(new Map());
      });
  }, [state]);

  return {
    state,
    clockAnchor,
    errorCode,
    localHostProfile: state ? profiles.get(state.localHostUserId) ?? null : null,
    opponentHostProfile: state ? profiles.get(state.opponentHostUserId) ?? null : null,
  };
}
