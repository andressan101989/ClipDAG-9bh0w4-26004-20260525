import React, { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { LiveBattlePublicState } from '@/services/liveBattleSpectatorService';

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
}: {
  identity: HostIdentity;
  label: string;
  surface: ReactNode;
}) {
  return (
    <View style={styles.panel}>
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
      <View style={styles.identity}>
        <Text style={styles.name} numberOfLines={1}>@{identity.username}</Text>
        <Text style={styles.label}>{label}</Text>
      </View>
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
}: LiveBattleStageProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const timerText = useMemo(() => state.status === 'countdown'
    ? String(Math.max(1, secondsUntil(state.scheduledStartAt, now) ?? 1))
    : clock(secondsUntil(state.scheduledEndAt, now)), [now, state]);

  return (
    <View style={styles.root} accessibilityLabel="Battle LIVE de dos anfitriones">
      <View style={styles.panels}>
        <HostPanel identity={localHost} label={localLabel} surface={localSurface} />
        <HostPanel identity={opponentHost} label="Rival" surface={opponentSurface} />
      </View>
      <View style={styles.battleBadge}>
        <MaterialIcons name="sports-mma" size={15} color="#FDF2F8" />
        <Text style={styles.battleText}>BATTLE</Text>
        <Text style={state.status === 'countdown' ? styles.countdown : styles.timer}>{timerText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050508' },
  panels: { flex: 1, flexDirection: 'row', gap: 2 },
  panel: { flex: 1, overflow: 'hidden', backgroundColor: '#0D1017' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#151923' },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(168,85,247,0.3)' },
  avatarInitial: { color: '#F8FAFC', fontSize: 22, fontWeight: '700' },
  connecting: { color: 'rgba(255,255,255,0.76)', fontSize: 12, fontWeight: '600' },
  identity: { position: 'absolute', left: 8, right: 8, bottom: 14, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.52)' },
  name: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 1 },
  battleBadge: { position: 'absolute', alignSelf: 'center', top: 104, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, borderRadius: 17, backgroundColor: 'rgba(91,33,105,0.94)', borderWidth: 1, borderColor: 'rgba(244,114,182,0.72)' },
  battleText: { color: '#FDF2F8', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  countdown: { minWidth: 18, color: '#F9A8D4', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  timer: { color: '#FFF', fontSize: 12, fontWeight: '800' },
});
