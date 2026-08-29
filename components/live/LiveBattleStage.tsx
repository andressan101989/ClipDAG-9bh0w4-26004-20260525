import React, { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  estimateLiveBattleServerNow,
  readLiveBattleMonotonicNow,
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
};

function secondsUntil(value: string | null, now: number): number | null {
  if (!value) return null;
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

function clock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
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
          <MaterialIcons name="videocam-off" size={24} color="rgba(255,255,255,0.72)" />
          <Text style={styles.connecting}>Conectando…</Text>
        </View>
      )}
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

  const timerText = useMemo(() => {
    const serverNow = estimateLiveBattleServerNow(clockAnchor, monotonicNow);
    if (serverNow === null) return '--:--';
    const remaining = secondsUntil(
      state.status === 'countdown' ? state.scheduledStartAt : state.scheduledEndAt,
      serverNow,
    );
    if (remaining === null) return '--:--';
    return clock(remaining);
  }, [clockAnchor, monotonicNow, state.scheduledEndAt, state.scheduledStartAt, state.status]);

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
          accessibilityLabel="Puntuación todavía no disponible"
        >
          <View style={[styles.balanceSide, styles.localBalance]}>
            <Text style={styles.neutralValue}>—</Text>
          </View>
          <View style={[styles.balanceSide, styles.opponentBalance]}>
            <Text style={[styles.neutralValue, styles.opponentValue]}>—</Text>
          </View>
          <View style={styles.vsDiamond}>
            <View style={styles.vsContent}>
              <Text style={styles.vsText}>VS</Text>
            </View>
          </View>
        </View>
        <View style={styles.statusRow}>
          <View style={styles.timerPill}>
            <Text style={styles.timer}>{timerText}</Text>
            <Text style={styles.statusLabel}>BATTLE</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050508' },
  panels: { flex: 1, flexDirection: 'row' },
  panel: { flex: 1, overflow: 'hidden', backgroundColor: '#0D1017' },
  localPanel: { borderTopWidth: 2, borderTopColor: '#086BFF' },
  opponentPanel: { borderTopWidth: 2, borderTopColor: '#FF1F8C' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#151923' },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(168,85,247,0.3)' },
  avatarInitial: { color: '#F8FAFC', fontSize: 22, fontWeight: '700' },
  connecting: { color: 'rgba(255,255,255,0.76)', fontSize: 12, fontWeight: '600' },
  centerDivider: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(255,255,255,0.24)' },
  battlePanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 122,
    paddingTop: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(5,6,13,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  battleTitle: { color: '#EBF0FF', fontSize: 10, lineHeight: 12, fontWeight: '800', textAlign: 'center', letterSpacing: 0.25 },
  identityRow: { height: 30, flexDirection: 'row', alignItems: 'center' },
  hostName: { flex: 1, color: '#FFF', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  localName: { paddingRight: 12, textAlign: 'left' },
  opponentName: { paddingLeft: 12, textAlign: 'right' },
  balanceRow: { height: 32, flexDirection: 'row', alignItems: 'center' },
  balanceSide: { flex: 1, height: 32, justifyContent: 'center', paddingHorizontal: 12 },
  localBalance: { borderTopLeftRadius: 16, borderBottomLeftRadius: 16, backgroundColor: 'rgba(8,107,255,0.96)' },
  opponentBalance: { borderTopRightRadius: 16, borderBottomRightRadius: 16, backgroundColor: 'rgba(255,31,140,0.96)' },
  neutralValue: { color: '#FFF', fontSize: 15, lineHeight: 18, fontWeight: '800', textAlign: 'left' },
  opponentValue: { textAlign: 'right' },
  vsDiamond: {
    position: 'absolute',
    left: '50%',
    marginLeft: -18,
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F111C',
    transform: [{ rotate: '45deg' }],
  },
  vsContent: { transform: [{ rotate: '-45deg' }] },
  vsText: { color: '#FFF', fontSize: 10, lineHeight: 12, fontWeight: '800' },
  statusRow: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  timerPill: { height: 23, minWidth: 112, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(8,9,18,0.84)' },
  timer: { minWidth: 39, color: '#FFF', fontSize: 12, lineHeight: 15, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  statusLabel: { color: '#C7CCDB', fontSize: 9, lineHeight: 11, fontWeight: '600' },
});
