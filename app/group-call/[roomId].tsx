/**
 * app/group-call/[roomId].tsx — Agora group video call (up to 6 participants)
 *
 * Anyone with the roomId link can join — no invite/accept flow (unlike the
 * 1:1 call). Participant names/avatars aren't known to Agora itself, so a
 * Supabase Realtime Presence channel scoped to the room pairs each Agora uid
 * with a username/avatar, and doubles as the join gate that caps the room
 * at MAX_PARTICIPANTS.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, Dimensions, Alert, Share } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { CallControlBar } from '@/components/feature/CallControlBar';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { useAgoraEngine } from '@/hooks/useAgoraEngine';
import { RtcSurfaceView, useridToAgoraUid, isAgoraAvailable } from '@/services/agoraService';

const { width: W } = Dimensions.get('window');
const MAX_PARTICIPANTS = 6;

interface Participant {
  uid: number;
  userId: string;
  username: string;
  avatar: string;
}

export default function GroupCallScreen() {
  const { roomId, creatorId } = useLocalSearchParams<{ roomId: string; creatorId?: string }>();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const myUid = user?.id ? useridToAgoraUid(user.id) : 0;
  const isCreator = !!user?.id && !!creatorId && user.id === creatorId;

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [showList, setShowList]         = useState(false);
  const [roomFull, setRoomFull]         = useState(false);
  const [duration, setDuration]         = useState(0);

  const presenceRef = useRef<any>(null);
  const mountedRef   = useRef(true);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef       = useRef(false);

  const {
    joined, error, remoteUids,
    isMuted, isCameraOff, localVideoReady, speakerOn,
    join, leave, toggleMute, toggleCamera, switchCamera, toggleSpeaker,
  } = useAgoraEngine({ channelName: roomId ?? null, uid: myUid, role: 'publisher', profile: 'communication' });

  const leaveRoom = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    await leave();
    try {
      await presenceRef.current?.untrack();
      presenceRef.current?.unsubscribe();
    } catch { /* ignore */ }
    if (mountedRef.current) router.back();
  }, [leave, router]);

  useEffect(() => {
    if (!roomId || !user?.id) return;

    if (isCreator) {
      supabase
        .from('group_call_rooms')
        .upsert({ id: roomId, host_id: user.id, status: 'active' })
        .then(({ error }) => {
          if (error) console.warn('[GROUP-CALL] room upsert failed', error);
        });
    }

    const roomChannel = supabase.channel(`group-room:${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'group_call_rooms', filter: `id=eq.${roomId}`,
      }, (payload: any) => {
        const row = payload.new as { status?: string };
        if (row.status === 'ended') leaveRoom();
      })
      .subscribe();

    return () => { roomChannel.unsubscribe(); };
  }, [roomId, user?.id, isCreator, leaveRoom, supabase]);

  // ── Presence: gate join at MAX_PARTICIPANTS, map uid → username/avatar ────
  useEffect(() => {
    mountedRef.current = true;
    if (!roomId || !user?.id) return;

    const channel = supabase.channel(`group-call:${roomId}`, {
      config: { presence: { key: String(myUid) } },
    });
    presenceRef.current = channel;

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const list: Participant[] = Object.values(state).flatMap((entries: any) =>
        (entries as any[]).map(e => ({ uid: e.uid, userId: e.userId, username: e.username, avatar: e.avatar })),
      );
      if (mountedRef.current) setParticipants(list);
    });

    channel.subscribe(async (status: string) => {
      if (status !== 'SUBSCRIBED' || !mountedRef.current) return;
      const currentCount = Object.keys(channel.presenceState()).length;
      if (currentCount >= MAX_PARTICIPANTS) {
        setRoomFull(true);
        return;
      }
      await channel.track({
        uid: myUid,
        userId: user.id,
        username: user.username || user.email?.split('@')[0] || 'Usuario',
        avatar: user.avatar || '',
      });
      join();
    });

    return () => {
      mountedRef.current = false;
      channel.unsubscribe();
    };
  }, [roomId, user?.id]);

  // ── Duration timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (joined) timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [joined]);

  const handleAddParticipant = useCallback(async () => {
    if (!roomId || !creatorId) return;
    console.log('[GROUP-CALL] add participant pressed');
    const invitePath = `/group-call/${roomId}?creatorId=${creatorId}`;
    console.log('[GROUP-CALL] invite link generated', invitePath);
    try {
      await Share.share({ message: invitePath });
    } catch {
      Alert.alert('Invitar participante', invitePath);
    }
  }, [roomId, creatorId]);

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleEndCall = useCallback(async () => {
    if (isCreator && roomId) {
      await supabase
        .from('group_call_rooms')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', roomId);
    }
    await leaveRoom();
  }, [isCreator, roomId, leaveRoom, supabase]);

  useEffect(() => () => {
    if (!endedRef.current) {
      endedRef.current = true;
      leave();
      try { presenceRef.current?.untrack(); presenceRef.current?.unsubscribe(); } catch { /* ignore */ }
    }
  }, [leave]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  // ── Room full — block before joining ─────────────────────────────────────
  if (roomFull) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <MaterialIcons name="group-off" size={48} color={Colors.textSubtle} />
        <Text style={styles.fullTitle}>Sala llena</Text>
        <Text style={styles.fullSub}>Esta sala ya tiene {MAX_PARTICIPANTS} participantes</Text>
        <Pressable style={styles.backBtnAlt} onPress={() => router.back()}>
          <Text style={styles.backBtnAltText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const totalTiles = remoteUids.length + 1;
  const columns    = totalTiles <= 1 ? 1 : totalTiles <= 4 ? 2 : 3;
  const tileWidth  = `${100 / columns}%` as const;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Text style={styles.headerTitle}>{joined ? fmt(duration) : 'Conectando...'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isCreator ? (
            <Pressable style={styles.addParticipantBtn} onPress={handleAddParticipant} hitSlop={8}>
              <MaterialIcons name="person-add" size={16} color="#fff" />
              <Text style={styles.addParticipantText}>Agregar participante</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.participantsBtn} onPress={() => setShowList(true)} hitSlop={8}>
            <MaterialIcons name="groups" size={16} color="#fff" />
            <Text style={styles.participantsBtnText}>{totalTiles}/{MAX_PARTICIPANTS}</Text>
          </Pressable>
        </View>
      </View>

      {!isAgoraAvailable() ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Las llamadas grupales no están disponibles en este dispositivo</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {/* Local tile */}
          <View style={[styles.tile, { width: tileWidth }]}>
            {RtcSurfaceView && localVideoReady && !isCameraOff ? (
              <RtcSurfaceView canvas={{ uid: 0 }} style={{ flex: 1 }} zOrderMediaOverlay />
            ) : (
              <View style={styles.tilePlaceholder}>
                <Text style={styles.tileInitial}>
                  {(user?.username || 'Y').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.tileLabel}>
              {isMuted ? <MaterialIcons name="mic-off" size={11} color="#fff" /> : null}
              <Text style={styles.tileLabelText} numberOfLines={1}>Tú</Text>
            </View>
          </View>

          {/* Remote tiles */}
          {remoteUids.map(uid => {
            const p = participants.find(pp => pp.uid === uid);
            return (
              <View key={uid} style={[styles.tile, { width: tileWidth }]}>
                {RtcSurfaceView ? (
                  <RtcSurfaceView canvas={{ uid }} style={{ flex: 1 }} zOrderMediaOverlay />
                ) : null}
                <View style={styles.tileLabel}>
                  <Text style={styles.tileLabelText} numberOfLines={1}>
                    {p?.username ? `@${p.username}` : 'Participante'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <CallControlBar
          isMuted={isMuted}
          onToggleMute={toggleMute}
          isCameraOff={isCameraOff}
          onToggleCamera={toggleCamera}
          speakerOn={speakerOn}
          onToggleSpeaker={toggleSpeaker}
          onHangup={handleEndCall}
          onSwitchCamera={switchCamera}
          showCamera
          showSwitchCamera
        />
      </View>

      {/* ── Participant list ─────────────────────────────────────────────── */}
      {showList ? (
        <View style={styles.listOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowList(false)} />
          <View style={[styles.listPanel, { paddingBottom: insets.bottom + Spacing.md }]}>
            <Text style={styles.listTitle}>Participantes ({participants.length})</Text>
            <FlatList
              data={participants}
              keyExtractor={p => String(p.uid)}
              renderItem={({ item }) => (
                <View style={styles.listRow}>
                  {item.avatar ? (
                    <Image source={{ uri: item.avatar }} style={styles.listAvatar} contentFit="cover" />
                  ) : (
                    <View style={styles.listAvatarFallback}>
                      <Text style={styles.listAvatarInitial}>{(item.username || 'U').charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.listName}>
                    {item.userId === user?.id ? 'Tú' : `@${item.username}`}
                  </Text>
                </View>
              )}
            />
          </View>
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },
  centered:  { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, flex: 1, paddingHorizontal: Spacing.xl },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm,
  },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  participantsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  addParticipantBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  addParticipantText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold },
  participantsBtnText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold },

  errorText: { color: Colors.secondary, fontSize: FontSize.sm, textAlign: 'center' },

  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' },
  tile: { aspectRatio: 3 / 4, borderWidth: 0.5, borderColor: '#000', backgroundColor: Colors.surface, position: 'relative' },
  tilePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceElevated },
  tileInitial: { color: Colors.primary, fontSize: 28, fontWeight: FontWeight.bold },
  tileLabel: {
    position: 'absolute', bottom: 4, left: 4, right: 4,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  tileLabelText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.medium, flexShrink: 1 },

  controls:   { paddingHorizontal: Spacing.md, paddingTop: Spacing.md },

  fullTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  fullSub:   { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center' },
  backBtnAlt: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border, marginTop: Spacing.sm },
  backBtnAltText: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  listOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  listPanel: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    padding: Spacing.lg, maxHeight: '55%', borderWidth: 1, borderColor: Colors.border,
  },
  listTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold, marginBottom: Spacing.sm },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  listAvatar: { width: 36, height: 36, borderRadius: 18 },
  listAvatarFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  listAvatarInitial: { color: Colors.primary, fontSize: 14, fontWeight: FontWeight.bold },
  listName: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
});
