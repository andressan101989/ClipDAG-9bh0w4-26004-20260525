import { useCallback, useEffect, useRef } from 'react';
import type { IRtcEngine } from 'react-native-agora';
import { LiveBattleRelayService } from '@/services/liveBattleRelayService';
import {
  LiveBattleRuntimeController,
  type LiveBattleRuntimeContext,
} from '@/services/liveBattleRuntimeController';

type UseLiveBattleRelayRuntimeParams = LiveBattleRuntimeContext & {
  getEngine: () => unknown;
  registerBeforeEngineRelease: (listener: (engine: unknown) => void) => () => void;
};

export function useLiveBattleRelayRuntime({
  liveSessionId,
  hostUserId,
  isCanonicalHost,
  isSessionLive,
  engineReady,
  joined,
  isForeground,
  getEngine,
  registerBeforeEngineRelease,
}: UseLiveBattleRelayRuntimeParams) {
  const controllerRef = useRef<LiveBattleRuntimeController | null>(null);
  const engine = joined ? getEngine() as IRtcEngine | null : null;

  useEffect(() => {
    if (!engine) return;
    const relay = new LiveBattleRelayService(engine);
    const controller = new LiveBattleRuntimeController({ relay });
    controllerRef.current = controller;
    const unregisterReleaseGuard = registerBeforeEngineRelease(() => {
      controller.handleEngineRelease();
    });

    return () => {
      unregisterReleaseGuard();
      controller.handleEngineRelease();
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller.dispose();
    };
  }, [engine, registerBeforeEngineRelease]);

  useEffect(() => {
    controllerRef.current?.updateContext({
      liveSessionId,
      hostUserId,
      isCanonicalHost,
      isSessionLive,
      engineReady,
      joined,
      isForeground,
    });
  }, [
    engine,
    engineReady,
    hostUserId,
    isCanonicalHost,
    isForeground,
    isSessionLive,
    joined,
    liveSessionId,
  ]);

  const stop = useCallback(async () => {
    await controllerRef.current?.stop();
  }, []);

  return { stop, supported: true as const };
}
