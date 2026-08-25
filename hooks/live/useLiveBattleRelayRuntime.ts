import { useCallback } from 'react';
import type { LiveBattleRuntimeContext } from '@/services/liveBattleRuntimeController';

type UseLiveBattleRelayRuntimeParams = LiveBattleRuntimeContext & {
  getEngine: () => unknown;
  registerBeforeEngineRelease: (listener: (engine: unknown) => void) => () => void;
};

/** Web fallback: it never requests Battle tokens and never claims relay support. */
export function useLiveBattleRelayRuntime(_params: UseLiveBattleRelayRuntimeParams) {
  const stop = useCallback(async () => undefined, []);
  return { stop, supported: false as const };
}
