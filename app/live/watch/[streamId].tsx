/**
 * app/live/watch/[streamId].tsx — Agora live stream viewer screen
 *
 * Reads/writes the same `live_sessions` / `live_messages` / `gifts` tables
 * as app/live/[sessionId].tsx (that file is untouched), but subscribes to
 * the broadcaster's actual Agora video instead of showing a placeholder.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, FlatList, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions,
  Alert,
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
import { RtcSurfaceView, useridToAgoraUid } from '@/services/agoraService';

const POLL_INTERVAL_MS = 3000;
const MAX_MESSAGES     = 50;
const SPAM_THROTTLE_MS = 2500;
const REQUEST_TO_JOIN_TEXT = 'quiere subir al streaming';
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface StreamSession {
  id: string;
  hostId: string;
  hostUsername: string;
  title: string;
  viewerCount: number;
  status: 'live' | 'ended';
}

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  createdAt: string;
}

const LIVE_GIFT_BAR = [
  { id: 'star', emoji: '\u2B50', label: 'Estrella', cost: 10 },
  { id: 'crown', emoji: '\uD83D\uDC51', label: 'Corona', cost: 100 },
  { id: 'diamond', emoji: '\uD83D\uDC8E', label: 'Diamante', cost: 500 },
  { id: 'rose', emoji: '\uD83C\uDF39', label: 'Rosa', cost: 10 },
];

function getDisplayUsername(user: any): string {
  return user?.username || user?.email?.split('@')[0] || 'user';
}

export default function LiveWatchScreen() {
  const { streamId } = useLocalSearchParams<{ streamId: string }>();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const myUid = user?.id ? useridToAgoraUid(user.id) : 0;

  const [session,  setSession]  = useState<StreamSession | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [ended,    setEnded]    = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sending,   setSending]   = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [promotedToPublisher, setPromotedToPublisher] = useState(false);
  const [watchSeconds, setWatchSeconds] = useState(0);

  const {
    engineReady, remoteUids, error, join, leave, promoteToPublisher,
  } = useAgoraEngine({ channelName: session?.status === 'live' ? streamId ?? null : null, uid: myUid, role: 'subscriber', profile: 'live-broadcasting' });

  const chatRef     = useRef<FlatList>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgRef  = useRef<string | null>(null);
  const lastSentRef = useRef(0);
  const mountedRef  = useRef(true);
  const leftRef     = useRef(false);
  const viewerCountBumpedRef = useRef(false);
  const promotingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch session ─────────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    if (!streamId) return false;
    try {
      const { data, error: err } = await supabase
        .from('live_sessions')
        .select(`id, host_id, title, status, viewer_count, user_profiles!live_sessions_host_id_fkey(username)`)
        .eq('id', streamId)
        .single();

      if (err || !data) { setEnded(true); setLoading(false); return false; }

      setSession({
        id:           data.id,
        hostId:       data.host_id,
        hostUsername: (data as any).user_profiles?.username ?? 'Creator',
        title:        data.title ?? '',
        viewerCount:  data.viewer_count ?? 0,
        status:       data.status as 'live' | 'ended',
      });
      if (data.status !== 'live') setEnded(true);
      setLoading(false);
      return data.status === 'live';
    } catch (_) { setLoading(false); return false; }
  }, [streamId, supabase]);

  // ── Join Agora once session confirmed live ──────────────────────────────
  useEffect(() => {
    if (session?.status === 'live' && engineReady) join();
  }, [session?.status, engineReady]);

  useEffect(() => {
    if (session?.status !== 'live') return;
    const timer = setInterval(() => setWatchSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [session?.status]);

  // ── Viewer count +1 / -1 ─────────────────────────────────────────────────
  // Atomic RPC — the previous read-then-write (select viewer_count, then
  // update with the computed value) lost updates whenever two viewers
  // joined/left concurrently, since both would read the same stale count
  // before either write landed.
  const bumpViewerCount = useCallback(async (delta: 1 | -1) => {
    if (!streamId) return;
    try {
      await supabase.rpc('increment_live_viewer_count', { p_session_id: streamId, p_delta: delta });
    } catch (_) { /* ignore */ }
  }, [streamId, supabase]);

  // ── Poll: session status + viewer count + messages ──────────────────────
  const poll = useCallback(async () => {
    if (!streamId || ended) return;
    try {
      const { data: sData } = await supabase
        .from('live_sessions').select('viewer_count, status').eq('id', streamId).single();
      if (sData) {
        setSession(prev => prev ? { ...prev, viewerCount: sData.viewer_count ?? prev.viewerCount } : prev);
        if (sData.status === 'ended') {
          setEnded(true);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          return;
        }
      }

      let query = supabase
        .from('live_messages')
        .select('id, user_id, username, message, created_at')
        .eq('session_id', streamId)
        .order('created_at', { ascending: true })
        .limit(MAX_MESSAGES);
      if (lastMsgRef.current) query = query.gt('created_at', lastMsgRef.current);

      const { data: mData } = await query;
      if (mData && mData.length > 0) {
        const newMsgs: ChatMessage[] = mData.map((m: any) => ({
          id: m.id, userId: m.user_id, username: m.username,
          message: m.message, createdAt: m.created_at,
        }));
        const username = getDisplayUsername(user);
        if (!promotedToPublisher && !promotingRef.current && newMsgs.some(m => m.message === `\u2705 ${username} aceptado`)) {
          promotingRef.current = true;
          promoteToPublisher().then(ok => {
            if (ok && mountedRef.current) setPromotedToPublisher(true);
            if (!ok) promotingRef.current = false;
          });
        }
        lastMsgRef.current = mData[mData.length - 1].created_at;
        setMessages(prev => [...prev, ...newMsgs].slice(-MAX_MESSAGES));
        setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
      }
    } catch (_) { /* ignore */ }
  }, [streamId, ended, supabase, user, promotedToPublisher, promoteToPublisher]);

  useEffect(() => {
    if (!streamId) { router.back(); return; }
    viewerCountBumpedRef.current = false;
    fetchSession().then(isLive => {
      if (!isLive || leftRef.current) return;
      viewerCountBumpedRef.current = true;
      bumpViewerCount(1);
    });
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (!leftRef.current) { leftRef.current = true; leave(); }
      if (viewerCountBumpedRef.current) {
        viewerCountBumpedRef.current = false;
        bumpViewerCount(-1);
      }
    };
  }, [streamId]);

  // ── Send message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !user || !streamId || sending) return;
    const now = Date.now();
    if (now - lastSentRef.current < SPAM_THROTTLE_MS) return;
    lastSentRef.current = now;
    setSending(true);
    setChatInput('');

    const optimistic: ChatMessage = {
      id: `local_${now}`, userId: user.id,
      username: user.username || user.email?.split('@')[0] || 'user',
      message: text, createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic].slice(-MAX_MESSAGES));
    setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      await supabase.from('live_messages').insert({
        session_id: streamId, user_id: user.id,
        username: user.username || user.email?.split('@')[0] || 'user',
        message: text,
      });
    } catch (_) { /* ignore */ }
    setSending(false);
  }, [chatInput, user, streamId, sending, supabase]);

  const requestToJoin = useCallback(async () => {
    if (!user || !streamId || requestSent || promotedToPublisher) return;
    const now = Date.now();
    const username = getDisplayUsername(user);
    const text = ` ${username} ${REQUEST_TO_JOIN_TEXT}`;

    setRequestSent(true);
    const optimistic: ChatMessage = {
      id: `request_${now}`,
      userId: user.id,
      username,
      message: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic].slice(-MAX_MESSAGES));
    setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const { error: insertError } = await supabase.from('live_messages').insert({
        session_id: streamId,
        user_id: user.id,
        username,
        message: text,
      });
      if (insertError) throw insertError;
    } catch (_) {
      setRequestSent(false);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      Alert.alert('No se pudo enviar la solicitud');
    }
  }, [user, streamId, requestSent, promotedToPublisher, supabase]);

  const formatLiveDuration = (seconds: number) =>
    `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Cargando live...</Text>
      </SafeAreaView>
    );
  }

  if (ended || !session) {
    return (
      <SafeAreaView style={styles.endedScreen}>
        <StatusBar style="light" />
        <MaterialIcons name="live-tv" size={52} color={Colors.secondary} />
        <Text style={styles.endedTitle}>Este live ha terminado</Text>
        <Pressable onPress={() => router.back()} style={styles.endedBtn}>
          <Text style={styles.endedBtnText}>Volver</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const remoteUid = remoteUids[0];
  const coHostUids = remoteUids.slice(1);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {RtcSurfaceView && remoteUid !== undefined ? (
        <RtcSurfaceView canvas={{ uid: remoteUid }} style={styles.videoStream} />
      ) : (
        <View style={styles.videoPlaceholder}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.waitingText}>Conectando con el stream...</Text>
        </View>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent']} style={styles.topShade} pointerEvents="none" />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.58)']} style={styles.bottomShade} pointerEvents="none" />

      <View style={[styles.header, { top: insets.top + 8 }]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{session.hostUsername.charAt(0).toUpperCase()}</Text></View>
        <View style={styles.hostInfo}>
          <Text style={styles.hostName} numberOfLines={1}>{session.hostUsername}</Text>
          <Text style={styles.hostTitle} numberOfLines={1}>@{session.hostUsername}</Text>
        </View>
        <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>EN VIVO</Text></View>
        <View style={styles.headerMetric}>
          <MaterialIcons name="visibility" size={14} color="#fff" />
          <Text style={styles.headerMetricText}>{session.viewerCount.toLocaleString()} viendo</Text>
        </View>
        <View style={styles.headerDivider} />
        <View style={styles.headerMetric}>
          <MaterialIcons name="schedule" size={14} color="#fff" />
          <Text style={styles.headerMetricText}>{formatLiveDuration(watchSeconds)}</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn}>
          <MaterialIcons name="close" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={[styles.titleBlock, { top: insets.top + 88 }]}>
        <Text style={styles.streamTitle} numberOfLines={2}>{session.title}</Text>
        <View style={styles.conversationChip}>
          <MaterialIcons name="chat-bubble-outline" size={14} color="#fff" />
          <Text style={styles.conversationText}>Conversación</Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>
      ) : null}

      {/* ── Chat + controls ──────────────────────────────────────────────── */}
      <View style={styles.actionRail}>
        <View style={styles.actionButton}>
          <MaterialIcons name="favorite" size={25} color="#fff" />
          <Text style={styles.actionCount}>Me gusta</Text>
        </View>
        <View style={styles.actionButton}>
          <MaterialIcons name="ios-share" size={24} color="#fff" />
          <Text style={styles.actionCount}>Compartir</Text>
        </View>
        <View style={styles.actionButton}>
          <MaterialIcons name="card-giftcard" size={24} color="#fff" />
          <Text style={styles.actionCount}>Regalos</Text>
        </View>
      </View>

      {coHostUids.length > 0 && RtcSurfaceView ? (
        <View style={styles.coHostStrip}>
          {coHostUids.slice(0, 2).map(uid => (
            <View key={uid} style={styles.coHostTile}>
              <RtcSurfaceView canvas={{ uid }} style={styles.coHostVideo} />
              <View style={styles.coHostMic}><MaterialIcons name="mic" size={13} color="#fff" /></View>
              <Text style={styles.coHostName}>Invitado</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.bottomSection}>
        <FlatList
          ref={chatRef}
          data={messages}
          keyExtractor={item => item.id}
          onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={msg.row}>
              <Text style={[msg.name, item.userId === session.hostId && msg.hostName]}>
                {item.userId === session.hostId ? '🎥 ' : ''}{item.username}
              </Text>
              <Text style={msg.text}> {item.message}</Text>
            </View>
          )}
          style={styles.chatList}
          contentContainerStyle={{ gap: 6, paddingVertical: 8, paddingHorizontal: Spacing.md }}
          showsVerticalScrollIndicator={false}
        />

        <View style={styles.giftBar}>
          {LIVE_GIFT_BAR.map(g => (
            <Pressable
              key={g.id}
              style={[styles.giftBtn, styles.giftBtnDisabled]}
              disabled
            >
              <Text style={styles.giftEmoji}>{g.emoji}</Text>
              <Text style={styles.giftLabel}>{g.label}</Text>
              <Text style={styles.giftCost}>{g.cost}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.giftBtn, styles.giftBtnDisabled]} disabled>
            <MaterialIcons name="add" size={21} color="#fff" />
            <Text style={styles.giftLabel}>Más</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}
        >
          <TextInput
            style={styles.input}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder="Escribe un mensaje..."
            placeholderTextColor="rgba(255,255,255,0.55)"
            returnKeyType="send"
            onSubmitEditing={sendMessage}
            maxLength={200}
            blurOnSubmit={false}
            editable={!!user}
          />
          <Pressable
            style={[styles.sendBtn, (!chatInput.trim() || sending) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!chatInput.trim() || sending || !user}
            hitSlop={8}
          >
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="send" size={18} color="#fff" />}
          </Pressable>
          <Pressable
            style={[styles.requestBtn, (requestSent || promotedToPublisher || !user) && styles.requestBtnDisabled]}
            onPress={requestToJoin}
            disabled={requestSent || promotedToPublisher || !user}
          >
            <LinearGradient colors={['#EC4899', '#7C3AED']} style={styles.requestGradient}>
              <MaterialIcons name={promotedToPublisher ? 'videocam' : 'person-add-alt-1'} size={18} color="#fff" />
              <Text style={styles.requestText}>
                {promotedToPublisher ? 'En vivo' : requestSent ? 'Enviada' : 'Solicitar subir'}
              </Text>
            </LinearGradient>
          </Pressable>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

const msg = StyleSheet.create({
  row:      { flexDirection: 'row', flexWrap: 'wrap' },
  name:     { color: Colors.primary, fontSize: 11, fontWeight: FontWeight.bold },
  hostName: { color: Colors.secondary },
  text:     { color: 'rgba(255,255,255,0.88)', fontSize: 12 },
});

const styles = StyleSheet.create({
  loadingScreen: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText:   { color: Colors.textSecondary, fontSize: FontSize.md },
  endedScreen:   { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  endedTitle:    { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  endedBtn:      { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  endedBtnText:  { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },

  container: { flex: 1, backgroundColor: '#050508' },
  videoStream:      { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  videoPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surface },
  waitingText: { color: Colors.textSecondary, fontSize: FontSize.sm },

  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 170, zIndex: 2 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 320, zIndex: 2 },
  header: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 68,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(20,20,25,0.65)',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(124,92,255,0.7)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: FontWeight.bold },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  hostInfo: { flex: 1 },
  hostName: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  hostTitle: { color: 'rgba(255,255,255,0.65)', fontSize: 11 },
  headerMetric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerMetricText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold, maxWidth: SCREEN_WIDTH < 380 ? 58 : 82 },
  headerDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.16)' },
  liveBadge: { minWidth: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#FF2D55', borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  liveDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  titleBlock: { position: 'absolute', left: 16, right: 90, zIndex: 9 },
  streamTitle: { color: '#fff', fontSize: 24, fontWeight: FontWeight.bold },
  conversationChip: { marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  conversationText: { color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },

  statsRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: 4 },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statText: { color: Colors.textSecondary, fontSize: 11 },

  errorBanner: { marginHorizontal: Spacing.md, backgroundColor: 'rgba(255,45,85,0.15)', borderRadius: Radius.sm, padding: Spacing.xs },
  errorText: { color: Colors.secondary, fontSize: 11, textAlign: 'center' },

  actionRail: { position: 'absolute', right: 12, top: SCREEN_HEIGHT * 0.28, gap: 15, zIndex: 9 },
  actionButton: { width: 60, minHeight: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 8 },
  actionButtonDisabled: { opacity: 0.6 },
  actionCount: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  coHostStrip: { position: 'absolute', right: 12, bottom: 202, width: 138, gap: 12, zIndex: 8 },
  coHostTile: { width: 138, height: 104, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1.5, borderColor: 'rgba(236,72,153,0.62)' },
  coHostVideo: { flex: 1 },
  coHostMic: { position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.48)', alignItems: 'center', justifyContent: 'center' },
  coHostName: { position: 'absolute', left: 8, bottom: 7, color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  bottomSection: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: 360,
    zIndex: 7,
  },
  chatList: {
    flex: 1,
    maxHeight: SCREEN_HEIGHT * 0.34,
    width: SCREEN_WIDTH * 0.56,
    marginLeft: 12,
    marginBottom: 116,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },

  giftBar: { position: 'absolute', left: 12, right: 12, bottom: 82, height: 98, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, backgroundColor: 'rgba(0,0,0,0.48)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  requestBtn: { width: SCREEN_WIDTH < 380 ? 128 : 148, height: 58, borderRadius: Radius.full, overflow: 'hidden' },
  requestGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10 },
  requestBtnDisabled: { opacity: 0.65 },
  requestText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold, textAlign: 'center' },
  giftBtn: { width: 52, height: 72, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  giftBtnDisabled: { opacity: 0.45 },
  giftEmoji: { fontSize: 21 },
  giftLabel: { color: '#fff', fontSize: 9, fontWeight: FontWeight.semibold },
  giftCost: { color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: FontWeight.bold },

  inputRow: { position: 'absolute', left: 12, right: 12, bottom: 10, height: 62, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, height: 58, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: Radius.full, paddingHorizontal: 18, color: '#fff', fontSize: FontSize.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
