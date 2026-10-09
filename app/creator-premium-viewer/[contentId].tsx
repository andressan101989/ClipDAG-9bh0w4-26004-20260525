import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { PremiumWatermark } from '@/components/premium/PremiumWatermark';
import { ProtectedPremiumImage } from '@/components/premium/ProtectedPremiumImage';
import { ProtectedPremiumVideo } from '@/components/premium/ProtectedPremiumVideo';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useCreatorPremiumViewer } from '@/hooks/useCreatorPremiumViewer';
import type { CreatorPremiumViewerStatus } from '@/services/creatorPremiumViewerRuntime.mjs';

const STATE_COPY: Record<CreatorPremiumViewerStatus, { title: string; body: string }> = {
  'idle': { title: 'Contenido protegido', body: 'Abre el contenido para comprobar tu acceso.' },
  'loading': { title: 'Comprobando acceso', body: 'Protegiendo la pantalla y validando tu autorización.' },
  'locked': { title: 'Contenido bloqueado', body: 'Este contenido requiere acceso Premium vigente. Las compras aún no están habilitadas.' },
  'ready': { title: 'Contenido protegido', body: 'Tu acceso está validado.' },
  'playing': { title: 'Reproduciendo', body: 'La protección permanece activa durante la reproducción.' },
  'paused': { title: 'En pausa', body: 'Tu acceso seguirá validándose mientras permanezcas aquí.' },
  'expired': { title: 'Acceso vencido', body: 'Tu periodo de acceso ya finalizó.' },
  'revoked': { title: 'Acceso retirado', body: 'Este contenido ya no está disponible para tu cuenta.' },
  'restricted': { title: 'Contenido restringido', body: 'No podemos mostrar este contenido en este momento.' },
  'error': { title: 'Contenido no disponible', body: 'No pudimos abrir el contenido protegido de forma segura.' },
  'offline': { title: 'Sin conexión', body: 'Conéctate a internet para volver a validar el acceso.' },
};

function pseudonymousMarker(value: string | null): string {
  let hash = 2_166_136_261;
  for (const character of value ?? '') {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `U${(hash >>> 0).toString(36).toUpperCase()}`;
}

export default function CreatorPremiumViewerScreen() {
  const params = useLocalSearchParams<{ contentId?: string | string[] }>();
  const router = useRouter();
  const contentId = typeof params.contentId === 'string' ? params.contentId : '';
  const sessionMarker = useMemo(
    () => `S${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
    [],
  );
  const {
    snapshot,
    protectionState,
    retryProtection,
    refresh,
    failMedia,
    markPlaying,
    markPaused,
  } = useCreatorPremiumViewer(contentId);
  const handlePlaybackStateChange = useCallback((isPlaying: boolean) => {
    if (isPlaying) markPlaying();
    else markPaused();
  }, [markPaused, markPlaying]);

  const copy = STATE_COPY[snapshot.status];
  const protectedAndReady = protectionState === 'protected'
    && ['ready', 'playing', 'paused'].includes(snapshot.status)
    && snapshot.grant !== null;
  const marker = useMemo(() => pseudonymousMarker(snapshot.userId), [snapshot.userId]);
  const watermarkTime = new Date().toISOString().slice(11, 16);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>Volver</Text>
        </Pressable>
        <View style={styles.protectionPill}>
          <Text style={styles.protectionText}>
            {protectionState === 'protected' ? 'Protección activa' : 'Contenido oculto'}
          </Text>
        </View>
      </View>

      <View style={styles.mediaFrame}>
        {snapshot.grant?.kind === 'image' ? (
          <ProtectedPremiumImage
            grant={snapshot.grant}
            visible={protectedAndReady}
            screenProtected={protectionState === 'protected'}
            onError={failMedia}
          />
        ) : null}
        {snapshot.grant?.kind === 'video' ? (
          <ProtectedPremiumVideo
            grant={snapshot.grant}
            generation={snapshot.generation}
            visible={protectedAndReady}
            screenProtected={protectionState === 'protected'}
            onError={failMedia}
            onPlaybackStateChange={handlePlaybackStateChange}
          />
        ) : null}

        <PremiumWatermark
          visible={protectedAndReady}
          userMarker={marker}
          sessionMarker={sessionMarker}
          timestamp={watermarkTime}
        />

        {!protectedAndReady ? (
          <View style={styles.opaqueCover}>
            {snapshot.status === 'loading' || protectionState === 'arming' ? (
              <ActivityIndicator color={Colors.purple} size="large" />
            ) : null}
            <Text style={styles.stateTitle}>{copy.title}</Text>
            <Text style={styles.stateBody}>{copy.body}</Text>
            {protectionState === 'failed' || ['error', 'offline'].includes(snapshot.status) ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => protectionState === 'failed' ? retryProtection() : void refresh()}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Reintentar de forma segura</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#05060A' },
  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  backButton: { minHeight: 44, justifyContent: 'center', paddingRight: Spacing.md },
  backText: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  protectionPill: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.purpleDim },
  protectionText: { color: Colors.purple, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  mediaFrame: { flex: 1, position: 'relative', backgroundColor: '#05060A' },
  opaqueCover: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    backgroundColor: '#05060A',
  },
  stateTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  stateBody: { color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 22, textAlign: 'center' },
  retryButton: { minHeight: 44, justifyContent: 'center', marginTop: Spacing.md, paddingHorizontal: Spacing.lg, borderRadius: Radius.full, backgroundColor: Colors.purple },
  retryText: { color: Colors.textOnBrand, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
