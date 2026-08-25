import { useCallback } from 'react';
import type { LiveBattle, LiveBattleInviteDecision } from '@/services/liveBattleService';
import type {
  LiveBattleRuntimeContext,
  LiveBattleRuntimeSnapshot,
} from '@/services/liveBattleRuntimeController';

type UseLiveBattleRelayRuntimeParams = LiveBattleRuntimeContext & {
  getEngine: () => unknown;
  registerBeforeEngineRelease: (listener: (engine: unknown) => void) => () => void;
};

/** Web fallback: it never requests Battle tokens and never claims relay support. */
export function useLiveBattleRelayRuntime(_params: UseLiveBattleRelayRuntimeParams) {
  const stop = useCallback(async () => undefined, []);
  const snapshot: LiveBattleRuntimeSnapshot = {
    status: 'idle', battleId: null, version: null, errorCode: null, battle: null,
  };
  const invite = useCallback(async (_input: {
    opponentUserId: string;
    challengerSessionId: string;
    opponentSessionId: string;
  }): Promise<LiveBattle | null> => null, []);
  const respond = useCallback(async (
    _battleId: string,
    _decision: LiveBattleInviteDecision,
  ): Promise<LiveBattle | null> => null, []);
  const battleAction = useCallback(async (_battleId: string): Promise<LiveBattle | null> => null, []);
  return {
    stop,
    supported: false as const,
    snapshot,
    actionPending: false,
    actionError: null,
    invite,
    respond,
    start: battleAction,
    cancel: battleAction,
    reconcile: stop,
    clearActionError: () => undefined,
    dismissTerminalBattle: () => undefined,
  };
}
