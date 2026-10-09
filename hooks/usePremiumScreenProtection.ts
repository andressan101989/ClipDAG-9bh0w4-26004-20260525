import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import {
  appSwitcherProtectionCoordinator,
  configureAppSwitcherProtectionModule,
} from '@/services/screenProtectionCoordinator.mjs';

export type PremiumScreenProtectionState = 'arming' | 'protected' | 'failed';

export interface PremiumScreenProtectionResult {
  state: PremiumScreenProtectionState;
  retry: () => void;
}

configureAppSwitcherProtectionModule(ScreenCapture);

let nextProtectionInstance = 0;

export function usePremiumScreenProtection(
  scopeId: string,
  enabled = true,
): PremiumScreenProtectionResult {
  const instanceRef = useRef<number | null>(null);
  if (instanceRef.current === null) {
    nextProtectionInstance += 1;
    instanceRef.current = nextProtectionInstance;
  }
  const [attempt, setAttempt] = useState(0);
  const owner = useMemo(
    () => `premium-viewer:${scopeId}:${instanceRef.current}:${attempt}`,
    [scopeId, attempt],
  );
  const captureKey = useMemo(
    () => `creator-premium-viewer:${scopeId}:${instanceRef.current}:${attempt}`,
    [scopeId, attempt],
  );
  const [state, setState] = useState<PremiumScreenProtectionState>('arming');
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    let active = true;
    let captureArmed = false;
    let switcherArmed = false;

    const release = async () => {
      if (switcherArmed) {
        try {
          await appSwitcherProtectionCoordinator.release(owner);
        } catch {
          // A failed final native disable keeps the coordinator claim for a safe retry.
        }
        switcherArmed = false;
      }
      if (captureArmed) {
        try {
          await ScreenCapture.allowScreenCaptureAsync(captureKey);
        } catch {
          // Releasing a keyed lock must not expose media because the screen is already covered.
        }
        captureArmed = false;
      }
    };

    const arm = async () => {
      setState('arming');
      try {
        if (!enabled || !await ScreenCapture.isAvailableAsync()) {
          throw new Error('screen_protection_unavailable');
        }
        await ScreenCapture.preventScreenCaptureAsync(captureKey);
        captureArmed = true;
        if (!active) {
          await release();
          return;
        }
        if (Platform.OS === 'ios') {
          await appSwitcherProtectionCoordinator.acquire(owner);
          switcherArmed = true;
        }
        if (!active) {
          await release();
          return;
        }
        setState('protected');
      } catch {
        await release();
        if (active) setState('failed');
      }
    };

    void arm();
    return () => {
      active = false;
      void release();
    };
  }, [attempt, captureKey, enabled, owner]);

  return { state, retry };
}
