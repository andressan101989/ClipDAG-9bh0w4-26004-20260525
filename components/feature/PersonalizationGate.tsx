import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { getPersonalizationOnboarding } from '@/services/personalizationService';
import {
  getEffectivePersonalizationRuntime,
  getPersonalizationRevision,
} from '@/services/personalizationRuntimeCoordinator';
import {
  PersonalizationRuntimeContext,
  type PersonalizationRevalidationResult,
} from '@/contexts/PersonalizationRuntimeContext';
import { Colors } from '@/constants/theme';

export function PersonalizationGate({ children }: { children: ReactNode }) {
  const { user, isAuthReady } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [feedReady, setFeedReady] = useState(!user?.id);
  const [personalizationRevision, setPersonalizationRevision] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const completedUserId = useRef<string | null>(null);
  const completedRevision = useRef<string | null>(null);
  const activeUserId = useRef<string | null>(null);

  const resolvePersonalization = useCallback(async (
    redirectIncomplete: boolean,
    revisionHint: string | null = null,
  ): Promise<PersonalizationRevalidationResult> => {
    const userId = activeUserId.current;
    if (!userId) {
      setFeedReady(true);
      setPersonalizationRevision(null);
      return { completed: false, failedOpen: false, revision: null, stale: true };
    }

    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setChecking(true);
    setFeedReady(false);

    try {
      const status = await getPersonalizationOnboarding();
      if (requestGeneration.current !== generation || activeUserId.current !== userId) {
        return { completed: false, failedOpen: false, revision: null, stale: true };
      }

      if (!status.completed) {
        completedUserId.current = null;
        completedRevision.current = null;
        setResolvedUserId(null);
        setPersonalizationRevision(null);
        setFeedReady(false);
        if (redirectIncomplete) router.replace('/onboarding/personalization');
        return { completed: false, failedOpen: false, revision: null, stale: false };
      }

      const revision = getPersonalizationRevision(status) ?? revisionHint;
      completedUserId.current = userId;
      completedRevision.current = revision;
      setResolvedUserId(userId);
      setPersonalizationRevision(revision);
      setFeedReady(true);
      return { completed: true, failedOpen: false, revision, stale: false };
    } catch (error: any) {
      if (requestGeneration.current !== generation || activeUserId.current !== userId) {
        return { completed: false, failedOpen: false, revision: null, stale: true };
      }
      // Fail open: a transient profile outage must never trap an account.
      console.warn('[PersonalizationGate] status check failed:', error?.message ?? error);
      const revision = revisionHint ?? completedRevision.current;
      setResolvedUserId(userId);
      setPersonalizationRevision(revision);
      setFeedReady(true);
      return { completed: false, failedOpen: true, revision, stale: false };
    } finally {
      if (requestGeneration.current === generation) setChecking(false);
    }
  }, [router]);

  const invalidatePersonalization = useCallback(() => {
    requestGeneration.current += 1;
    completedUserId.current = null;
    completedRevision.current = null;
    setResolvedUserId(null);
    setPersonalizationRevision(null);
    setFeedReady(activeUserId.current == null);
    setChecking(false);
  }, []);

  const revalidatePersonalization = useCallback(
    (revisionHint: string | null = null) => resolvePersonalization(false, revisionHint),
    [resolvePersonalization],
  );

  useEffect(() => {
    requestGeneration.current += 1;
    const userId = user?.id ?? null;

    if (!isAuthReady || !userId) {
      activeUserId.current = null;
      completedUserId.current = null;
      completedRevision.current = null;
      setResolvedUserId(null);
      setPersonalizationRevision(null);
      setFeedReady(true);
      setChecking(false);
      return;
    }
    if (activeUserId.current !== userId) {
      activeUserId.current = userId;
      completedUserId.current = null;
      completedRevision.current = null;
      setResolvedUserId(null);
      setPersonalizationRevision(null);
      setFeedReady(false);
    }
    if (pathname.startsWith('/onboarding/personalization')) {
      setChecking(false);
      return;
    }
    if (completedUserId.current === userId) {
      setResolvedUserId(userId);
      setPersonalizationRevision(completedRevision.current);
      setFeedReady(true);
      setChecking(false);
      return;
    }

    void resolvePersonalization(true);
    return () => { requestGeneration.current += 1; };
  }, [isAuthReady, pathname, resolvePersonalization, user?.id]);

  const awaitingAuthenticatedCheck = isAuthReady && !!user?.id
    && !pathname.startsWith('/onboarding/personalization')
    && completedUserId.current !== user.id
    && resolvedUserId !== user.id;
  const blockingOverlay = checking || awaitingAuthenticatedCheck;
  const effectiveRuntime = getEffectivePersonalizationRuntime({
    authenticatedUserId: user?.id ?? null,
    runtimeUserId: activeUserId.current,
    feedReady,
    personalizationRevision,
  });
  const effectiveFeedReady = effectiveRuntime.feedReady;
  const effectivePersonalizationRevision = effectiveRuntime.personalizationRevision;
  const runtimeValue = useMemo(() => ({
    feedReady: effectiveFeedReady,
    personalizationRevision: effectivePersonalizationRevision,
    invalidatePersonalization,
    revalidatePersonalization,
  }), [
    effectiveFeedReady,
    effectivePersonalizationRevision,
    invalidatePersonalization,
    revalidatePersonalization,
  ]);

  return (
    <PersonalizationRuntimeContext.Provider value={runtimeValue}>
      {children}
      {blockingOverlay ? (
        <View
          accessibilityLabel="Comprobando personalización"
          accessibilityViewIsModal
          pointerEvents="auto"
          style={[StyleSheet.absoluteFillObject, styles.blockingOverlay]}
        >
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : null}
    </PersonalizationRuntimeContext.Provider>
  );
}

const styles = StyleSheet.create({
  blockingOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg,
    zIndex: 1_000,
    elevation: 1_000,
  },
});
