/**
 * app/live/[sessionId].tsx — Live stream viewer screen
 *
 * For viewers joining an active live session:
 *   - Real-time viewer count updates (polling every 3s)
 *   - Live chat messages via live_messages table
 *   - Gift sending with SecurityManager rate limiting
 *   - Stream health display
 *   - SessionOrchestrator registration (stream_viewer)
 *   - CrashIntelligence breadcrumbs
 *   - useNavigationTelemetry for screen timing
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { SessionOrchestrator }   from '@/modules/sessions/SessionOrchestrator';
import { SecurityManager }       from '@/modules/core/SecurityManager';
import { CrashIntelligence }     from '@/modules/core/CrashIntelligence';
import { useNavigationTelemetry } from '@/hooks/navigation/useNavigationTelemetry';

interface LiveMessage {
  id:       string;
  userId:   string;
  username: string;
  avatar:   string;
  message:  string;
  createdAt: string;
}

export default function LiveViewerScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();
  const { markReady } = useNavigationTelemetry('LiveViewerScreen');

  const [host,         setHost]         = useState<{ username: string; avatar: string } | null>(null);
  const [viewerCount,  setViewerCount]  = useState(0);
  const [messages,     setMessages]     = useState<LiveMessage[]>([]);
  const [input,        setInput]        = useState('');
  const [sending,      setSending]      = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [streamEnded,  setStreamEnded]  = useState(false);

  const chatRef = useRef<FlatList<LiveMessage>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionOrcId = useRef(`stream_viewer_${sessionId}_${user?.id}`);

  // ── Mount ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId) return;
    CrashIntelligence.addBreadcrumb('navigation', 'LiveViewer mounted', { sessionId });

    // Register as viewer session
    SessionOrchestrator.registerSession('stream_viewer', sessionOrcId.current, {
      onPause:   async () => { /* pause polling */ },
      onResume:  async () => { loadMessages(); },
      onEnd:     async () => { /* cleanup */ },
      onRecover: async () => true,
    });

    // Load initial data
    loadSessionInfo();
    loadMessages();

    // Poll for viewer count + new messages every 3s
    pollRef.current = setInterval(() => {
      refreshViewerCount();
      loadNewMessages();
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      SessionOrchestrator.endSession(sessionOrcId.current);
      CrashIntelligence.addBreadcrumb('navigation', 'LiveViewer unmounted', { sessionId });
    };
  }, [sessionId, user?.id]);

  const loadSessionInfo = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('live_sessions')
        .select('host_id, viewer_count, status, user_profiles!live_sessions_host_id_fkey(username, avatar_url)')
        .eq('id', sessionId)
        .single();

      if (data) {
        const profile = data.user_profiles as any;
        setHost({ username: profile?.username || 'Host', avatar: profile?.avatar_url || '' });
        setViewerCount(data.viewer_count);
        if (data.status === 'ended') setStreamEnded(true);
      }
      setLoading(false);
      markReady();
    } catch (e: any) {
      setLoading(false);
      CrashIntelligence.addBreadcrumb('error', `LiveViewer load error: ${e?.message}`);
    }
  }, [sessionId, supabase, markReady]);

  const loadMessages = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('live_messages')
        .select('id, user_id, username, avatar_url, message, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(50);

      if (data) {
        setMessages(data.map(m => ({
          id:        m.id,
          userId:    m.user_id,
          username:  m.username,
          avatar:    m.avatar_url,
          message:   m.message,
          createdAt: m.created_at,
        })));
        setTimeout(() => chatRef.current?.scrollToEnd({ animated: false }), 100);
      }
    } catch { /* non-critical */ }
  }, [sessionId, supabase]);

  // Cursor-based incremental fetch
  const lastMsgId = useRef<string | null>(null);
  const loadNewMessages = useCallback(async () => {
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (latest.id === lastMsgId.current) return;
    lastMsgId.current = latest.id;

    try {
      const { data } = await supabase
        .from('live_messages')
        .select('id, user_id, username, avatar_url, message, created_at')
        .eq('session_id', sessionId)
        .gt('created_at', latest.createdAt)
        .order('created_at', { ascending: true })
        .limit(20);

      if (data && data.length > 0) {
        const newMsgs: LiveMessage[] = data.map(m => ({
          id:        m.id,
          userId:    m.user_id,
          username:  m.username,
          avatar:    m.avatar_url,
          message:   m.message,
          createdAt: m.created_at,
        }));
        setMessages(prev => [...prev, ...newMsgs]);
        setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 100);
      }
    } catch { /* non-critical */ }
  }, [messages, sessionId, supabase]);

  const refreshViewerCount = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('live_sessions')
        .select('viewer_count, status')
        .eq('id', sessionId)
        .single();

      if (data) {
        setViewerCount(data.viewer_count);
        if (data.status === 'ended') setStreamEnded(true);
      }
    } catch { /* non-critical */ }
  }, [sessionId, supabase]);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !user || sending) return;

    const allowed = SecurityManager.checkAction('message_send', user.id);
    if (!allowed) {
      CrashIntelligence.addBreadcrumb('user_action', 'Live message blocked by SecurityManager');
      return;
    }

    setSending(true);
    const optimistic: LiveMessage = {
      id:        `local_${Date.now()}`,
      userId:    user.id,
      username:  user.username || 'Tú',
      avatar:    user.avatar || '',
      message:   text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      await supabase.from('live_messages').insert({
        session_id: sessionId,
        user_id:    user.id,
        username:   user.username || 'user',
        avatar_url: user.avatar || '',
        message:    text,
      });
    } catch (e: any) {
      CrashIntelligence.addBreadcrumb('error', `Live message send failed: ${e?.message}`);
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }, [input, user, sending, sessionId, supabase]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (streamEnded) {
    return (
      <View style={styles.endedContainer}>
        <MaterialIcons name="videocam-off" size={56} color={Colors.textSubtle} />
        <Text style={styles.endedTitle}>Stream finalizado</Text>
        <Text style={styles.endedSub}>Este stream ya terminó</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Stream video placeholder */}
      <View style={styles.videoArea}>
        <LinearGradient
          colors={['#0A0A14', '#1A1A2E', '#0A0A14']}
          style={StyleSheet.absoluteFillObject}
        />
        <MaterialIcons name="live-tv" size={64} color={Colors.primary + '44'} />
        <Text style={styles.liveLabel}>EN VIVO</Text>
      </View>

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <View style={styles.hostInfo}>
          <View style={styles.hostAvatar}>
            <Text style={styles.hostInitial}>
              {(host?.username ?? 'H').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.hostName}>@{host?.username}</Text>
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        </View>
        <View style={styles.topRight}>
          <View style={styles.viewerPill}>
            <MaterialIcons name="remove-red-eye" size={12} color={Colors.textSecondary} />
            <Text style={styles.viewerText}>{viewerCount}</Text>
          </View>
          <Pressable style={styles.closeBtn} onPress={() => router.back()} hitSlop={8}>
            <MaterialIcons name="close" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Chat overlay */}
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={chatRef}
          data={messages}
          keyExtractor={item => item.id}
          style={styles.messageList}
          contentContainerStyle={styles.messageContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.messageRow}>
              <Text style={styles.msgUsername}>@{item.username}</Text>
              <Text style={styles.msgText}>{item.message}</Text>
            </View>
          )}
        />

        {/* Input row */}
        <View style={[styles.inputRow, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={styles.input}
            placeholder="Escribe un mensaje..."
            placeholderTextColor={Colors.textSubtle}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
            maxLength={200}
          />
          <Pressable
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!input.trim() || sending}
            hitSlop={8}
          >
            <MaterialIcons
              name="send"
              size={20}
              color={input.trim() && !sending ? Colors.primary : Colors.textSubtle}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },
  loadingContainer: {
    flex: 1, backgroundColor: '#0A0A14',
    alignItems: 'center', justifyContent: 'center',
  },
  endedContainer: {
    flex: 1, backgroundColor: '#0A0A14',
    alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  endedTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  endedSub:   { color: Colors.textSecondary, fontSize: FontSize.md },
  backBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: 24, paddingVertical: 12, marginTop: Spacing.md,
  },
  backBtnText: { color: '#fff', fontWeight: FontWeight.semibold },

  videoArea: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  liveLabel: {
    color: Colors.primary, fontSize: FontSize.xs,
    fontWeight: FontWeight.bold, letterSpacing: 2,
    marginTop: Spacing.sm,
  },

  topBar: {
    position: 'absolute', left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.md,
  },
  hostInfo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  hostAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.primary,
  },
  hostInitial: { color: Colors.primary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  hostName:    { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  liveBadge:   {
    backgroundColor: '#FF2D78', borderRadius: Radius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  liveBadgeText: { color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },
  topRight:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  viewerPill:  {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  viewerText:  { color: '#fff', fontSize: FontSize.xs },
  closeBtn:    {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },

  chatArea: {
    position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '55%',
  },
  messageList:    { flex: 1 },
  messageContent: { paddingHorizontal: Spacing.md, paddingBottom: 4 },
  messageRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: Radius.sm,
    paddingHorizontal: 8, paddingVertical: 4, marginVertical: 2,
    alignSelf: 'flex-start', maxWidth: '85%',
  },
  msgUsername: {
    color: Colors.primary, fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold, marginRight: 4,
  },
  msgText: { color: '#fff', fontSize: FontSize.xs, flex: 1 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm,
    gap: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  input: {
    flex: 1, height: 38,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: Radius.full, paddingHorizontal: 14,
    color: '#fff', fontSize: FontSize.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
