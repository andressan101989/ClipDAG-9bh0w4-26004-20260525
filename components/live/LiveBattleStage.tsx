import React, { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import {
  deriveLiveBattleLocalCompetitiveState,
  deriveLiveBattlePowerVisualState,
  estimateLiveBattleServerNow,
  readLiveBattleMonotonicNow,
  type LiveBattlePowerVisualState,
  type LiveBattlePublicState,
  type LiveBattleServerClockAnchor,
} from '@/services/liveBattleSpectatorService';

type HostIdentity = {
  username: string;
  avatarUrl: string | null;
};

type LiveBattleStageProps = {
  state: LiveBattlePublicState;
  localHost: HostIdentity;
  opponentHost: HostIdentity;
  localSurface: ReactNode;
  opponentSurface: ReactNode;
  localLabel?: string;
  clockAnchor: LiveBattleServerClockAnchor | null;
  topInset?: number;
  onActivateGlove?: () => void;
  glovePending?: boolean;
  gloveError?: string | null;
};

function secondsUntil(value: string | null, now: number | null): number | null {
  if (!value || now === null) return null;
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1_000)) : null;
}

function clock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function boostLabel(power: LiveBattlePowerVisualState): string | null {
  if (!power.activeBoost) return null;
  return `x${power.multiplier} ${Math.max(1, Math.ceil(power.remainingMs / 1_000))}s`;
}

