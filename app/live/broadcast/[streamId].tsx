/**
 * app/live/broadcast/[streamId].tsx — Agora live stream broadcaster screen
 *
 * Lives under live/broadcast/ (not live/[streamId].tsx) because expo-router
 * forbids two different dynamic segment names in the same directory, and
 * app/live/[sessionId].tsx already occupies app/live/.
 *
 * Self-contained: creates its own row in the existing `live_sessions` /
 * `live_messages` tables (same schema already used by app/live/[sessionId].tsx)
 * so viewer count + chat work the same way, but drives the actual video with
 * Agora's LIVE_BROADCASTING profile instead of the placeholder video area.
 * Does not touch app/live/[sessionId].tsx, useLiveStream, or LiveCameraPreview.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, FlatList, TextInput, ActivityIndicator, Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { useAgoraEngine } from '@/hooks/useAgoraEngine';
import { RtcSurfaceView, useridToAgoraUid, isAgoraAvailable } from '@/services/agoraService';

const POLL_INTERVAL_MS = 3000;
const MAX_MESSAGES     = 50;
const REQUEST_TO_JOIN_TEXT = 'quiere subir al streaming';
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  createdAt: string;
}

function parseJoinRequest(message: string): string | null {
  const normalized = message.trim();
  if (!normalized.endsWith(REQUEST_TO_JOIN_TEXT)) return null;
  const username = normalized.slice(0, -REQUEST_TO_JOIN_TEXT.length).trim();
  return username || null;
}

function parseAcceptedUsername(message: string): string | null {
  if (!message.startsWith('\u2705 ') || !message.endsWith(' aceptado')) return null;
  return message.slice(2, -' aceptado'.length).trim() || null;
}

function parseRejectedUsername(message: string): string | null {
  if (!message.startsWith('\u274C ') || !message.endsWith(' rechazado')) return null;
  return message.slice(2, -' rechazado'.length).trim() || null;
}

export default function LiveBroadcasterScreen() {
  const { streamId } = useLocalSearchParams<{ streamId: string }>();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const myUid = user?.id ? useridToAgoraUid(user.id) : 0;

  const [title, setTitle]           = useState('');
  const [live, setLive]             = useState(false);
  const [starting, setStarting]     = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [liveSeconds, setLiveSeconds] = useState(0);

  const {
    engineReady, joined, error,
    remoteUids, isMuted, isCameraOff, localVideoReady, join, leave, toggleMute, toggleCamera, switchCamera,
  } = useAgoraEngine({ channelName: live ? streamId ?? null : null, uid: myUid, role: 'publisher', profile: 'live-broadcasting' });

  const chatRef    = useRef<FlatList>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgRef = useRef<string | null>(null);
  const endedRef   = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Start broadcast: create live_sessions row, then join Agora ──────────
  const handleGoLive = useCallback(async () => {
    if (!user?.id || !streamId || !title.trim() || starting) return;
    setStarting(true);
    try {
      await supabase.from('live_sessions').insert({
        id:           streamId,
        host_id:      user.id,
        title:        title.trim(),
        status:       'live',
        viewer_count: 0,
        started_at:   new Date().toISOString(),
      });
      setLive(true);
    } catch (_) {
      setStarting(false);
    }
  }, [user?.id, streamId, title, starting, supabase]);

  useEffect(() => {
    if (live && engineReady) join();
  }, [live, engineReady]);

  useEffect(() => {
    if (joined) setStarting(false);
  }, [joined]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setLiveSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);

  // ── Poll: viewer count + comments ────────────────────────────────────────
  const poll = useCallback(async () => {
    if (!streamId) return;
    try {
      const { data: sData } = await supabase
        .from('live_sessions').select('viewer_count').eq('id', streamId).single();
      if (sData && mountedRef.current) setViewerCount(sData.viewer_count ?? 0);

      let query = supabase
        .from('live_messages')
        .select('id, user_id, username, message, created_at')
        .eq('session_id', streamId)
        .order('created_at', { ascending: true })
        .limit(MAX_MESSAGES);
      if (lastMsgRef.current) query = query.gt('created_at', lastMsgRef.current);

      const { data: mData } = await query;
      if (mData && mData.length > 0 && mountedRef.current) {
        const newMsgs: ChatMessage[] = mData.map((m: any) => ({
          id: m.id, userId: m.user_id, username: m.username,
          message: m.message, createdAt: m.created_at,
        }));
        lastMsgRef.current = mData[mData.length - 1].created_at;
        setMessages(prev => [...prev, ...newMsgs].slice(-MAX_MESSAGES));
        setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
      }
    } catch (_) { /* ignore */ }
  }, [streamId, supabase]);

  useEffect(() => {
    if (!live) return;
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    poll();
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [live, poll]);

  // ── End broadcast ─────────────────────────────────────────────────────────
  const endBroadcast = useCallback(async () => {
    if (endedRef.current || !streamId) return;
    endedRef.current = true;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    await leave();
    try {
      await supabase
        .from('live_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', streamId);
    } catch { /* ignore */ }
    router.back();
  }, [streamId, leave, supabase, router]);

  useEffect(() => () => {
    if (!endedRef.current && live && streamId) {
      endedRef.current = true;
      leave();
      supabase
        .from('live_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', streamId)
        .then(() => {});
    }
  }, [live, streamId, leave, supabase]);

  const acceptJoinRequest = useCallback(async (username: string) => {
    if (!user?.id || !streamId) return;
    try {
      await supabase.from('live_messages').insert({
        session_id: streamId,
        user_id: user.id,
        username: user.username || user.email?.split('@')[0] || 'host',
        message: `\u2705 ${username} aceptado`,
      });
    } catch { /* ignore */ }
  }, [user, streamId, supabase]);

  const rejectJoinRequest = useCallback(async (username: string) => {
    if (!user?.id || !streamId) return;
    try {
      await supabase.from('live_messages').insert({
        session_id: streamId,
        user_id: user.id,
        username: user.username || user.email?.split('@')[0] || 'host',
        message: `\u274C ${username} rechazado`,
      });
    } catch { /* ignore */ }
  }, [user, streamId, supabase]);

  const formatLiveDuration = (seconds: number) =>
    `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  // ── Pre-live: title prompt ───────────────────────────────────────────────
  if (!live) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <StatusBar style="light" />
        <MaterialIcons name="live-tv" size={48} color={Colors.secondary} />
        <Text style={styles.setupTitle}>Ir en vivo</Text>
        <Text style={styles.setupSub}>Dale un título a tu transmisión</Text>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="¿De qué vas a hablar?"
          placeholderTextColor={Colors.textSubtle}
          maxLength={80}
          autoFocus
        />
        {!isAgoraAvailable() ? (
          <Text style={styles.errorText}>El streaming en vivo no está disponible en este dispositivo</Text>
        ) : null}
        <Pressable
          style={[styles.goLiveBtn, (!title.trim() || starting) && styles.goLiveBtnDisabled]}
          onPress={handleGoLive}
          disabled={!title.trim() || starting}
        >
          {starting
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.goLiveBtnText}>Comenzar transmisión</Text>}
        </Pressable>
        <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.md }}>
          <Text style={styles.cancelText}>Cancelar</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const closedRequestUsernames = new Set(
    messages
      .flatMap(m => [parseAcceptedUsername(m.message), parseRejectedUsername(m.message)])
      .filter((username): username is string => !!username),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {RtcSurfaceView && localVideoReady && !isCameraOff ? (
        <RtcSurfaceView canvas={{ uid: 0 }} style={styles.videoStream} />
      ) : (
        <View style={styles.videoPlaceholder}>
          <MaterialIcons name="videocam-off" size={40} color={Colors.textSubtle} />
        </View>
      )}

      <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent']} style={styles.topShade} pointerEvents="none" />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.6)']} style={styles.bottomShade} pointerEvents="none" />

      {RtcSurfaceView && remoteUids.length > 0 ? (
        <View style={styles.remoteStrip}>
          {remoteUids.map(uid => (
            <View key={uid} style={styles.remoteTile}>
              <RtcSurfaceView canvas={{ uid }} style={styles.remoteVideo} />
              <Text style={styles.remoteLabel}>Co-host</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* ── Header overlay ────────────────────────────────────────────────── */}
      <View style={[styles.header, { top: insets.top + 8 }]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.username || user?.email || 'H').charAt(0).toUpperCase()}</Text></View>
        <View style={styles.hostInfo}>
          <Text style={styles.hostName} numberOfLines={1}>{user?.username || user?.email?.split('@')[0] || 'Host'}</Text>
          <Text style={styles.hostHandle} numberOfLines={1}>Anfitrión</Text>
        </View>
        <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>EN VIVO</Text></View>
        <View style={styles.headerMetric}>
          <MaterialIcons name="visibility" size={14} color="#fff" />
          <Text style={styles.viewerChipText}>{viewerCount.toLocaleString()} viendo</Text>
        </View>
        <View style={styles.headerDivider} />
        <View style={styles.headerMetric}>
          <MaterialIcons name="schedule" size={14} color="#fff" />
          <Text style={styles.liveTimer}>{formatLiveDuration(liveSeconds)}</Text>
        </View>
        <Pressable style={styles.headerEndBtn} onPress={endBroadcast} hitSlop={8}>
          <MaterialIcons name="close" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={[styles.titleBlock, { top: insets.top + 88 }]}>
        <Text style={styles.streamTitle} numberOfLines={2}>{title.trim()}</Text>
        <View style={styles.conversationChip}>
          <MaterialIcons name="chat-bubble-outline" size={14} color="#fff" />
          <Text style={styles.conversationText}>Conversación</Text>
        </View>
      </View>

      {error ? (
        <View style={[styles.errorBanner, { top: insets.top + 48 }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Chat overlay ──────────────────────────────────────────────────── */}
      <View style={styles.chatArea}>
        <FlatList
          ref={chatRef}
          data={messages}
          keyExtractor={m => m.id}
          onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const requestedUsername = parseJoinRequest(item.message);
            return (
              <View style={msgStyles.row}>
                <Text style={msgStyles.name}>{item.username}</Text>
                <Text style={msgStyles.text}> {item.message}</Text>
                {requestedUsername !== null && !closedRequestUsernames.has(requestedUsername) ? (
                  <View style={msgStyles.requestActions}>
                    <Pressable
                      style={msgStyles.acceptBtn}
                      onPress={() => acceptJoinRequest(requestedUsername)}
                      hitSlop={6}
                    >
                      <Text style={msgStyles.actionText}>Aceptar</Text>
                    </Pressable>
                    <Pressable
                      style={msgStyles.rejectBtn}
                      onPress={() => rejectJoinRequest(requestedUsername)}
                      hitSlop={6}
                    >
                      <Text style={msgStyles.actionText}>Rechazar</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          }}
          contentContainerStyle={{ gap: 4, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.controlGroup}>
          <Pressable style={[styles.controlBtn, isMuted && styles.controlBtnActive]} onPress={toggleMute} hitSlop={8}>
            <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={20} color={isMuted ? '#000' : '#fff'} />
          </Pressable>
          <Text style={styles.controlLabel}>{isMuted ? 'Activar' : 'Silenciar'}</Text>
        </View>
        <View style={styles.controlGroup}>
          <Pressable style={styles.controlBtn} onPress={switchCamera} hitSlop={8}>
            <MaterialIcons name="flip-camera-ios" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.controlLabel}>Voltear</Text>
        </View>
        <Pressable style={styles.endBtn} onPress={endBroadcast} hitSlop={4}>
          <Text style={styles.endBtnText}>Finalizar</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const msgStyles = StyleSheet.create({
  row:  { flexDirection: 'row', flexWrap: 'wrap' },
  name: { color: Colors.primary, fontSize: 12, fontWeight: FontWeight.bold },
  text: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  requestActions: { flexDirection: 'row', gap: 6, marginLeft: 8 },
  acceptBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  rejectBtn: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  actionText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050508' },
  centered:  { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },

  setupTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, marginTop: Spacing.sm },
  setupSub:   { color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md },
  titleInput: {
    width: '100%', backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, color: Colors.textPrimary,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: FontSize.md, marginBottom: Spacing.md,
  },
  goLiveBtn: {
    width: '100%', backgroundColor: Colors.secondary, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
  },
  goLiveBtnDisabled: { opacity: 0.4 },
  goLiveBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  cancelText: { color: Colors.textSubtle, fontSize: FontSize.sm },

  videoStream:      { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 170, zIndex: 2 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 320, zIndex: 2 },
  remoteStrip: { position: 'absolute', right: 12, bottom: 116, width: 140, gap: 12, zIndex: 8 },
  remoteTile: { width: 140, height: 108, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1.5, borderColor: 'rgba(236,72,153,0.62)' },
  remoteVideo: { flex: 1 },
  remoteLabel: { position: 'absolute', left: 8, bottom: 7, color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },

  header: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(20,20,25,0.65)',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(124,92,255,0.7)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: FontWeight.bold },
  hostInfo: { flex: 1 },
  hostName: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  hostHandle: { color: 'rgba(255,255,255,0.65)', fontSize: 11 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FF2D55', borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 5,
  },
  liveDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  headerMetric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.16)' },
  liveTimer: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold, maxWidth: SCREEN_WIDTH < 380 ? 58 : 74 },
  viewerChipText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold, maxWidth: SCREEN_WIDTH < 380 ? 58 : 82 },
  headerEndBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,45,85,0.82)', alignItems: 'center', justifyContent: 'center' },
  titleBlock: { position: 'absolute', left: 16, right: 90, zIndex: 9 },
  streamTitle: { color: '#fff', fontSize: 24, fontWeight: FontWeight.bold },
  conversationChip: { marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  conversationText: { color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },

  errorBanner: { position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 10, backgroundColor: 'rgba(255,45,85,0.15)', borderRadius: Radius.sm, padding: Spacing.xs },
  errorText: { color: Colors.secondary, fontSize: 11, textAlign: 'center' },

  chatArea: {
    position: 'absolute',
    left: 12,
    width: SCREEN_WIDTH * 0.56,
    bottom: 108,
    maxHeight: SCREEN_HEIGHT * 0.32,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 7,
  },

  controls: {
    position: 'absolute', bottom: 0, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.lg,
    height: 82,
    paddingTop: 10,
    backgroundColor: 'rgba(20,20,30,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 28,
    zIndex: 9,
  },
  controlGroup: { alignItems: 'center', gap: 4 },
  controlBtn: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  controlBtnActive: { backgroundColor: Colors.textPrimary },
  controlLabel: { color: '#fff', fontSize: 11, fontWeight: FontWeight.medium },
  endBtn: { height: 58, backgroundColor: '#FF2D55', borderRadius: Radius.full, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  endBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
});
