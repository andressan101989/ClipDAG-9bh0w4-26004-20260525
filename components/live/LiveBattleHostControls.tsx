import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from '@/components/ui/SafeImage';
import {
  getLiveBattlePublicProfiles,
  listLiveBattleOpponentCandidates,
  type LiveBattle,
  type LiveBattleInviteDecision,
  type LiveBattleOpponentCandidate,
  type LiveBattlePublicProfile,
} from '@/services/liveBattleService';
import type { LiveBattleRuntimeSnapshot } from '@/services/liveBattleRuntimeController';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

type BattleAction = (battleId: string) => Promise<LiveBattle | null>;

type Props = {
  enabled: boolean;
  hostUserId: string;
  liveSessionId: string;
  presentationTick: number;
  snapshot: LiveBattleRuntimeSnapshot;
  actionPending: boolean;
  actionError: string | null;
  invite: (input: {
    opponentUserId: string;
    challengerSessionId: string;
    opponentSessionId: string;
  }) => Promise<LiveBattle | null>;
  respond: (battleId: string, decision: LiveBattleInviteDecision) => Promise<LiveBattle | null>;
  start: BattleAction;
  cancel: BattleAction;
  reconcile: () => Promise<void>;
  clearActionError: () => void;
  dismissTerminalBattle: () => void;
};

function secondsUntil(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.ceil((value - Date.now()) / 1000));
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function safeActionMessage(code: string | null): string | null {
  if (!code) return null;
  if (code === 'live_battle_session_not_live' || code === 'live_battle_host_authority_changed') {
    return 'El creador ya no está LIVE.';
  }
  if (code.includes('expired') || code.includes('terminal') || code.includes('state_invalid')) {
    return 'La invitación ya no está disponible.';
  }
  if (code === 'live_battle_pair_busy' || code === 'live_battle_participant_busy') {
    return 'La Battle cambió; estado actualizado.';
  }
  return 'No se pudo completar la acción. Estado actualizado.';
}

