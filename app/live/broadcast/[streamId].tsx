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
  View, Text, Pressable, StyleSheet, FlatList, TextInput, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
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

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  createdAt: string;
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

  const {
    engineReady, joined, error,
    isMuted, isCameraOff, localVideoReady, join, leave, toggleMute, toggleCamera, switchCamera,
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
        .limit(30);
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

  // ── Pre-live: title prompt ───────────────────────────────────────────────
  if (!live) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {RtcSurfaceView && localVideoReady && !isCameraOff ? (
        <RtcSurfaceView canvas={{ uid: 0 }} style={styles.videoStream} />
      ) : (
        <View style={styles.videoPlaceholder}>
          <MaterialIcons name="videocam-off" size={40} color={Colors.textSubtle} />
        </View>
      )}

      {/* ── Header overlay ────────────────────────────────────────────────── */}
      <View style={[styles.header, { top: insets.top + Spacing.sm }]}>
        <Pressable onPress={endBroadcast} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="close" size={20} color="#fff" />
        </Pressable>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>EN VIVO</Text>
        </View>
        <View style={styles.viewerChip}>
          <MaterialIcons name="visibility" size={13} color="#fff" />
          <Text style={styles.viewerChipText}>{viewerCount.toLocaleString()}</Text>
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
          renderItem={({ item }) => (
            <View style={msgStyles.row}>
              <Text style={msgStyles.name}>{item.username}</Text>
              <Text style={msgStyles.text}> {item.message}</Text>
            </View>
          )}
          contentContainerStyle={{ gap: 4, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <Pressable style={[styles.controlBtn, isMuted && styles.controlBtnActive]} onPress={toggleMute} hitSlop={8}>
          <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={20} color={isMuted ? '#000' : '#fff'} />
        </Pressable>
        <Pressable style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]} onPress={toggleCamera} hitSlop={8}>
          <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={20} color={isCameraOff ? '#000' : '#fff'} />
        </Pressable>
        <Pressable style={styles.controlBtn} onPress={switchCamera} hitSlop={8}>
          <MaterialIcons name="flip-camera-ios" size={20} color="#fff" />
        </Pressable>
        <Pressable style={styles.endBtn} onPress={endBroadcast} hitSlop={4}>
          <Text style={styles.endBtnText}>Finalizar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const msgStyles = StyleSheet.create({
  row:  { flexDirection: 'row', flexWrap: 'wrap' },
  name: { color: Colors.primary, fontSize: 12, fontWeight: FontWeight.bold },
  text: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
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

  header: {
    position: 'absolute', left: Spacing.md, right: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, zIndex: 10,
  },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.error, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4,
  },
  liveDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  viewerChip: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4,
  },
  viewerChipText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold },

  errorBanner: { position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 10, backgroundColor: 'rgba(255,45,85,0.15)', borderRadius: Radius.sm, padding: Spacing.xs },
  errorText: { color: Colors.secondary, fontSize: 11, textAlign: 'center' },

  chatArea: { position: 'absolute', left: Spacing.md, right: 90, bottom: 100, maxHeight: 180 },

  controls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  controlBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  controlBtnActive: { backgroundColor: Colors.textPrimary },
  endBtn: { backgroundColor: Colors.secondary, borderRadius: Radius.full, paddingHorizontal: 20, paddingVertical: 12 },
  endBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
});
