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
import { View, Text, Pressable, StyleSheet, FlatList, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
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
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const myUid = user?.id ? useridToAgoraUid(user.id) : 0;

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
    isMuted, isCameraOff, join, leave, toggleMute, toggleCamera, switchCamera,
  } = useAgoraEngine({ channelName: roomId ?? null, uid: myUid, role: 'publisher', profile: 'communication' });

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

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleEndCall = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    await leave();
    try {
      await presenceRef.current?.untrack();
      presenceRef.current?.unsubscribe();
    } catch { /* ignore */ }
    router.back();
  }, [leave, router]);

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
        <Pressable style={styles.participantsBtn} onPress={() => setShowList(true)} hitSlop={8}>
          <MaterialIcons name="groups" size={16} color="#fff" />
          <Text style={styles.participantsBtnText}>{totalTiles}/{MAX_PARTICIPANTS}</Text>
        </Pressable>
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
            {RtcSurfaceView && !isCameraOff ? (
              <RtcSurfaceView canvas={{ uid: 0 }} style={{ flex: 1 }} />
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
                  <RtcSurfaceView canvas={{ uid }} style={{ flex: 1 }} />
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
        <View style={styles.controlRow}>
          <Pressable style={[styles.controlBtn, isMuted && styles.controlBtnActive]} onPress={toggleMute} hitSlop={8}>
            <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={22} color={isMuted ? '#000' : '#fff'} />
          </Pressable>
          <Pressable style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]} onPress={toggleCamera} hitSlop={8}>
            <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={22} color={isCameraOff ? '#000' : '#fff'} />
          </Pressable>
          <Pressable style={styles.controlBtn} onPress={switchCamera} hitSlop={8}>
            <MaterialIcons name="flip-camera-ios" size={22} color="#fff" />
          </Pressable>
          <Pressable style={styles.endCallBtn} onPress={handleEndCall} hitSlop={4}>
            <MaterialIcons name="call-end" size={26} color="#fff" />
          </Pressable>
        </View>
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

  controls:   { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.lg },
  controlBtn: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  controlBtnActive: { backgroundColor: Colors.textPrimary },
  endCallBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },

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
