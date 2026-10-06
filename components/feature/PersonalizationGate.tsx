import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { getPersonalizationOnboarding } from '@/services/personalizationService';
import { Colors } from '@/constants/theme';

export function PersonalizationGate({ children }: { children: ReactNode }) {
  const { user, isAuthReady } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const completedUserId = useRef<string | null>(null);
  const activeUserId = useRef<string | null>(null);

  useEffect(() => {
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    const userId = user?.id ?? null;

    if (!isAuthReady || !userId) {
      activeUserId.current = null;
      completedUserId.current = null;
      setResolvedUserId(null);
      setChecking(false);
      return;
    }
    if (activeUserId.current !== userId) {
      activeUserId.current = userId;
      completedUserId.current = null;
      setResolvedUserId(null);
    }
    if (pathname.startsWith('/onboarding/personalization')) {
      setChecking(false);
      return;
    }
    if (completedUserId.current === userId) {
      setResolvedUserId(userId);
      setChecking(false);
      return;
    }

    let cancelled = false;
    setChecking(true);
    getPersonalizationOnboarding()
      .then(status => {
        if (cancelled || requestGeneration.current !== generation) return;
        if (status.completed) {
          completedUserId.current = userId;
          setResolvedUserId(userId);
        }
        else router.replace('/onboarding/personalization');
      })
      .catch(error => {
        if (cancelled || requestGeneration.current !== generation) return;
        // Fail open: a transient profile outage must never trap an account.
        console.warn('[PersonalizationGate] status check failed:', error?.message ?? error);
        setResolvedUserId(userId);
      })
      .finally(() => {
        if (!cancelled && requestGeneration.current === generation) setChecking(false);
      });

    return () => { cancelled = true; };
  }, [isAuthReady, pathname, router, user?.id]);

  const awaitingAuthenticatedCheck = isAuthReady && !!user?.id
    && !pathname.startsWith('/onboarding/personalization')
    && completedUserId.current !== user.id
    && resolvedUserId !== user.id;
  const blockingOverlay = checking || awaitingAuthenticatedCheck;

  return (
    <>
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
    </>
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
