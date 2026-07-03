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
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { useAgoraEngine } from '@/hooks/useAgoraEngine';
import { RtcSurfaceView, useridToAgoraUid, isAgoraAvailable } from '@/services/agoraService';

const POLL_INTERVAL_MS = 3000;
const MAX_MESSAGES     = 100;
const SPAM_THROTTLE_MS = 2500;

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
  { id: 'heart',   emoji: '❤️', label: 'Corazón',  cost: 10,  color: '#FF2D78' },
  { id: 'star',    emoji: '⭐', label: 'Estrella',  cost: 50,  color: '#FFB800' },
  { id: 'rocket',  emoji: '🚀', label: 'Cohete',    cost: 100, color: '#7C5CFF' },
  { id: 'diamond', emoji: '💎', label: 'Diamante',  cost: 500, color: '#00D4FF' },
];

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
  const [showGifts, setShowGifts] = useState(false);
  const [sendingGift, setSendingGift] = useState<string | null>(null);

  const {
    engineReady, remoteUids, error, join, leave,
  } = useAgoraEngine({ channelName: session?.status === 'live' ? streamId ?? null : null, uid: myUid, role: 'subscriber', profile: 'live-broadcasting' });

  const chatRef     = useRef<FlatList>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgRef  = useRef<string | null>(null);
  const lastSentRef = useRef(0);
  const mountedRef  = useRef(true);
  const leftRef     = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch session ─────────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    if (!streamId) return;
    try {
      const { data, error: err } = await supabase
        .from('live_sessions')
        .select(`id, host_id, title, status, viewer_count, user_profiles!live_sessions_host_id_fkey(username)`)
        .eq('id', streamId)
        .single();

      if (err || !data) { setEnded(true); setLoading(false); return; }

      setSession({
        id:           data.id,
        hostId:       data.host_id,
        hostUsername: (data as any).user_profiles?.username ?? 'Creator',
        title:        data.title ?? '',
        viewerCount:  data.viewer_count ?? 0,
        status:       data.status as 'live' | 'ended',
      });
      if (data.status === 'ended') setEnded(true);
      setLoading(false);
    } catch (_) { setLoading(false); }
  }, [streamId, supabase]);

  // ── Join Agora once session confirmed live ──────────────────────────────
  useEffect(() => {
    if (session?.status === 'live' && engineReady) join();
  }, [session?.status, engineReady]);

  // ── Viewer count +1 / -1 ─────────────────────────────────────────────────
  const bumpViewerCount = useCallback(async (delta: 1 | -1) => {
    if (!streamId) return;
    try {
      const { data } = await supabase.from('live_sessions').select('viewer_count').eq('id', streamId).single();
      if (data) {
        await supabase.from('live_sessions')
          .update({ viewer_count: Math.max(0, (data.viewer_count || 0) + delta) })
          .eq('id', streamId);
      }
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
        .limit(30);
      if (lastMsgRef.current) query = query.gt('created_at', lastMsgRef.current);

      const { data: mData } = await query;
      if (mData && mData.length > 0) {
        const newMsgs: ChatMessage[] = mData.map((m: any) => ({
          id: m.id, userId: m.user_id, username: m.username,
          message: m.message, createdAt: m.created_at,
        }));
        lastMsgRef.current = mData[mData.length - 1].created_at;
        setMessages(prev => [...prev, ...newMsgs].slice(-MAX_MESSAGES));
        setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
      }
    } catch (_) { /* ignore */ }
  }, [streamId, ended, supabase]);

  useEffect(() => {
    if (!streamId) { router.back(); return; }
    fetchSession();
    bumpViewerCount(1);
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (!leftRef.current) { leftRef.current = true; leave(); }
      bumpViewerCount(-1);
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
    setMessages(prev => [...prev.slice(-MAX_MESSAGES), optimistic]);
    setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      await supabase.from('live_messages').insert({
        session_id: streamId, user_id: user.id,
        username: user.username || user.email?.split('@')[0] || 'user',
        avatar_url: user.avatar ?? '', message: text,
      });
    } catch (_) { /* ignore */ }
    setSending(false);
  }, [chatInput, user, streamId, sending, supabase]);

  // ── Send gift ─────────────────────────────────────────────────────────────
  const sendGift = useCallback(async (gift: GiftOption) => {
    if (!user || !session || sendingGift) return;
    setSendingGift(gift.id);
    try {
      await supabase.from('gifts').insert({
        sender_id: user.id, recipient_id: session.hostId, session_id: streamId,
        gift_type: gift.id, dag_value: gift.cost / 100, message: `${gift.emoji} ${gift.label}`,
      });
      await supabase.from('live_messages').insert({
        session_id: streamId, user_id: user.id,
        username: user.username || 'user', avatar_url: user.avatar ?? '',
        message: `${gift.emoji} regalo ${gift.label} (${gift.cost} BDAG)`,
      });
    } catch (_) { /* ignore */ }
    setSendingGift(null);
    setShowGifts(false);
  }, [user, session, streamId, sendingGift, supabase]);

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

        {showGifts ? (
          <View style={styles.giftPanel}>
            <View style={styles.giftHeader}>
              <Text style={styles.giftTitle}>Enviar regalo</Text>
              <Pressable onPress={() => setShowGifts(false)} hitSlop={8}>
                <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.giftGrid}>
              {GIFTS.map(g => (
                <Pressable
                  key={g.id}
                  style={[styles.giftBtn, sendingGift === g.id && styles.giftBtnLoading]}
                  onPress={() => sendGift(g)}
                  disabled={!!sendingGift}
                >
                  <Text style={styles.giftEmoji}>{g.emoji}</Text>
                  <Text style={styles.giftLabel}>{g.label}</Text>
                  <Text style={[styles.giftCost, { color: g.color }]}>{g.cost} B</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}
        >
          <Pressable style={styles.iconBtn} onPress={() => setShowGifts(v => !v)} hitSlop={8}>
            <MaterialCommunityIcons name="gift-outline" size={22} color={Colors.accent} />
          </Pressable>
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

  bottomSection: { marginTop: 'auto', maxHeight: 280 },
  chatList: { flex: 1 },

  giftPanel: { backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, padding: Spacing.md, gap: Spacing.sm },
  giftHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  giftTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  giftGrid: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  giftBtn: { alignItems: 'center', gap: 3, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.border },
  giftBtnLoading: { opacity: 0.5 },
  giftEmoji: { fontSize: 22 },
  giftLabel: { color: Colors.textSecondary, fontSize: 10 },
  giftCost: { fontSize: 10, fontWeight: FontWeight.bold },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(10,10,20,0.95)' },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 9, color: '#fff', fontSize: FontSize.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
