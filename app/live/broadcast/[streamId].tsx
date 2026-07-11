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
  Keyboard, Platform,
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
const SPAM_THROTTLE_MS = 2500;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  createdAt: string;
}

function mergeMessages(prev: ChatMessage[], next: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  [...prev, ...next].forEach(message => byId.set(message.id, message));
  return Array.from(byId.values())
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-MAX_MESSAGES);
}

type LiveParticipant = {
  id: string;
  session_id: string;
  user_id: string;
  agora_uid: number | null;
  username: string | null;
  role: 'audience' | 'requested' | 'cohost' | 'removed';
  status: 'active' | 'inactive' | 'removed';
  mic_muted: boolean;
  mic_locked: boolean;
  camera_enabled: boolean;
  floor_granted: boolean;
  floor_started_at: string | null;
  floor_duration_seconds: number | null;
  created_at: string;
  updated_at: string;
};

type LiveControlEventType =
  | 'request_join'
  | 'approve_join'
  | 'mute'
  | 'unmute'
  | 'lock_mic'
  | 'unlock_mic'
  | 'grant_floor'
  | 'revoke_floor'
  | 'remove_cohost'
  | 'timer_start'
  | 'timer_stop';

function getCohostTimerText(participant: LiveParticipant) {
  if (!participant.floor_started_at) return null;
  if (participant.floor_duration_seconds === null || participant.floor_duration_seconds === undefined) return null;
  const startedAt = new Date(participant.floor_started_at).getTime();
  if (Number.isNaN(startedAt)) return null;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const remaining = Math.max(0, participant.floor_duration_seconds - elapsed);
  return `${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, '0')}`;
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
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [cohostTimerTick, setCohostTimerTick] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [composerHeight, setComposerHeight] = useState(72);

  const {
    engineReady, joined, error,
    remoteUids, isMuted, isCameraOff, localVideoReady, join, leave, toggleMute, toggleCamera, switchCamera,
  } = useAgoraEngine({ channelName: live ? streamId ?? null : null, uid: myUid, role: 'publisher', profile: 'live-broadcasting' });

  const chatRef    = useRef<FlatList>(null);
  const inputRef   = useRef<TextInput | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgRef = useRef<string | null>(null);
  const lastSentRef = useRef(0);
  const sendingRef = useRef(false);
  const endedRef   = useRef(false);
  const mountedRef = useRef(true);
  const expiredTimerMutedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      chatRef.current?.scrollToEnd({ animated });
    });

    setTimeout(() => {
      chatRef.current?.scrollToEnd({ animated });
    }, 80);
  }, []);

  const dismissKeyboard = useCallback(() => {
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, event => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    scrollToLatest(true);
  }, [messages.length, keyboardHeight, composerHeight, scrollToLatest]);

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

  useEffect(() => {
    if (!live || !participants.some(p => p.status === 'active' && p.floor_started_at && p.floor_duration_seconds !== null && p.floor_duration_seconds !== undefined)) return;
    const timer = setInterval(() => setCohostTimerTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [live, participants]);

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
        setMessages(prev => mergeMessages(prev, newMsgs));
        scrollToLatest(true);
      }
    } catch (_) { /* ignore */ }
  }, [streamId, supabase, scrollToLatest]);

  useEffect(() => {
    if (!live) return;
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    poll();
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [live, poll]);

  const loadParticipants = useCallback(async () => {
    if (!streamId || !live) return;
    try {
      const { data, error: participantsError } = await supabase
        .from('live_participants')
        .select('*')
        .eq('session_id', streamId)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (participantsError) {
        console.warn('[LiveBroadcast] load participants failed', participantsError.message);
        return;
      }

      if (mountedRef.current) setParticipants((data ?? []) as LiveParticipant[]);
    } catch (err: any) {
      console.warn('[LiveBroadcast] participants sync failed', err?.message ?? err);
    }
  }, [streamId, live, supabase]);

  useEffect(() => {
    if (!live || !streamId) return;
    loadParticipants();

    const channel = supabase
      .channel(`live-participants:${streamId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_participants', filter: `session_id=eq.${streamId}` },
        () => loadParticipants(),
      )
      .subscribe();

    const fallback = setInterval(loadParticipants, POLL_INTERVAL_MS);
    return () => {
      clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [live, streamId, supabase, loadParticipants]);

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

  const acceptJoinRequest = useCallback(async (participant: LiveParticipant) => {
    if (!user?.id || !streamId) return;
    const username = participant.username || 'Invitado';
    const floorStartedAt = new Date().toISOString();
    try {
      const { error: updateError } = await supabase
        .from('live_participants')
        .update({
          role: 'cohost',
          status: 'active',
          mic_muted: false,
          mic_locked: false,
          camera_enabled: true,
          floor_granted: true,
          floor_started_at: floorStartedAt,
          floor_duration_seconds: null,
        })
        .eq('id', participant.id);
      if (updateError) throw updateError;

      const { error: eventError } = await supabase.from('live_control_events').insert({
        session_id: streamId,
        target_user_id: participant.user_id,
        actor_user_id: user.id,
        event_type: 'approve_join',
        payload: { username },
      });
      if (eventError) console.warn('[LiveBroadcast] approve event failed', eventError.message);
      setParticipants(prev => prev.map(item => item.id === participant.id ? {
        ...item,
        role: 'cohost',
        status: 'active',
        mic_muted: false,
        mic_locked: false,
        camera_enabled: true,
        floor_granted: true,
        floor_started_at: floorStartedAt,
        floor_duration_seconds: null,
      } : item));
      loadParticipants();
    } catch (err: any) {
      console.warn('[LiveBroadcast] accept join failed', err?.message ?? err);
    }
  }, [user?.id, streamId, supabase, loadParticipants]);

  const rejectJoinRequest = useCallback(async (participant: LiveParticipant) => {
    if (!user?.id || !streamId) return;
    const username = participant.username || 'Invitado';
    try {
      const { error: updateError } = await supabase
        .from('live_participants')
        .update({
          role: 'removed',
          status: 'removed',
        })
        .eq('id', participant.id);
      if (updateError) throw updateError;

      const { error: eventError } = await supabase.from('live_control_events').insert({
        session_id: streamId,
        target_user_id: participant.user_id,
        actor_user_id: user.id,
        event_type: 'reject_join',
        payload: { username },
      });
      if (eventError) console.warn('[LiveBroadcast] reject event failed', eventError.message);
      loadParticipants();
    } catch (err: any) {
      console.warn('[LiveBroadcast] reject join failed', err?.message ?? err);
    }
  }, [user?.id, streamId, supabase, loadParticipants]);

  const insertLiveControlEvent = useCallback(async (
    eventType: LiveControlEventType,
    participant: LiveParticipant,
    payload: Record<string, unknown> = {},
  ) => {
    if (!user?.id || !streamId) return;
    const username = participant.username || 'Invitado';
    const { error: eventError } = await supabase.from('live_control_events').insert({
      session_id: streamId,
      target_user_id: participant.user_id,
      actor_user_id: user.id,
      event_type: eventType,
      payload: { username, ...payload },
    });
    if (eventError) console.warn(`[LiveBroadcast] ${eventType} event failed`, eventError.message);
  }, [user?.id, streamId, supabase]);

  const updateCohostControls = useCallback(async (
    participant: LiveParticipant,
    patch: Partial<Pick<LiveParticipant, 'mic_muted' | 'mic_locked' | 'camera_enabled' | 'floor_granted' | 'floor_started_at' | 'floor_duration_seconds' | 'role' | 'status'>>,
    eventType: LiveControlEventType,
    payload?: Record<string, unknown>,
  ) => {
    try {
      const { error: updateError } = await supabase
        .from('live_participants')
        .update(patch)
        .eq('id', participant.id);
      if (updateError) throw updateError;
      setParticipants(prev => prev
        .map(item => item.id === participant.id ? { ...item, ...patch } : item)
        .filter(item => item.status === 'active'));
      await insertLiveControlEvent(eventType, participant, payload);
      loadParticipants();
    } catch (err: any) {
      console.warn(`[LiveBroadcast] ${eventType} failed`, err?.message ?? err);
    }
  }, [supabase, insertLiveControlEvent, loadParticipants]);

  const toggleCohostMute = useCallback((participant: LiveParticipant) => {
    const nextMuted = !participant.mic_muted;
    updateCohostControls(
      participant,
      { mic_muted: nextMuted },
      nextMuted ? 'mute' : 'unmute',
    );
  }, [updateCohostControls]);

  const toggleCohostMicLock = useCallback((participant: LiveParticipant) => {
    const nextLocked = !participant.mic_locked;
    updateCohostControls(
      participant,
      nextLocked ? { mic_locked: true, mic_muted: true } : { mic_locked: false },
      nextLocked ? 'lock_mic' : 'unlock_mic',
    );
  }, [updateCohostControls]);

  const toggleCohostFloor = useCallback((participant: LiveParticipant) => {
    const nextGranted = !participant.floor_granted;
    updateCohostControls(
      participant,
      nextGranted
        ? { floor_granted: true, floor_started_at: new Date().toISOString(), floor_duration_seconds: null }
        : { floor_granted: false, floor_started_at: null, floor_duration_seconds: null },
      nextGranted ? 'grant_floor' : 'revoke_floor',
    );
  }, [updateCohostControls]);

  const setCohostTimer = useCallback((participant: LiveParticipant, seconds: number | null) => {
    updateCohostControls(
      participant,
      seconds === null
        ? { floor_granted: true, floor_started_at: new Date().toISOString(), floor_duration_seconds: null }
        : { floor_granted: true, floor_started_at: new Date().toISOString(), floor_duration_seconds: seconds },
      seconds === null ? 'timer_stop' : 'timer_start',
      seconds === null ? undefined : { seconds },
    );
  }, [updateCohostControls]);

  const removeCohost = useCallback((participant: LiveParticipant) => {
    updateCohostControls(
      participant,
      {
        role: 'removed',
        status: 'removed',
        mic_muted: true,
        mic_locked: true,
        camera_enabled: false,
        floor_granted: false,
        floor_started_at: null,
        floor_duration_seconds: null,
      },
      'remove_cohost',
    );
  }, [updateCohostControls]);

  const sendHostInviteToAudience = useCallback((participant: LiveParticipant) => {
    insertLiveControlEvent('request_join', participant, { invited_by_host: true });
  }, [insertLiveControlEvent]);

  useEffect(() => {
    if (!live) return;

    const enforceExpiredTimers = () => {
      participants
        .filter(participant =>
          participant.role === 'cohost' &&
          participant.status === 'active' &&
          participant.floor_started_at &&
          participant.floor_duration_seconds !== null &&
          participant.floor_duration_seconds !== undefined
        )
        .forEach(participant => {
          const startedAt = new Date(participant.floor_started_at as string).getTime();
          if (Number.isNaN(startedAt)) return;
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          const remaining = participant.floor_duration_seconds! - elapsed;
          const timerKey = `${participant.id}:${participant.floor_started_at}`;
          if (remaining > 0 || participant.mic_muted || expiredTimerMutedRef.current.has(timerKey)) return;

          expiredTimerMutedRef.current.add(timerKey);
          updateCohostControls(
            participant,
            { mic_muted: true, floor_granted: false },
            'mute',
            { reason: 'timer_expired', seconds: participant.floor_duration_seconds },
          );
        });
    };

    enforceExpiredTimers();
    const timer = setInterval(enforceExpiredTimers, 1000);
    return () => clearInterval(timer);
  }, [live, participants, updateCohostControls]);

  const sendMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !user || !streamId || sending || sendingRef.current) return;
    const now = Date.now();
    if (now - lastSentRef.current < SPAM_THROTTLE_MS) return;
    lastSentRef.current = now;
    sendingRef.current = true;
    setSending(true);
    setChatInput('');

    const username = user.username || user.email?.split('@')[0] || 'host';

    try {
      const { data, error: insertError } = await supabase.from('live_messages').insert({
        session_id: streamId,
        user_id: user.id,
        username,
        message: text,
      }).select('id, user_id, username, message, created_at').single();

      if (insertError) throw insertError;
      if (data) {
        setMessages(prev => mergeMessages(prev, [{
          id: data.id,
          userId: data.user_id,
          username: data.username,
          message: data.message,
          createdAt: data.created_at,
        }]));
        scrollToLatest(true);
      }
      dismissKeyboard();
    } catch (err: any) {
      console.warn('[LiveBroadcast] send message failed', err?.message ?? err);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [chatInput, user, streamId, sending, supabase, scrollToLatest, dismissKeyboard]);

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

  const pendingRequests = participants.filter(p => p.role === 'requested' && p.status === 'active');
  const structuredCohosts = participants.filter(p => p.role === 'cohost' && p.status === 'active');
  const activeAudiences = participants.filter(p =>
    p.role === 'audience' &&
    p.status === 'active' &&
    p.user_id !== user?.id
  );
  const pendingPanelHeight = pendingRequests.length > 0 ? Math.min(pendingRequests.length, 3) * 51 : 0;
  const cohostPanelHeight = structuredCohosts.length > 0 ? Math.min(structuredCohosts.length, 2) * 48 : 0;
  const composerBottom = keyboardHeight > 0 ? keyboardHeight : insets.bottom;
  const composerClearance = composerBottom + composerHeight + 16;
  const controlsBottom = composerBottom + composerHeight + 14;

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

      <Pressable
        style={styles.keyboardDismissLayer}
        onPress={dismissKeyboard}
        accessibilityLabel="Cerrar teclado"
      />

      <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent']} style={styles.topShade} pointerEvents="none" />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.6)']} style={styles.bottomShade} pointerEvents="none" />

      {RtcSurfaceView && remoteUids.length > 0 ? (
        <View style={[styles.remoteStrip, { bottom: composerClearance + 150 }]}>
          {remoteUids.map(uid => (
            <View key={uid} style={styles.remoteTile}>
              <RtcSurfaceView canvas={{ uid }} style={styles.remoteVideo} />
              <View style={styles.remoteBadge}>
                <MaterialIcons name="person" size={13} color="#fff" />
              </View>
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

      {pendingRequests.length > 0 ? (
        <View style={[styles.requestPanel, { top: insets.top + 154 }]}>
          {pendingRequests.slice(0, 3).map(participant => (
            <View key={participant.id} style={styles.requestRow}>
              <Text style={styles.requestName} numberOfLines={1}>
                @{participant.username || 'Invitado'}
              </Text>
              <View style={styles.requestActions}>
                <Pressable
                  style={[styles.requestActionBtn, styles.requestAcceptBtn]}
                  onPress={() => acceptJoinRequest(participant)}
                  hitSlop={6}
                  accessibilityLabel={`Aceptar solicitud de ${participant.username || 'Invitado'}`}
                >
                  <MaterialIcons name="check" size={16} color="#fff" />
                </Pressable>
                <Pressable
                  style={[styles.requestActionBtn, styles.requestRejectBtn]}
                  onPress={() => rejectJoinRequest(participant)}
                  hitSlop={6}
                  accessibilityLabel={`Rechazar solicitud de ${participant.username || 'Invitado'}`}
                >
                  <MaterialIcons name="close" size={16} color="#fff" />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {structuredCohosts.length > 0 ? (
        <View style={[styles.cohostPanel, { top: insets.top + 154 + pendingPanelHeight }]}>
          {structuredCohosts.slice(0, 2).map(participant => {
            const timerText = cohostTimerTick >= 0 ? getCohostTimerText(participant) : null;
            return (
            <View key={participant.id} style={styles.cohostControlRow}>
              <Text style={styles.cohostText} numberOfLines={1}>@{participant.username || 'Invitado'}</Text>
              <View style={styles.cohostControlActions}>
                <Pressable
                  style={[styles.cohostIconBtn, participant.mic_muted && styles.cohostIconBtnActive]}
                  onPress={() => toggleCohostMute(participant)}
                  hitSlop={6}
                  accessibilityLabel={participant.mic_muted ? 'Activar micrófono del cohost' : 'Silenciar cohost'}
                >
                  <MaterialIcons name={participant.mic_muted ? 'mic-off' : 'mic'} size={15} color="#fff" />
                </Pressable>
                <Pressable
                  style={[styles.cohostIconBtn, participant.mic_locked && styles.cohostIconBtnActive]}
                  onPress={() => toggleCohostMicLock(participant)}
                  hitSlop={6}
                  accessibilityLabel={participant.mic_locked ? 'Desbloquear micrófono del cohost' : 'Bloquear micrófono del cohost'}
                >
                  <MaterialIcons name={participant.mic_locked ? 'lock' : 'lock-open'} size={15} color="#fff" />
                </Pressable>
                <Pressable
                  style={[styles.cohostIconBtn, participant.floor_granted && styles.cohostIconBtnActive]}
                  onPress={() => toggleCohostFloor(participant)}
                  hitSlop={6}
                  accessibilityLabel={participant.floor_granted ? 'Quitar derecho de palabra' : 'Dar derecho de palabra'}
                >
                  <MaterialIcons name={participant.floor_granted ? 'record-voice-over' : 'voice-over-off'} size={15} color="#fff" />
                </Pressable>
                <Pressable style={styles.timerBtn} onPress={() => setCohostTimer(participant, 60)} hitSlop={6} accessibilityLabel="Timer de un minuto">
                  <Text style={styles.timerBtnText}>1m</Text>
                </Pressable>
                <Pressable style={styles.timerBtn} onPress={() => setCohostTimer(participant, 120)} hitSlop={6} accessibilityLabel="Timer de dos minutos">
                  <Text style={styles.timerBtnText}>2m</Text>
                </Pressable>
                <Pressable style={styles.timerBtn} onPress={() => setCohostTimer(participant, null)} hitSlop={6} accessibilityLabel="Timer libre">
                  <Text style={styles.timerBtnText}>∞</Text>
                </Pressable>
                <Pressable
                  style={[styles.cohostIconBtn, styles.cohostRemoveBtn]}
                  onPress={() => removeCohost(participant)}
                  hitSlop={6}
                  accessibilityLabel="Bajar cohost del live"
                >
                  <MaterialIcons name="person-remove" size={15} color="#fff" />
                </Pressable>
              </View>
              {timerText ? <Text style={styles.cohostTimerText}>{timerText}</Text> : null}
            </View>
          );})}
        </View>
      ) : null}

      {/* ── Chat overlay ──────────────────────────────────────────────────── */}
      {activeAudiences.length > 0 ? (
        <View style={[styles.audiencePanel, { top: insets.top + 154 + pendingPanelHeight + cohostPanelHeight }]}>
          {activeAudiences.slice(0, 3).map(participant => (
            <View key={participant.id} style={styles.audienceRow}>
              <MaterialIcons name="people" size={13} color="rgba(255,255,255,0.78)" />
              <Text style={styles.audienceName} numberOfLines={1}>@{participant.username || 'Invitado'}</Text>
              <Pressable
                style={styles.audienceInviteBtn}
                onPress={() => sendHostInviteToAudience(participant)}
                hitSlop={6}
                accessibilityLabel={`Subir a ${participant.username || 'Invitado'} al live`}
              >
                <MaterialIcons name="person-add-alt-1" size={15} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.chatArea, { bottom: composerClearance + 150, maxHeight: Math.max(120, SCREEN_HEIGHT - composerClearance - 290) }]}>
        <FlatList
          ref={chatRef}
          data={messages}
          keyExtractor={m => m.id}
          onContentSizeChange={() => scrollToLatest(false)}
          onLayout={() => scrollToLatest(false)}
          renderItem={({ item }) => (
            <View style={msgStyles.row}>
              <Text style={msgStyles.name}>{item.username}</Text>
              <Text style={msgStyles.text}> {item.message}</Text>
            </View>
          )}
          contentContainerStyle={{ gap: 4, paddingBottom: 8 }}
          ListFooterComponent={<View style={{ height: 8 }} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <View style={[styles.controls, { bottom: controlsBottom }]}>
        <View style={styles.controlGroup}>
          <Pressable
            style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
            onPress={toggleMute}
            hitSlop={8}
            accessibilityLabel={isMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
          >
            <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={20} color={isMuted ? '#000' : '#fff'} />
          </Pressable>
        </View>
        <View style={styles.controlGroup}>
          <Pressable
            style={styles.controlBtn}
            onPress={switchCamera}
            hitSlop={8}
            accessibilityLabel="Cambiar cámara"
          >
            <MaterialIcons name="flip-camera-ios" size={20} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.controlGroup}>
          <Pressable
            style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]}
            onPress={toggleCamera}
            hitSlop={8}
            accessibilityLabel={isCameraOff ? 'Activar cámara' : 'Apagar cámara'}
          >
            <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={20} color={isCameraOff ? '#000' : '#fff'} />
          </Pressable>
        </View>
        <Pressable
          style={styles.endBtn}
          onPress={endBroadcast}
          hitSlop={4}
          accessibilityLabel="Finalizar live"
        >
          <MaterialIcons name="call-end" size={22} color="#fff" />
        </Pressable>
      </View>

      <View
        style={[styles.inputRow, { bottom: composerBottom + 8 }]}
        onLayout={event => {
          const nextHeight = event.nativeEvent.layout.height;
          setComposerHeight(current =>
            Math.abs(current - nextHeight) < 1 ? current : nextHeight
          );
        }}
      >
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={chatInput}
          onChangeText={setChatInput}
          placeholder="Mensaje..."
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
          accessibilityLabel="Enviar mensaje"
        >
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="send" size={18} color="#fff" />}
        </Pressable>
      </View>
    </SafeAreaView>
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
  keyboardDismissLayer: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 170, zIndex: 2 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 320, zIndex: 2 },
  remoteStrip: { position: 'absolute', right: 12, width: 140, gap: 12, zIndex: 8 },
  remoteTile: { width: 140, height: 108, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1.5, borderColor: 'rgba(236,72,153,0.62)' },
  remoteVideo: { flex: 1 },
  remoteBadge: { position: 'absolute', left: 8, bottom: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.48)', alignItems: 'center', justifyContent: 'center' },

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

  requestPanel: {
    position: 'absolute',
    left: 16,
    right: 88,
    gap: 7,
    zIndex: 11,
  },
  requestRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 6,
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  requestName: { flex: 1, color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  requestActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  requestActionBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  requestAcceptBtn: { backgroundColor: Colors.primary },
  requestRejectBtn: { backgroundColor: 'rgba(255,255,255,0.16)' },
  cohostPanel: {
    position: 'absolute',
    left: 16,
    right: 12,
    gap: 6,
    zIndex: 10,
  },
  cohostControlRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderRadius: 21,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  cohostText: { width: SCREEN_WIDTH < 380 ? 54 : 78, color: 'rgba(255,255,255,0.88)', fontSize: 11, fontWeight: FontWeight.semibold },
  cohostControlActions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: SCREEN_WIDTH < 380 ? 3 : 5 },
  cohostIconBtn: { width: SCREEN_WIDTH < 380 ? 27 : 30, height: SCREEN_WIDTH < 380 ? 27 : 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  cohostIconBtnActive: { backgroundColor: 'rgba(124,92,255,0.78)' },
  cohostRemoveBtn: { backgroundColor: 'rgba(255,45,85,0.74)' },
  timerBtn: { minWidth: SCREEN_WIDTH < 380 ? 24 : 29, height: SCREEN_WIDTH < 380 ? 26 : 28, borderRadius: 14, paddingHorizontal: SCREEN_WIDTH < 380 ? 5 : 7, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  timerBtnText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  cohostTimerText: { width: 34, color: '#fff', fontSize: 10, fontWeight: FontWeight.bold, textAlign: 'right' },
  audiencePanel: { position: 'absolute', left: 16, right: 88, gap: 6, zIndex: 9 },
  audienceRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 12,
    paddingRight: 5,
    backgroundColor: 'rgba(0,0,0,0.34)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  audienceName: { flex: 1, color: 'rgba(255,255,255,0.86)', fontSize: 11, fontWeight: FontWeight.semibold },
  audienceInviteBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },

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
    position: 'absolute', left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.lg,
    height: 66,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(20,20,30,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 28,
    zIndex: 9,
  },
  controlGroup: { alignItems: 'center' },
  controlBtn: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  controlBtnActive: { backgroundColor: Colors.textPrimary },
  endBtn: { width: 54, height: 54, backgroundColor: '#FF2D55', borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  inputRow: { position: 'absolute', left: 12, right: 12, minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 20, elevation: 20 },
  input: { flex: 1, height: 58, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: Radius.full, paddingHorizontal: 18, color: '#fff', fontSize: FontSize.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
