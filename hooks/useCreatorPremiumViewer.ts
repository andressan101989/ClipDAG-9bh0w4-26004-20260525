import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { usePremiumScreenProtection } from '@/hooks/usePremiumScreenProtection';
import {
  getCurrentCreatorPremiumUserId,
  getMyCreatorPremiumEntitlement,
} from '@/services/creatorPremiumService';
import { getCreatorPremiumOriginalImageGrant } from '@/services/creatorPremiumMediaService';
import { getCreatorPremiumVideoPlaybackGrant } from '@/services/creatorPremiumStreamService';
import {
  createCreatorPremiumRenewalScheduler,
  createCreatorPremiumViewerController,
  type CreatorPremiumViewerSnapshot,
} from '@/services/creatorPremiumViewerRuntime.mjs';
import { getSupabaseClient } from '@/template';

const EMPTY_SNAPSHOT: CreatorPremiumViewerSnapshot = {
  status: 'idle',
  reason: null,
  userId: null,
  contentId: null,
  generation: 0,
  entitlementSource: 'none',
  entitlementExpiresAt: null,
  mediaKind: null,
  grant: null,
};

type RevalidationReason = 'focus' | 'foreground' | 'timer' | 'manual';

export function useCreatorPremiumViewer(contentId: string): {
  snapshot: CreatorPremiumViewerSnapshot;
  protectionState: 'arming' | 'protected' | 'failed';
  retryProtection(): void;
  refresh(): Promise<void>;
  failMedia(): void;
  markPlaying(): void;
  markPaused(): void;
} {
  const mountedRef = useRef(true);
  const lifecycleGenerationRef = useRef(0);
  const contentIdRef = useRef(contentId);
  const focusedRef = useRef(false);
  const activeRef = useRef(AppState.currentState === 'active');
  const protectionStateRef = useRef<'arming' | 'protected' | 'failed'>('arming');
  const requestRef = useRef(0);
  const refreshRef = useRef<(reason: RevalidationReason) => Promise<void>>(async () => {});
  const [snapshot, setSnapshot] = useState<CreatorPremiumViewerSnapshot>(EMPTY_SNAPSHOT);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(activeRef.current);

  const controller = useMemo(() => createCreatorPremiumViewerController({
    getCurrentUserId: getCurrentCreatorPremiumUserId,
    getEntitlement: getMyCreatorPremiumEntitlement,
    getImageGrant: getCreatorPremiumOriginalImageGrant,
    getVideoGrant: getCreatorPremiumVideoPlaybackGrant,
  }, next => {
    if (mountedRef.current) setSnapshot(next);
  }), []);

  const { state: protectionState, retry: retryProtection } = usePremiumScreenProtection(
    contentId || 'invalid-content',
    true,
  );
  protectionStateRef.current = protectionState;
  contentIdRef.current = contentId;

  const runOpen = useCallback(async (_reason: RevalidationReason) => {
    const request = ++requestRef.current;
    const requestedContentId = contentIdRef.current;
    if (
      !mountedRef.current
      || !focusedRef.current
      || !activeRef.current
      || protectionStateRef.current !== 'protected'
    ) return;

    try {
      const userId = await getCurrentCreatorPremiumUserId();
      if (
        request !== requestRef.current
        || !mountedRef.current
        || !focusedRef.current
        || !activeRef.current
        || protectionStateRef.current !== 'protected'
        || requestedContentId !== contentIdRef.current
      ) return;
      if (!userId) {
        controller.invalidate('logout');
        return;
      }
      await controller.open({ userId, contentId: requestedContentId });
    } catch {
      if (request === requestRef.current && mountedRef.current) {
        controller.invalidate('security');
      }
    }
  }, [controller]);
  refreshRef.current = runOpen;

  const scheduler = useMemo(() => createCreatorPremiumRenewalScheduler({
    onRenew: () => { void refreshRef.current('timer'); },
  }), []);

  useEffect(() => {
    requestRef.current += 1;
    controller.invalidate('content_change');
    if (protectionStateRef.current === 'protected') void runOpen('manual');
  }, [contentId, controller, runOpen]);

  useEffect(() => {
    if (protectionState === 'protected') {
      if (focusedRef.current && activeRef.current) void runOpen('manual');
      return;
    }
    requestRef.current += 1;
    controller.invalidate('security');
  }, [controller, protectionState, runOpen]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    setFocused(true);
    if (protectionStateRef.current === 'protected' && activeRef.current) {
      void runOpen('focus');
    }
    return () => {
      focusedRef.current = false;
      setFocused(false);
      requestRef.current += 1;
      controller.invalidate('close');
    };
  }, [controller, runOpen]));

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const isActive = next === 'active';
      activeRef.current = isActive;
      setActive(isActive);
      if (!isActive) {
        requestRef.current += 1;
        controller.invalidate('background');
        return;
      }
      if (focusedRef.current && protectionStateRef.current === 'protected') {
        void runOpen('foreground');
      }
    });
    return () => appStateSubscription.remove();
  }, [controller, runOpen]);

  useEffect(() => {
    const { data: { subscription } } = getSupabaseClient().auth.onAuthStateChange(
      (_event, session) => {
        requestRef.current += 1;
        if (!session?.user?.id) {
          controller.invalidate('logout');
          return;
        }
        const currentUserId = controller.getSnapshot().userId;
        if (currentUserId && currentUserId !== session.user.id) {
          controller.invalidate('identity_change');
        }
        if (focusedRef.current && activeRef.current && protectionStateRef.current === 'protected') {
          void runOpen('manual');
        }
      },
    );
    return () => subscription.unsubscribe();
  }, [controller, runOpen]);

  useEffect(() => {
    scheduler.schedule({
      focused: focused && active && protectionState === 'protected',
      status: snapshot.status,
      grantExpiresAt: snapshot.grant?.expiresAt ?? null,
      entitlementExpiresAt: snapshot.entitlementExpiresAt,
    });
    return () => scheduler.cancel();
  }, [active, focused, protectionState, scheduler, snapshot]);

  useEffect(() => {
    lifecycleGenerationRef.current += 1;
    const lifecycleGeneration = lifecycleGenerationRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      scheduler.cancel();
      queueMicrotask(() => {
        if (
          lifecycleGenerationRef.current === lifecycleGeneration
          && !mountedRef.current
        ) controller.dispose();
      });
    };
  }, [controller, scheduler]);

  const refresh = useCallback(() => runOpen('manual'), [runOpen]);
  const failMedia = useCallback(() => {
    requestRef.current += 1;
    controller.invalidate('security');
  }, [controller]);
  const markPlaying = useCallback(() => {
    setSnapshot(current => current.status === 'ready' || current.status === 'paused'
      ? { ...current, status: 'playing' }
      : current);
  }, []);
  const markPaused = useCallback(() => {
    setSnapshot(current => current.status === 'playing'
      ? { ...current, status: 'paused' }
      : current);
  }, []);

  return {
    snapshot,
    protectionState,
    retryProtection,
    refresh,
    failMedia,
    markPlaying,
    markPaused,
  };
}
