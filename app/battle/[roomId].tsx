/**
 * app/battle/[roomId].tsx — Real-time battle screen
 *
 * Full useBattle integration:
 *   - MultiplayerEngine room join/leave
 *   - Live score updates via optimistic + server reconciliation
 *   - Anti-cheat validation on every action
 *   - SessionOrchestrator conflict resolution
 *   - SecurityManager action gating
 *   - CrashIntelligence breadcrumbs
 *   - useNavigationTelemetry for screen timing
 *   - Reconnection overlay on recovery
 */

import React, { useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth }                from '@/hooks/useAuth';
import { useBattle }              from '@/hooks/gaming/useBattle';
import { useNavigationTelemetry } from '@/hooks/navigation/useNavigationTelemetry';
import { useStabilityMode }       from '@/hooks/core/useStabilityMode';

export default function BattleScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const { markReady } = useNavigationTelemetry('BattleScreen');
  const { canRenderEffects } = useStabilityMode();

  const {
    state,
    myPlayer,
    opponents,
    isConnected,
    isRecovering,
    error,
    dispatch,
    leave,
  } = useBattle(roomId ?? '', user?.id ?? '');

  // Tap animation
  const tapScale = useRef(new Animated.Value(1)).current;

  // Mark screen ready once connected
  useEffect(() => {
    if (isConnected && state) markReady();
  }, [isConnected, state, markReady]);

  // Animated tap feedback
  const animateTap = useCallback(() => {
    Animated.sequence([
      Animated.spring(tapScale, { toValue: 0.92, useNativeDriver: true, speed: 60 }),
      Animated.spring(tapScale, { toValue: 1,    useNativeDriver: true, speed: 60 }),
    ]).start();
  }, [tapScale]);

  // Handle tap action
  const handleTap = useCallback(() => {
    animateTap();
    dispatch('tap', { timestamp: Date.now() }, 'normal');
  }, [animateTap, dispatch]);

  // Handle forfeit
  const handleForfeit = useCallback(async () => {
    dispatch('forfeit', { userId: user?.id }, 'critical');
    await leave();
    router.back();
  }, [dispatch, leave, router, user?.id]);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (!state && !error) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Uniéndose a la batalla...</Text>
      </View>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (error && !state) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <MaterialIcons name="error-outline" size={48} color={Colors.secondary} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.errorBtn} onPress={() => router.back()}>
          <Text style={styles.errorBtnText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const opponent = opponents[0];
  const phase    = state?.phase ?? 'waiting';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Background gradient */}
      <LinearGradient
        colors={['#0A0A14', '#12001A', '#0A0A14']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Reconnecting overlay */}
      {isRecovering ? (
        <View style={styles.reconnectOverlay}>
          <ActivityIndicator color={Colors.warning} />
          <Text style={styles.reconnectText}>Reconectando...</Text>
        </View>
      ) : null}

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={handleForfeit} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={20} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.phaseBadge}>
          <Text style={styles.phaseText}>
            {phase === 'waiting'  ? 'Esperando...'
           : phase === 'starting' ? 'Empezando...'
           : phase === 'active'   ? 'BATALLA ACTIVA'
           : phase === 'paused'   ? 'PAUSADO'
           : 'FINALIZADO'}
          </Text>
        </View>
        <View style={[styles.connDot, { backgroundColor: isConnected ? '#00D4AA' : Colors.warning }]} />
      </View>

      {/* Score board */}
      <View style={styles.scoreBoard}>
        {/* My score */}
        <View style={styles.playerCard}>
          <View style={[styles.playerAvatar, { borderColor: Colors.primary }]}>
            <Text style={[styles.avatarInitial, { color: Colors.primary }]}>
              {(user?.username ?? 'Tú').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.playerName}>{user?.username ?? 'Tú'}</Text>
          <Text style={styles.playerScore}>{myPlayer?.score ?? 0}</Text>
          <View style={[styles.livesRow]}>
            {Array.from({ length: myPlayer?.lives ?? 3 }).map((_, i) => (
              <MaterialIcons key={i} name="favorite" size={12} color="#FF2D78" />
            ))}
          </View>
        </View>

        {/* VS */}
        <View style={styles.vsContainer}>
          {canRenderEffects ? (
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={styles.vsGrad}>
              <Text style={styles.vsText}>VS</Text>
            </LinearGradient>
          ) : (
            <View style={styles.vsGrad}>
              <Text style={styles.vsText}>VS</Text>
            </View>
          )}
        </View>

        {/* Opponent score */}
        <View style={styles.playerCard}>
          <View style={[styles.playerAvatar, { borderColor: '#FF2D78' }]}>
            <Text style={[styles.avatarInitial, { color: '#FF2D78' }]}>
              {(opponent?.userId ?? 'R').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.playerName}>{opponent?.userId ? 'Rival' : 'Esperando...'}</Text>
          <Text style={[styles.playerScore, { color: '#FF2D78' }]}>{opponent?.score ?? 0}</Text>
          <View style={styles.livesRow}>
            {Array.from({ length: opponent?.lives ?? 3 }).map((_, i) => (
              <MaterialIcons key={i} name="favorite" size={12} color="#FF2D78" />
            ))}
          </View>
        </View>
      </View>

      {/* Battle arena — TAP ZONE */}
      <View style={styles.arena}>
        {phase === 'active' ? (
          <Animated.View style={{ transform: [{ scale: tapScale }] }}>
            <Pressable
              style={styles.tapButton}
              onPress={handleTap}
              hitSlop={16}
            >
              <LinearGradient
                colors={['#7C5CFF', '#FF2D78']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.tapGrad}
              >
                <Text style={styles.tapIcon}>⚡</Text>
                <Text style={styles.tapLabel}>¡TAP!</Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        ) : (
          <View style={styles.waitingArea}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.waitingText}>
              {phase === 'waiting'  ? 'Esperando al rival...'
             : phase === 'starting' ? 'La batalla comienza...'
             : 'Batalla finalizada'}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom controls */}
      <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable style={styles.forfeitBtn} onPress={handleForfeit} hitSlop={8}>
          <MaterialIcons name="flag" size={16} color={Colors.textSubtle} />
          <Text style={styles.forfeitText}>Rendirse</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },
  loadingContainer: {
    flex: 1, backgroundColor: '#0A0A14',
    alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.md },
  errorText:   { color: Colors.secondary, fontSize: FontSize.md, textAlign: 'center', paddingHorizontal: 32 },
  errorBtn: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    paddingHorizontal: 24, paddingVertical: 10,
  },
  errorBtnText: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },

  reconnectOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
  },
  reconnectText: { color: Colors.warning, fontSize: FontSize.md },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  phaseBadge: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  phaseText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  connDot:   { width: 10, height: 10, borderRadius: 5 },

  scoreBoard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl,
  },
  playerCard: { alignItems: 'center', gap: Spacing.xs, flex: 1 },
  playerAvatar: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 3,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 28, fontWeight: FontWeight.bold },
  playerName:    { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  playerScore: {
    color: Colors.primary, fontSize: 40, fontWeight: FontWeight.extrabold,
    lineHeight: 44,
  },
  livesRow: { flexDirection: 'row', gap: 3 },

  vsContainer: { alignItems: 'center', paddingHorizontal: Spacing.md },
  vsGrad: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  vsText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.extrabold },

  arena: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tapButton: { width: 180, height: 180, borderRadius: 90, overflow: 'hidden' },
  tapGrad: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  tapIcon:  { fontSize: 48 },
  tapLabel: {
    color: '#fff', fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, letterSpacing: 2,
  },
  waitingArea: { alignItems: 'center', gap: Spacing.md },
  waitingText: { color: Colors.textSecondary, fontSize: FontSize.md },

  bottomControls: {
    alignItems: 'center', paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  forfeitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg,
  },
  forfeitText: { color: Colors.textSubtle, fontSize: FontSize.sm },
});