function Avatar({ uri, username }: { uri: string | null; username: string }) {
  if (uri) return <Image source={{ uri }} style={styles.avatar} contentFit="cover" />;
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitial}>{username.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export function LiveBattleHostControls({
  enabled,
  hostUserId,
  liveSessionId,
  presentationTick,
  snapshot,
  actionPending,
  actionError,
  invite,
  respond,
  start,
  cancel,
  reconcile,
  clearActionError,
  dismissTerminalBattle,
}: Props) {
  const battle = snapshot.battle;
  const [visible, setVisible] = useState(false);
  const [candidates, setCandidates] = useState<LiveBattleOpponentCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState(false);
  const [profiles, setProfiles] = useState<Map<string, LiveBattlePublicProfile>>(new Map());
  const loadGeneration = useRef(0);
  const autoOpenedBattle = useRef<string | null>(null);

  const isChallenger = battle?.challengerUserId === hostUserId;
  const isOpponent = battle?.opponentUserId === hostUserId;
  const runtimeBlocked = snapshot.status === 'failed'
    && snapshot.errorCode !== 'live_battle_relay_failed';
  const canAct = enabled && !runtimeBlocked;
  const actionDisabled = actionPending || !canAct;
  const counterpartId = isChallenger ? battle?.opponentUserId : battle?.challengerUserId;
  const counterpart = counterpartId ? profiles.get(counterpartId) : undefined;

  const loadCandidates = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadingCandidates(true);
    setCandidateError(false);
    try {
      const next = await listLiveBattleOpponentCandidates({
        currentSessionId: liveSessionId,
        currentHostUserId: hostUserId,
      });
      if (generation === loadGeneration.current) setCandidates(next);
    } catch {
      if (generation === loadGeneration.current) {
        setCandidates([]);
        setCandidateError(true);
      }
    } finally {
      if (generation === loadGeneration.current) setLoadingCandidates(false);
    }
  }, [hostUserId, liveSessionId]);

  useEffect(() => () => { loadGeneration.current += 1; }, []);

  useEffect(() => {
    if (!battle) {
      setProfiles(new Map());
      return;
    }
    const generation = ++loadGeneration.current;
    void getLiveBattlePublicProfiles([battle.challengerUserId, battle.opponentUserId])
      .then(rows => {
        if (generation !== loadGeneration.current) return;
        setProfiles(new Map(rows.map(profile => [profile.userId, profile])));
      })
      .catch(() => undefined);
  }, [battle]);

  useEffect(() => {
    if (battle?.status !== 'pending' || !isOpponent) return;
    if (autoOpenedBattle.current === battle.id) return;
    autoOpenedBattle.current = battle.id;
    setVisible(true);
  }, [battle?.id, battle?.status, isOpponent]);

  useEffect(() => {
    if (battle || !visible || runtimeBlocked) return;
    void loadCandidates();
  }, [battle, loadCandidates, runtimeBlocked, visible]);

  const open = useCallback(() => {
    if (!enabled) return;
    clearActionError();
    setVisible(true);
  }, [clearActionError, enabled]);

  const close = useCallback(() => {
    loadGeneration.current += 1;
    setVisible(false);
    clearActionError();
    if (battle && ['completed', 'rejected', 'cancelled', 'expired'].includes(battle.status)) {
      dismissTerminalBattle();
    }
  }, [battle, clearActionError, dismissTerminalBattle]);

  const handleInvite = useCallback(async (candidate: LiveBattleOpponentCandidate) => {
    if (!canAct || actionPending) return;
    await invite({
      opponentUserId: candidate.hostUserId,
      challengerSessionId: liveSessionId,
      opponentSessionId: candidate.liveSessionId,
    });
  }, [actionPending, canAct, invite, liveSessionId]);

  const pendingSeconds = useMemo(
    () => {
      void presentationTick;
      return secondsUntil(battle?.status === 'pending' ? battle.inviteExpiresAt : null);
    },
    [battle?.inviteExpiresAt, battle?.status, presentationTick],
  );
  const countdownSeconds = useMemo(
    () => {
      void presentationTick;
      return secondsUntil(battle?.status === 'countdown' ? battle.scheduledStartAt : null);
    },
    [battle?.scheduledStartAt, battle?.status, presentationTick],
  );
  const activeSeconds = useMemo(
    () => {
      void presentationTick;
      return secondsUntil(battle?.status === 'active' ? battle.scheduledEndAt : null);
    },
    [battle?.scheduledEndAt, battle?.status, presentationTick],
  );

  const statusLabel = battle?.status === 'pending'
    ? (isChallenger ? 'Invitación enviada' : 'Invitación Battle')
    : battle?.status === 'accepted'
      ? 'Battle aceptada'
      : battle?.status === 'countdown'
        ? 'La Battle comienza'
        : battle?.status === 'active'
          ? 'Battle activa'
          : battle ? 'Battle finalizada' : 'Elige un host LIVE';

  return (
    <>
      <Pressable
        style={[styles.railAction, battle && styles.railActionActive, !enabled && styles.disabled]}
        onPress={open}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel="Abrir controles Battle"
        accessibilityState={{ disabled: !enabled, busy: actionPending }}
      >
        <MaterialIcons name="sports-mma" size={22} color={battle ? '#F9A8D4' : '#F8FAFC'} />
        <Text style={styles.railLabel}>Battle</Text>
        {battle ? <View style={styles.badge} /> : null}
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Cerrar Battle" />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.titleRow}>
                <MaterialIcons name="sports-mma" size={22} color="#F472B6" />
                <Text style={styles.title}>{statusLabel}</Text>
              </View>
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Cerrar controles Battle" hitSlop={8}>
                <MaterialIcons name="close" size={24} color="#F8FAFC" />
              </Pressable>
            </View>

            {safeActionMessage(actionError) ? (
              <View style={styles.errorBox}><Text style={styles.errorText}>{safeActionMessage(actionError)}</Text></View>
            ) : null}

            {!battle && runtimeBlocked ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>El estado Battle no está disponible.</Text>
                <Pressable style={styles.secondaryButton} onPress={() => void reconcile()} accessibilityRole="button" accessibilityLabel="Actualizar estado Battle">
                  <Text style={styles.secondaryButtonText}>Actualizar estado</Text>
                </Pressable>
              </View>
            ) : !battle ? (
              <>
                {loadingCandidates ? <ActivityIndicator color={Colors.primary} style={styles.loader} /> : null}
                {!loadingCandidates && candidateError ? (
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptyText}>No se pudieron cargar los hosts LIVE.</Text>
                    <Pressable style={styles.secondaryButton} onPress={() => void loadCandidates()} accessibilityRole="button" accessibilityLabel="Reintentar cargar hosts LIVE">
                      <Text style={styles.secondaryButtonText}>Reintentar</Text>
                    </Pressable>
                  </View>
                ) : null}
                {!loadingCandidates && !candidateError && candidates.length === 0 ? (
                  <Text style={styles.emptyText}>No hay otros hosts LIVE disponibles.</Text>
                ) : null}
                <FlatList
                  data={candidates}
                  keyExtractor={item => item.liveSessionId}
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => (
                    <View style={styles.candidateRow}>
                      <Avatar uri={item.avatarUrl} username={item.username} />
                      <View style={styles.candidateCopy}>
                        <Text style={styles.username} numberOfLines={1}>@{item.username}</Text>
                        <Text style={styles.subtitle} numberOfLines={1}>{item.title || 'LIVE en curso'}</Text>
                      </View>
                      <Pressable
                        style={[styles.primaryButton, actionDisabled && styles.disabled]}
                        disabled={actionDisabled}
                        onPress={() => void handleInvite(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`Invitar a ${item.username} a Battle`}
                        accessibilityState={{ disabled: actionDisabled, busy: actionPending }}
                      >
                        {actionPending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryButtonText}>Invitar</Text>}
                      </Pressable>
                    </View>
                  )}
                />
              </>
            ) : (
              <View style={styles.battleBody}>
                <View style={styles.counterpartRow}>
                  <Avatar uri={counterpart?.avatarUrl ?? null} username={counterpart?.username ?? 'Host'} />
                  <View style={styles.candidateCopy}>
                    <Text style={styles.username}>@{counterpart?.username ?? 'Host'}</Text>
                    <Text style={styles.subtitle}>{isChallenger ? 'Oponente' : 'Challenger'}</Text>
                  </View>
                </View>

                {battle.status === 'pending' ? (
                  <Text style={styles.statusText}>
                    {isChallenger ? 'Esperando respuesta' : 'Te invitó a una Battle'} · {formatClock(pendingSeconds)}
                  </Text>
                ) : null}
                {battle.status === 'accepted' ? (
                  <Text style={styles.statusText}>{isChallenger ? 'Lista para iniciar' : 'Esperando que el challenger inicie'}</Text>
                ) : null}
                {battle.status === 'countdown' ? (
                  <Text style={styles.countdown}>{Math.max(1, countdownSeconds ?? 1)}</Text>
                ) : null}
                {battle.status === 'active' ? (
                  <Text style={styles.activeTimer}>{formatClock(activeSeconds)}</Text>
                ) : null}

                <View style={styles.actionRow}>
                  {battle.status === 'pending' && isOpponent ? (
                    <>
                      <Pressable style={[styles.secondaryButton, actionDisabled && styles.disabled]} disabled={actionDisabled} onPress={() => void respond(battle.id, 'reject')} accessibilityRole="button" accessibilityLabel="Rechazar invitación Battle">
                        <Text style={styles.secondaryButtonText}>Rechazar</Text>
                      </Pressable>
                      <Pressable style={[styles.primaryButton, actionDisabled && styles.disabled]} disabled={actionDisabled} onPress={() => void respond(battle.id, 'accept')} accessibilityRole="button" accessibilityLabel="Aceptar invitación Battle">
                        {actionPending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryButtonText}>Aceptar</Text>}
                      </Pressable>
                    </>
                  ) : null}
                  {battle.status === 'accepted' && isChallenger ? (
                    <Pressable style={[styles.primaryButton, styles.growButton, actionDisabled && styles.disabled]} disabled={actionDisabled} onPress={() => void start(battle.id)} accessibilityRole="button" accessibilityLabel="Iniciar countdown Battle">
                      {actionPending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryButtonText}>Iniciar</Text>}
                    </Pressable>
                  ) : null}
                  {['pending', 'accepted', 'countdown', 'active'].includes(battle.status) ? (
                    <Pressable style={[styles.cancelButton, actionDisabled && styles.disabled]} disabled={actionDisabled} onPress={() => void cancel(battle.id)} accessibilityRole="button" accessibilityLabel="Cancelar Battle">
                      <Text style={styles.cancelButtonText}>Cancelar</Text>
                    </Pressable>
                  ) : null}
                </View>

                {snapshot.errorCode ? (
                  <Pressable style={styles.secondaryButton} onPress={() => void reconcile()} accessibilityRole="button" accessibilityLabel="Actualizar estado Battle">
                    <Text style={styles.secondaryButtonText}>Actualizar estado</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  railAction: { width: 55, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 18 },
  railActionActive: { backgroundColor: 'rgba(244,114,182,0.18)' },
  railLabel: { color: '#D8DCE6', fontSize: 9, fontWeight: FontWeight.semibold },
  badge: { position: 'absolute', right: 8, top: 3, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF2D78' },
  disabled: { opacity: 0.45 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { maxHeight: '72%', minHeight: 240, padding: Spacing.lg, paddingBottom: 30, gap: Spacing.md, backgroundColor: '#12151D', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  title: { color: '#F8FAFC', fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  loader: { marginVertical: 28 },
  list: { flexGrow: 0 },
  listContent: { gap: Spacing.sm, paddingBottom: 8 },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 66, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.055)' },
  counterpartRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(168,85,247,0.22)' },
  avatarInitial: { color: '#E9D5FF', fontSize: 17, fontWeight: FontWeight.bold },
  candidateCopy: { flex: 1, minWidth: 0 },
  username: { color: '#F8FAFC', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  subtitle: { color: '#A4AAB8', fontSize: FontSize.xs, marginTop: 2 },
  primaryButton: { minWidth: 78, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#A855F7' },
  primaryButtonText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  secondaryButton: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  secondaryButtonText: { color: '#F8FAFC', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  cancelButton: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,45,85,0.16)', borderWidth: 1, borderColor: 'rgba(255,45,85,0.45)' },
  cancelButtonText: { color: '#FDA4AF', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  growButton: { flex: 1 },
  battleBody: { gap: Spacing.md },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm, flexWrap: 'wrap' },
  statusText: { color: '#D8DCE6', fontSize: FontSize.sm, textAlign: 'center' },
  countdown: { color: '#F472B6', fontSize: 56, fontWeight: FontWeight.bold, textAlign: 'center' },
  activeTimer: { color: '#F8FAFC', fontSize: 28, fontWeight: FontWeight.bold, textAlign: 'center' },
  errorBox: { padding: Spacing.sm, borderRadius: Radius.sm, backgroundColor: 'rgba(255,45,85,0.12)' },
  errorText: { color: '#FDA4AF', fontSize: FontSize.xs, textAlign: 'center' },
  emptyBox: { gap: Spacing.sm, alignItems: 'center' },
  emptyText: { color: '#A4AAB8', fontSize: FontSize.sm, textAlign: 'center', paddingVertical: Spacing.lg },
});
