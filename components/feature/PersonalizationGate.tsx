import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
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

  useEffect(() => {
    if (!isAuthReady || !user?.id) {
      completedUserId.current = null;
      setResolvedUserId(null);
      setChecking(false);
      return;
    }
    if (pathname.startsWith('/onboarding/personalization')) {
      setChecking(false);
      return;
    }
    if (completedUserId.current === user.id) {
      setResolvedUserId(user.id);
      setChecking(false);
      return;
    }

    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setChecking(true);
    getPersonalizationOnboarding()
      .then(status => {
        if (requestGeneration.current !== generation) return;
        if (status.completed) {
          completedUserId.current = user.id;
          setResolvedUserId(user.id);
        }
        else router.replace('/onboarding/personalization');
      })
      .catch(error => {
        // Fail open: a transient profile outage must never trap an account.
        console.warn('[PersonalizationGate] status check failed:', error?.message ?? error);
        setResolvedUserId(user.id);
      })
      .finally(() => {
        if (requestGeneration.current === generation) setChecking(false);
      });
  }, [isAuthReady, pathname, router, user?.id]);

  const awaitingAuthenticatedCheck = isAuthReady && !!user?.id
    && !pathname.startsWith('/onboarding/personalization')
    && completedUserId.current !== user.id
    && resolvedUserId !== user.id;

  if (checking || awaitingAuthenticatedCheck) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg }}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }
  return <>{children}</>;
}