function HostPanel({
  identity,
  label,
  surface,
  side,
}: {
  identity: HostIdentity;
  label: string;
  surface: ReactNode;
  side: 'local' | 'opponent';
}) {
  return (
    <View style={[styles.panel, side === 'local' ? styles.localPanel : styles.opponentPanel]}>
      {surface ?? (
        <View style={styles.placeholder} accessibilityLabel={`${label} conectando`}>
          {identity.avatarUrl ? (
            <Image source={{ uri: identity.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{identity.username.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <MaterialIcons name="videocam-off" size={24} color={Colors.textSecondary} />
          <Text style={styles.connecting}>Conectando…</Text>
        </View>
      )}
    </View>
  );
}

function PowerBadge({ power }: { power: LiveBattlePowerVisualState }) {
  const label = boostLabel(power);
  if (!label) return <View style={styles.powerBadgePlaceholder} />;
  return (
    <View
      style={[styles.powerBadge, power.multiplier === 3 ? styles.x3Badge : styles.x2Badge]}
      accessible
      accessibilityLabel={`Multiplicador ${label}`}
    >
      <Text style={styles.powerBadgeText}>{label}</Text>
    </View>
  );
}

export function LiveBattleStage({
  state,
  localHost,
  opponentHost,
  localSurface,
  opponentSurface,
  localLabel = 'Anfitrión',
  clockAnchor,
  topInset = 0,
  onActivateGlove,
  glovePending = false,
  gloveError = null,
}: LiveBattleStageProps) {
  const [monotonicNow, setMonotonicNow] = useState<number | null>(
    () => clockAnchor ? readLiveBattleMonotonicNow() : null,
  );
  useEffect(() => {
    if (!clockAnchor) {
      setMonotonicNow(null);
      return;
    }
    setMonotonicNow(readLiveBattleMonotonicNow());
    const timer = setInterval(() => setMonotonicNow(readLiveBattleMonotonicNow()), 1_000);
    return () => clearInterval(timer);
  }, [clockAnchor]);

  const serverNow = estimateLiveBattleServerNow(clockAnchor, monotonicNow);
  const competitive = useMemo(
    () => deriveLiveBattleLocalCompetitiveState(state),
    [state],
  );
  const localPower = deriveLiveBattlePowerVisualState(
    state,
    competitive.localSide,
    clockAnchor,
    monotonicNow,
  );
  const rivalPower = deriveLiveBattlePowerVisualState(
    state,
    competitive.rivalSide,
    clockAnchor,
    monotonicNow,
  );
  const battleSeconds = secondsUntil(
    state.status === 'countdown' ? state.scheduledStartAt : state.scheduledEndAt,
    serverNow,
  );
  const scoreTotal = competitive.localScore + competitive.rivalScore;
  const localWeight = scoreTotal === 0 ? 1 : competitive.localScore;
  const rivalWeight = scoreTotal === 0 ? 1 : competitive.rivalScore;
  const localWon = competitive.localResult === 'won';
  const rivalWon = competitive.localResult === 'lost';
  const terminalLabel = state.status === 'cancelled'
    ? 'BATTLE CANCELADA'
    : competitive.localResult === 'tie'
      ? 'EMPATE'
      : localWon ? `GANADOR: @${localHost.username}` : `GANADOR: @${opponentHost.username}`;
  const timerLabel = state.status === 'countdown'
    ? 'COMIENZA EN'
    : state.status === 'active' ? 'BATTLE' : terminalLabel;
  const localX3Active = localPower.activeBoost === 'glove_x3';
  const gloveDisabled = glovePending
    || state.status !== 'active'
    || competitive.localGloveUsesRemaining < 1
    || localX3Active
    || battleSeconds === null
    || battleSeconds < 1;

  return (
    <View style={styles.root} accessibilityLabel="Battle LIVE de dos anfitriones">
      <View style={styles.panels}>
        <HostPanel identity={localHost} label={localLabel} surface={localSurface} side="local" />
        <HostPanel identity={opponentHost} label="Rival" surface={opponentSurface} side="opponent" />
      </View>
      <View style={styles.centerDivider} pointerEvents="none" />
      <View style={[styles.battlePanel, { top: topInset + 64 }]}>
        <Text style={styles.battleTitle}>LIVE BATTLE</Text>
        <View style={styles.identityRow}>
          <Text style={[styles.hostName, styles.localName]} numberOfLines={1}>@{localHost.username}</Text>
          <Text style={[styles.hostName, styles.opponentName]} numberOfLines={1}>@{opponentHost.username}</Text>
        </View>
        <View
          style={styles.balanceRow}
          accessible
          accessibilityLabel={`Marcador ${competitive.localScore} a ${competitive.rivalScore}`}
        >
          <View style={[styles.balanceSide, styles.localBalance, { flexGrow: localWeight }]}>
            <Text style={styles.scoreValue}>{competitive.localScore}</Text>
          </View>
          <View style={[styles.balanceSide, styles.opponentBalance, { flexGrow: rivalWeight }]}>
            <Text style={[styles.scoreValue, styles.opponentValue]}>{competitive.rivalScore}</Text>
          </View>
          <View style={styles.vsDiamond}>
            <View style={styles.vsContent}><Text style={styles.vsText}>VS</Text></View>
          </View>
        </View>
        <View style={styles.powerRow}>
          <View style={styles.sidePower}>
            <Text style={styles.progressText}>
              🌹 {competitive.localRoseProgressUnits}/{state.roseTargetUnits} · {competitive.localRoseActivationsRemaining} act.
            </Text>
            <PowerBadge power={localPower} />
          </View>
          <View style={[styles.sidePower, styles.rivalPower]}>
            <Text style={[styles.progressText, styles.opponentValue]}>
              🌹 {competitive.rivalRoseProgressUnits}/{state.roseTargetUnits} · {competitive.rivalRoseActivationsRemaining} act.
            </Text>
            <PowerBadge power={rivalPower} />
          </View>
        </View>
        <View style={styles.statusRow}>
          <View style={styles.gloveSummary}>
            <Text style={styles.gloveText}>🥊 {competitive.localGloveUsesRemaining}</Text>
          </View>
          <View style={styles.timerPill}>
            {state.status === 'countdown' || state.status === 'active' ? (
              <Text style={styles.timer}>{clock(battleSeconds)}</Text>
            ) : null}
            <Text style={styles.statusLabel}>{timerLabel}</Text>
          </View>
          <View style={[styles.gloveSummary, styles.rivalGloveSummary]}>
            <Text style={styles.gloveText}>🥊 {competitive.rivalGloveUsesRemaining}</Text>
          </View>
        </View>
        {onActivateGlove && state.status === 'active' ? (
          <View style={styles.gloveActionRow}>
            <Pressable
              style={[styles.gloveButton, gloveDisabled && styles.disabled]}
              onPress={onActivateGlove}
              disabled={gloveDisabled}
              accessibilityRole="button"
              accessibilityLabel="Activar guante multiplicador por tres"
              accessibilityHint="Multiplica únicamente los puntos Battle"
              accessibilityState={{ disabled: gloveDisabled, busy: glovePending }}
            >
              {glovePending ? <ActivityIndicator size="small" color={Colors.textOnBrand} /> : (
                <Text style={styles.gloveButtonText}>
                  {localX3Active ? 'x3 ACTIVO' : `🥊 ACTIVAR x3 · ${competitive.localGloveUsesRemaining}`}
                </Text>
              )}
            </Pressable>
            {gloveError ? <Text style={styles.gloveError} accessibilityRole="alert">{gloveError}</Text> : null}
          </View>
        ) : null}
        {state.status === 'completed' ? (
          <Text style={styles.terminalDetail}>
            {competitive.localResult === 'tie' ? 'Puntuación igualada' : localWon ? 'Victoria local' : rivalWon ? 'Victoria rival' : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.bg },
  panels: { flex: 1, flexDirection: 'row' },
  panel: { flex: 1, overflow: 'hidden', backgroundColor: Colors.surface },
  localPanel: { borderTopWidth: 2, borderTopColor: Colors.blue },
  opponentPanel: { borderTopWidth: 2, borderTopColor: Colors.secondary },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceElevated },
  avatar: { width: 54, height: 54, borderRadius: Radius.full },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryGlow },
  avatarInitial: { color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  connecting: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  centerDivider: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: Colors.borderHighlight },
  battlePanel: {
    position: 'absolute', left: Spacing.md, right: Spacing.md, minHeight: 164,
    paddingTop: Spacing.sm, paddingHorizontal: Spacing.sm, paddingBottom: Spacing.xs,
    borderRadius: Radius.lg, backgroundColor: Colors.overlay, borderWidth: 1,
    borderColor: Colors.border,
  },
  battleTitle: { color: Colors.textPrimary, fontSize: 10, lineHeight: 12, fontWeight: FontWeight.extrabold, textAlign: 'center', letterSpacing: 0.25 },
  identityRow: { height: 25, flexDirection: 'row', alignItems: 'center' },
  hostName: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.xs, lineHeight: 15, fontWeight: FontWeight.bold },
  localName: { paddingRight: Spacing.sm, textAlign: 'left' },
  opponentName: { paddingLeft: Spacing.sm, textAlign: 'right' },
  balanceRow: { height: 30, flexDirection: 'row', alignItems: 'center' },
  balanceSide: { flexBasis: 0, minWidth: 42, height: 30, justifyContent: 'center', paddingHorizontal: Spacing.sm },
  localBalance: { borderTopLeftRadius: Radius.full, borderBottomLeftRadius: Radius.full, backgroundColor: Colors.blue },
  opponentBalance: { borderTopRightRadius: Radius.full, borderBottomRightRadius: Radius.full, backgroundColor: Colors.secondary },
  scoreValue: { color: Colors.textOnBrand, fontSize: FontSize.md, lineHeight: 18, fontWeight: FontWeight.extrabold, textAlign: 'left', fontVariant: ['tabular-nums'] },
  opponentValue: { textAlign: 'right' },
  vsDiamond: { position: 'absolute', left: '50%', marginLeft: -17, width: 34, height: 34, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, transform: [{ rotate: '45deg' }] },
  vsContent: { transform: [{ rotate: '-45deg' }] },
  vsText: { color: Colors.textPrimary, fontSize: 10, lineHeight: 12, fontWeight: FontWeight.extrabold },
  powerRow: { minHeight: 39, flexDirection: 'row', paddingTop: Spacing.xs },
  sidePower: { flex: 1, alignItems: 'flex-start', gap: 2, paddingRight: Spacing.sm },
  rivalPower: { alignItems: 'flex-end', paddingRight: 0, paddingLeft: Spacing.sm },
  progressText: { color: Colors.textSecondary, fontSize: 9, lineHeight: 11, fontWeight: FontWeight.semibold },
  powerBadge: { minHeight: 20, minWidth: 52, justifyContent: 'center', paddingHorizontal: Spacing.sm, borderRadius: Radius.full },
  powerBadgePlaceholder: { height: 20 },
  x2Badge: { backgroundColor: Colors.warningDim, borderWidth: 1, borderColor: Colors.warning },
  x3Badge: { backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primaryLight },
  powerBadgeText: { color: Colors.textPrimary, fontSize: 9, lineHeight: 11, fontWeight: FontWeight.extrabold, fontVariant: ['tabular-nums'] },
  statusRow: { minHeight: 27, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gloveSummary: { width: 54, alignItems: 'flex-start' },
  rivalGloveSummary: { alignItems: 'flex-end' },
  gloveText: { color: Colors.textSecondary, fontSize: 10, fontWeight: FontWeight.bold },
  timerPill: { minHeight: 23, maxWidth: 178, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surface },
  timer: { minWidth: 39, color: Colors.textPrimary, fontSize: 12, lineHeight: 15, fontWeight: FontWeight.extrabold, textAlign: 'center', fontVariant: ['tabular-nums'] },
  statusLabel: { color: Colors.textSecondary, fontSize: 9, lineHeight: 11, fontWeight: FontWeight.semibold, textAlign: 'center' },
  gloveActionRow: { minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2 },
  gloveButton: { minHeight: 44, minWidth: 160, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.primary },
  gloveButtonText: { color: Colors.textOnBrand, fontSize: FontSize.xs, fontWeight: FontWeight.extrabold },
  gloveError: { color: Colors.error, fontSize: 9, lineHeight: 11, textAlign: 'center' },
  terminalDetail: { color: Colors.textSecondary, fontSize: 9, lineHeight: 11, textAlign: 'center' },
  disabled: { opacity: 0.45 },
});
