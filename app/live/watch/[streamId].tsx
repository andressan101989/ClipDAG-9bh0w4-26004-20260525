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
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

interface GiftOption { id: string; emoji: string; label: string; cost: number; color: string; }

const GIFTS: GiftOption[] = [
  { id: 'heart',   emoji: '\u2764\uFE0F', label: 'Corazon',  cost: 10,   color: '#FF2D78' },
  { id: 'star',    emoji: '\u2B50',       label: 'Estrella', cost: 50,   color: '#FFB800' },
  { id: 'diamond', emoji: '\uD83D\uDC8E', label: 'Diamante', cost: 1000, color: '#00D4FF' },
  { id: 'crown',   emoji: '\uD83D\uDC51', label: 'Corona',   cost: 500,  color: '#FFD166' },
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

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Cargando live...</Text>
      </View>
    );
  }

  if (ended || !session) {
    return (
      <View style={styles.endedScreen}>
        <StatusBar style="light" />
        <MaterialIcons name="live-tv" size={52} color={Colors.secondary} />
        <Text style={styles.endedTitle}>Este live ha terminado</Text>
        <Pressable onPress={() => router.back()} style={styles.endedBtn}>
          <Text style={styles.endedBtnText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const remoteUid = remoteUids[0];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
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
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <View style={styles.hostInfo}>
          <Text style={styles.hostName}>@{session.hostUsername}</Text>
          <Text style={styles.hostTitle} numberOfLines={1}>{session.title}</Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>EN VIVO</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statChip}>
          <MaterialIcons name="visibility" size={13} color={Colors.textSecondary} />
          <Text style={styles.statText}>{session.viewerCount.toLocaleString()}</Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>
      ) : null}

      {/* ── Chat + controls ──────────────────────────────────────────────── */}
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
          <Pressable
            style={[
              styles.requestBtn,
              (requestSent || promotedToPublisher || !user) && styles.requestBtnDisabled,
            ]}
            onPress={requestToJoin}
            disabled={requestSent || promotedToPublisher || !user}
          >
            <MaterialIcons
              name={promotedToPublisher ? 'videocam' : 'pan-tool'}
              size={18}
              color={promotedToPublisher ? '#fff' : Colors.primary}
            />
            <Text style={styles.requestText}>
              {promotedToPublisher ? 'En vivo' : requestSent ? 'Solicitud enviada' : 'Solicitar subir'}
            </Text>
          </Pressable>
          {GIFTS.map(g => (
            <Pressable
              key={g.id}
              style={[styles.giftBtn, styles.giftBtnDisabled]}
              disabled
            >
              <Text style={styles.giftEmoji}>{g.emoji}</Text>
              <Text style={styles.giftLabel}>{g.label}</Text>
              <Text style={styles.giftComingSoon}>Próximamente</Text>
            </Pressable>
          ))}
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}
        >
          <TextInput
            style={styles.input}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder={user ? 'Escribe un mensaje...' : 'Inicia sesión para chatear'}
            placeholderTextColor="rgba(255,255,255,0.35)"
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
        </KeyboardAvoidingView>
      </View>
    </View>
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

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  hostInfo: { flex: 1 },
  hostName: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  hostTitle: { color: Colors.textSubtle, fontSize: FontSize.xs },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.error, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  liveDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },

  statsRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: 4 },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statText: { color: Colors.textSecondary, fontSize: 11 },

  errorBanner: { marginHorizontal: Spacing.md, backgroundColor: 'rgba(255,45,85,0.15)', borderRadius: Radius.sm, padding: Spacing.xs },
  errorText: { color: Colors.secondary, fontSize: 11, textAlign: 'center' },

  bottomSection: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: 320,
  },
  chatList: { flex: 1 },

  giftBar: { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 8, backgroundColor: 'rgba(10,10,20,0.92)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  requestBtn: { flex: 1.2, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: Radius.md, paddingVertical: 8, paddingHorizontal: 6, borderWidth: 1, borderColor: Colors.primary },
  requestBtnDisabled: { opacity: 0.55 },
  requestText: { color: Colors.textPrimary, fontSize: 10, fontWeight: FontWeight.semibold, textAlign: 'center' },
  giftBtn: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, paddingVertical: 8, paddingHorizontal: 4, borderWidth: 1, borderColor: Colors.border },
  giftBtnDisabled: { opacity: 0.45 },
  giftEmoji: { fontSize: 22 },
  giftLabel: { color: Colors.textSecondary, fontSize: 10 },
  giftComingSoon: { color: Colors.textSubtle, fontSize: 9, fontWeight: FontWeight.bold },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(10,10,20,0.95)' },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 9, color: '#fff', fontSize: FontSize.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
