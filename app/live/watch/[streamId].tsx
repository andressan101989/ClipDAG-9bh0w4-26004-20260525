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
  Keyboard, Platform, ActivityIndicator, Dimensions,
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

function mergeMessages(prev: ChatMessage[], next: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  [...prev, ...next].forEach(message => byId.set(message.id, message));
  return Array.from(byId.values())
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-MAX_MESSAGES);
}

function getFloorSecondsRemaining(participant: LiveParticipant | null) {
  if (!participant?.floor_started_at) return null;
  if (participant.floor_duration_seconds === null || participant.floor_duration_seconds === undefined) return null;

  const startedAt = new Date(participant.floor_started_at).getTime();
  if (Number.isNaN(startedAt)) return null;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return Math.max(0, participant.floor_duration_seconds - elapsed);
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

type HostInviteEvent = {
  id: string;
  payload?: {
    username?: string;
    invited_by_host?: boolean;
  } | null;
};

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
  const [participantRow, setParticipantRow] = useState<LiveParticipant | null>(null);
  const [promotedToPublisher, setPromotedToPublisher] = useState(false);
  const [watchSeconds, setWatchSeconds] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [composerHeight, setComposerHeight] = useState(72);
  const [floorSecondsRemaining, setFloorSecondsRemaining] = useState<number | null>(null);
  const [hostInvite, setHostInvite] = useState<HostInviteEvent | null>(null);

  const agora = useAgoraEngine({ channelName: session?.status === 'live' ? streamId ?? null : null, uid: myUid, role: 'subscriber', profile: 'live-broadcasting' });
  const {
    engineReady, remoteUids, error, join, leave, promoteToPublisher,
    isMuted, isCameraOff, toggleMute, toggleCamera,
  } = agora;
  const demoteToAudience = (agora as any).demoteToAudience as undefined | (() => Promise<boolean>);

  const requestSent = participantRow?.role === 'requested';
  const isStructuredCohost = participantRow?.role === 'cohost' && participantRow?.status === 'active';
  const wasRemoved = participantRow?.role === 'removed' || participantRow?.status === 'removed';

  const chatRef     = useRef<FlatList>(null);
  const inputRef    = useRef<TextInput | null>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgRef  = useRef<string | null>(null);
  const lastSentRef = useRef(0);
  const sendingRef  = useRef(false);
  const mountedRef  = useRef(true);
  const leftRef     = useRef(false);
  const viewerCountBumpedRef = useRef(false);
  const promotingRef = useRef(false);
  const previousRemoteMicMutedRef = useRef<boolean | null>(null);
  const removedHandledRef = useRef(false);
  const timerExpiredHandledRef = useRef(false);
  const participantRowRef = useRef<LiveParticipant | null>(null);
  const lastPromotionKeyRef = useRef<string | null>(null);
  const seenHostInviteIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    participantRowRef.current = participantRow;
  }, [participantRow]);

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

  const markPassiveParticipantInactive = useCallback(async () => {
    const row = participantRowRef.current;
    if (!row || !streamId || !user?.id) return;
    if (row.role !== 'audience' && row.role !== 'requested') return;
    try {
      const { error: inactiveError } = await supabase
        .from('live_participants')
        .update({ status: 'inactive' })
        .eq('session_id', streamId)
        .eq('user_id', user.id)
        .in('role', ['audience', 'requested']);
      if (inactiveError) console.warn('[LiveWatch] participant inactive failed', inactiveError.message);
    } catch (err: any) {
      console.warn('[LiveWatch] participant inactive failed', err?.message ?? err);
    }
  }, [streamId, user?.id, supabase]);

  const loadParticipant = useCallback(async () => {
    if (!streamId || !user?.id) return;
    const username = getDisplayUsername(user);

    try {
      const { data, error: selectError } = await supabase
        .from('live_participants')
        .select('*')
        .eq('session_id', streamId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (selectError) {
        console.warn('[LiveWatch] load participant failed', selectError.message);
        return;
      }

      if (data) {
        if ((data.role === 'audience' || data.role === 'requested') && data.status !== 'active') {
          const { data: activeRow, error: activeError } = await supabase
            .from('live_participants')
            .update({ status: 'active', username, agora_uid: myUid || null })
            .eq('id', data.id)
            .select('*')
            .single();
          if (activeError) {
            console.warn('[LiveWatch] reactivate participant failed', activeError.message);
            setParticipantRow(data as LiveParticipant);
            return;
          }
          setParticipantRow(activeRow as LiveParticipant);
          return;
        }
        setParticipantRow(data as LiveParticipant);
        return;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('live_participants')
        .insert({
          session_id: streamId,
          user_id: user.id,
          agora_uid: myUid || null,
          username,
          role: 'audience',
          status: 'active',
        })
        .select('*')
        .single();

      if (insertError) {
        console.warn('[LiveWatch] create participant failed', insertError.message);
        return;
      }

      setParticipantRow(inserted as LiveParticipant);
    } catch (err: any) {
      console.warn('[LiveWatch] participant sync failed', err?.message ?? err);
    }
  }, [streamId, user, myUid, supabase]);

  useEffect(() => {
    if (session?.status !== 'live' || !user?.id) return;
    loadParticipant();
  }, [session?.status, user?.id, loadParticipant]);

  useEffect(() => {
    if (session?.status !== 'live' || !streamId || !user?.id) return;

    const channel = supabase
      .channel(`live-participant:${streamId}:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_participants', filter: `session_id=eq.${streamId}` },
        payload => {
          const row = (payload.new || payload.old) as LiveParticipant | null;
          if (row?.user_id === user.id) setParticipantRow(row);
        },
      )
      .subscribe();

    const fallback = setInterval(loadParticipant, POLL_INTERVAL_MS);
    return () => {
      clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [session?.status, streamId, user?.id, supabase, loadParticipant]);

  useEffect(() => {
    if (session?.status !== 'live' || !streamId || !user?.id) return;

    const channel = supabase
      .channel(`live-control-invite:${streamId}:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_control_events', filter: `session_id=eq.${streamId}` },
        payload => {
          const row = payload.new as any;
          if (row?.target_user_id !== user.id) return;
          if (row?.event_type !== 'request_join') return;
          if (row?.payload?.invited_by_host !== true) return;
          if (seenHostInviteIdsRef.current.has(row.id)) return;
          seenHostInviteIdsRef.current.add(row.id);
          if (isStructuredCohost || requestSent) return;
          setHostInvite({ id: row.id, payload: row.payload });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.status, streamId, user?.id, supabase, isStructuredCohost, requestSent]);

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
        lastMsgRef.current = mData[mData.length - 1].created_at;
        setMessages(prev => mergeMessages(prev, newMsgs));
        scrollToLatest(true);
      }
    } catch (_) { /* ignore */ }
  }, [streamId, ended, supabase, scrollToLatest]);

  useEffect(() => {
    if (participantRow?.role === 'cohost' && participantRow?.status === 'active') return;
    setPromotedToPublisher(false);
    promotingRef.current = false;
    lastPromotionKeyRef.current = null;
  }, [participantRow?.role, participantRow?.status]);

  useEffect(() => {
    const promotionKey = participantRow
      ? `${participantRow.id}:${participantRow.updated_at}:${participantRow.role}:${participantRow.status}`
      : null;

    if (!isStructuredCohost || wasRemoved || promotingRef.current || !promotionKey) return;
    if (lastPromotionKeyRef.current === promotionKey && promotedToPublisher) return;

    promotingRef.current = true;
    promoteToPublisher().then(ok => {
      if (ok && mountedRef.current) {
        setPromotedToPublisher(true);
        lastPromotionKeyRef.current = promotionKey;
      }
      promotingRef.current = false;
    });
  }, [isStructuredCohost, promotedToPublisher, wasRemoved, participantRow?.id, participantRow?.updated_at, participantRow?.role, participantRow?.status, promoteToPublisher]);

  useEffect(() => {
    if (wasRemoved) return;
    if (!isStructuredCohost) {
      previousRemoteMicMutedRef.current = null;
      return;
    }
    const remoteMicMuted = participantRow?.mic_muted === true;
    const remoteMicLocked = participantRow?.mic_locked === true;
    const previousRemoteMicMuted = previousRemoteMicMutedRef.current;

    if ((remoteMicMuted || remoteMicLocked) && !isMuted) {
      toggleMute();
    } else if (!remoteMicMuted && !remoteMicLocked && previousRemoteMicMuted === true && isMuted) {
      toggleMute();
    }

    previousRemoteMicMutedRef.current = remoteMicMuted;
  }, [isStructuredCohost, wasRemoved, participantRow?.mic_muted, participantRow?.mic_locked, isMuted, toggleMute]);

  useEffect(() => {
    if (!wasRemoved) return;
    if (removedHandledRef.current) return;
    removedHandledRef.current = true;
    setPromotedToPublisher(false);

    if (demoteToAudience) {
      demoteToAudience().then(ok => {
        if (!ok) {
          if (!isMuted) toggleMute();
          if (!isCameraOff) toggleCamera();
        }
      });
      return;
    }

    if (!isMuted) toggleMute();
    if (!isCameraOff) toggleCamera();
  }, [wasRemoved, isMuted, isCameraOff, toggleMute, toggleCamera, demoteToAudience]);

  useEffect(() => {
    if (!wasRemoved) removedHandledRef.current = false;
  }, [wasRemoved]);

  useEffect(() => {
    timerExpiredHandledRef.current = false;
    if (!participantRow?.floor_started_at || participantRow.floor_duration_seconds === null || participantRow.floor_duration_seconds === undefined) {
      setFloorSecondsRemaining(null);
      return;
    }

    const updateRemaining = () => {
      setFloorSecondsRemaining(getFloorSecondsRemaining(participantRow));
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);
    return () => clearInterval(timer);
  }, [participantRow?.floor_started_at, participantRow?.floor_duration_seconds]);

  useEffect(() => {
    if (floorSecondsRemaining !== 0 || !isStructuredCohost || timerExpiredHandledRef.current) return;
    timerExpiredHandledRef.current = true;
    if (!isMuted) toggleMute();
  }, [floorSecondsRemaining, isStructuredCohost, isMuted, toggleMute]);

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
      markPassiveParticipantInactive();
      if (viewerCountBumpedRef.current) {
        viewerCountBumpedRef.current = false;
        bumpViewerCount(-1);
      }
    };
  }, [streamId, markPassiveParticipantInactive]);

  // ── Send message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !user || !streamId || sending || sendingRef.current) return;
    const now = Date.now();
    if (now - lastSentRef.current < SPAM_THROTTLE_MS) return;
    lastSentRef.current = now;
    sendingRef.current = true;
    setSending(true);
    setChatInput('');

    try {
      const username = user.username || user.email?.split('@')[0] || 'user';
      const { data, error: insertError } = await supabase.from('live_messages').insert({
        session_id: streamId, user_id: user.id,
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
      console.warn('[LiveWatch] send message failed', err?.message ?? err);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [chatInput, user, streamId, sending, supabase, scrollToLatest, dismissKeyboard]);

  const requestToJoin = useCallback(async (options?: { acceptedHostInvite?: boolean }) => {
    if (!user || !streamId || requestSent || promotedToPublisher || isStructuredCohost) return;
    const username = getDisplayUsername(user);

    try {
      const { data: existing, error: selectError } = await supabase
        .from('live_participants')
        .select('*')
        .eq('session_id', streamId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (selectError) throw selectError;
      if (existing?.role === 'requested' && existing.status === 'active') {
        setParticipantRow(existing as LiveParticipant);
        return;
      }
      if (existing?.role === 'cohost' && existing.status === 'active') {
        setParticipantRow(existing as LiveParticipant);
        return;
      }
      const retry = existing?.role === 'removed' || existing?.status === 'removed';

      const optimistic: LiveParticipant = {
        ...((existing as LiveParticipant | null) ?? participantRow ?? {
          id: `local_${user.id}`,
          session_id: streamId,
          user_id: user.id,
          agora_uid: myUid || null,
          mic_muted: false,
          mic_locked: false,
          camera_enabled: true,
          floor_granted: false,
          floor_started_at: null,
          floor_duration_seconds: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        session_id: streamId,
        user_id: user.id,
        agora_uid: myUid || null,
        username,
        role: 'requested',
        status: 'active',
        mic_muted: false,
        mic_locked: false,
        camera_enabled: true,
        floor_granted: false,
        floor_started_at: null,
        floor_duration_seconds: null,
      };
      setParticipantRow(optimistic);
      setPromotedToPublisher(false);
      promotingRef.current = false;
      lastPromotionKeyRef.current = null;
      removedHandledRef.current = false;

      const { data, error: upsertError } = await supabase
        .from('live_participants')
        .upsert({
          session_id: streamId,
          user_id: user.id,
          agora_uid: myUid || null,
          username,
          role: 'requested',
          status: 'active',
          mic_muted: false,
          mic_locked: false,
          camera_enabled: true,
          floor_granted: false,
          floor_started_at: null,
          floor_duration_seconds: null,
        }, { onConflict: 'session_id,user_id' })
        .select('*')
        .single();

      if (upsertError) throw upsertError;

      const { error: eventError } = await supabase.from('live_control_events').insert({
        session_id: streamId,
        target_user_id: user.id,
        actor_user_id: user.id,
        event_type: 'request_join',
        payload: {
          username,
          ...(retry ? { retry: true } : {}),
          ...(options?.acceptedHostInvite ? { accepted_host_invite: true } : {}),
        },
      });
      if (eventError) console.warn('[LiveWatch] request event failed', eventError.message);

      if (data) setParticipantRow(data as LiveParticipant);
    } catch (err: any) {
      setParticipantRow(participantRow);
      console.warn('[LiveWatch] request join failed', err?.message ?? err);
      Alert.alert('No se pudo enviar la solicitud');
    }
  }, [user, streamId, requestSent, promotedToPublisher, isStructuredCohost, participantRow, myUid, supabase]);

  const acceptHostInvite = useCallback(() => {
    setHostInvite(null);
    requestToJoin({ acceptedHostInvite: true });
  }, [requestToJoin]);

  const rejectHostInvite = useCallback(() => {
    setHostInvite(null);
  }, []);

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
  const composerBottom = keyboardHeight > 0 ? keyboardHeight : insets.bottom;
  const composerClearance = composerBottom + composerHeight + 16;
  const requestIcon = promotedToPublisher || isStructuredCohost ? 'videocam' : requestSent ? 'hourglass-top' : 'person-add-alt-1';
  const requestDisabled = requestSent || promotedToPublisher || isStructuredCohost || !user;
  const floorTimerText = floorSecondsRemaining === null
    ? null
    : `${Math.floor(floorSecondsRemaining / 60)}:${(floorSecondsRemaining % 60).toString().padStart(2, '0')}`;

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

      <Pressable
        style={styles.keyboardDismissLayer}
        onPress={dismissKeyboard}
        accessibilityLabel="Cerrar teclado"
      />

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

      {hostInvite ? (
        <View style={[styles.hostInvitePanel, { top: insets.top + 154 }]}>
          <MaterialIcons name="person-add-alt-1" size={17} color="#fff" />
          <Text style={styles.hostInviteText} numberOfLines={1}>El anfitrión quiere subirte</Text>
          <Pressable
            style={[styles.hostInviteBtn, styles.hostInviteRejectBtn]}
            onPress={rejectHostInvite}
            hitSlop={6}
            accessibilityLabel="Rechazar invitación del anfitrión"
          >
            <MaterialIcons name="close" size={16} color="#fff" />
          </Pressable>
          <Pressable
            style={[styles.hostInviteBtn, styles.hostInviteAcceptBtn]}
            onPress={acceptHostInvite}
            hitSlop={6}
            accessibilityLabel="Aceptar invitación del anfitrión"
          >
            <MaterialIcons name="check" size={16} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {/* ── Chat + controls ──────────────────────────────────────────────── */}
      {(isStructuredCohost || wasRemoved) ? (
        <View style={[styles.cohostStatusPanel, { top: insets.top + 154 }]}>
          <Pressable
            style={[styles.cohostSelfBtn, (isMuted || participantRow?.mic_locked) && styles.cohostSelfBtnActive, participantRow?.mic_locked && styles.cohostSelfBtnLocked]}
            onPress={() => {
              if (participantRow?.mic_locked) return;
              toggleMute();
            }}
            disabled={!!participantRow?.mic_locked || wasRemoved}
            hitSlop={6}
            accessibilityLabel={participantRow?.mic_locked ? 'Micrófono bloqueado por el anfitrión' : isMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
          >
            <MaterialIcons name={participantRow?.mic_locked ? 'lock' : isMuted ? 'mic-off' : 'mic'} size={15} color="#fff" />
          </Pressable>
          <Pressable
            style={[styles.cohostSelfBtn, isCameraOff && styles.cohostSelfBtnActive]}
            onPress={toggleCamera}
            disabled={wasRemoved}
            hitSlop={6}
            accessibilityLabel={isCameraOff ? 'Activar cámara' : 'Apagar cámara'}
          >
            <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={15} color="#fff" />
          </Pressable>
          <View style={[styles.floorBadge, !participantRow?.floor_granted && styles.floorBadgeMuted]}>
            <MaterialIcons name={participantRow?.floor_granted ? 'record-voice-over' : 'voice-over-off'} size={13} color="#fff" />
            {floorTimerText ? <Text style={styles.floorBadgeText}>{floorTimerText}</Text> : null}
          </View>
          {wasRemoved ? (
            <View style={styles.floorBadgeMuted}>
              <MaterialIcons name="block" size={14} color="#fff" />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actionRail}>
        <View style={styles.actionButton} accessibilityLabel="Me gusta">
          <MaterialIcons name="favorite" size={25} color="#fff" />
        </View>
        <View style={styles.actionButton} accessibilityLabel="Compartir live">
          <MaterialIcons name="ios-share" size={24} color="#fff" />
        </View>
        <View style={styles.actionButton} accessibilityLabel="Regalos">
          <MaterialIcons name="card-giftcard" size={24} color="#fff" />
        </View>
        <Pressable
          style={[styles.actionButton, requestDisabled && styles.actionButtonDisabled]}
          onPress={() => requestToJoin()}
          disabled={requestDisabled}
          accessibilityLabel={wasRemoved ? 'Volver a solicitar subir al live' : 'Solicitar subir al live'}
        >
          <MaterialIcons name={requestIcon} size={24} color="#fff" />
        </Pressable>
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

      <View style={[styles.bottomSection, { bottom: composerClearance + 86 }]}>
        <FlatList
          ref={chatRef}
          data={messages}
          keyExtractor={item => item.id}
          onContentSizeChange={() => scrollToLatest(false)}
          onLayout={() => scrollToLatest(false)}
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
          ListFooterComponent={<View style={{ height: 8 }} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />

      </View>

      <View style={[styles.giftBar, { bottom: composerBottom + composerHeight + 14 }]}>
        {LIVE_GIFT_BAR.map(g => (
          <Pressable
            key={g.id}
            style={[styles.giftBtn, styles.giftBtnDisabled]}
            disabled
          >
            <Text style={styles.giftEmoji}>{g.emoji}</Text>
            <Text style={styles.giftCost}>{g.cost}</Text>
          </Pressable>
        ))}
        <Pressable style={[styles.giftBtn, styles.giftBtnDisabled]} disabled>
          <MaterialIcons name="add" size={21} color="#fff" />
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
  keyboardDismissLayer: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
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

  actionRail: { position: 'absolute', right: 12, top: SCREEN_HEIGHT * 0.28, gap: 12, zIndex: 9 },
  actionButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  actionButtonDisabled: { opacity: 0.6 },
  hostInvitePanel: {
    position: 'absolute',
    left: 16,
    right: 84,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 13,
    paddingRight: 6,
    backgroundColor: 'rgba(0,0,0,0.56)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    zIndex: 12,
  },
  hostInviteText: { flex: 1, color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  hostInviteBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hostInviteRejectBtn: { backgroundColor: 'rgba(255,255,255,0.16)' },
  hostInviteAcceptBtn: { backgroundColor: Colors.primary },
  cohostStatusPanel: { position: 'absolute', left: 16, flexDirection: 'row', alignItems: 'center', gap: 7, zIndex: 10 },
  cohostSelfBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  cohostSelfBtnActive: { backgroundColor: 'rgba(124,92,255,0.76)' },
  cohostSelfBtnLocked: { backgroundColor: 'rgba(255,45,85,0.72)' },
  floorBadge: { minWidth: 34, height: 34, borderRadius: 17, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  floorBadgeMuted: { minWidth: 34, height: 34, borderRadius: 17, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', opacity: 0.82 },
  floorBadgeText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  coHostStrip: { position: 'absolute', right: 12, bottom: 202, width: 138, gap: 12, zIndex: 8 },
  coHostTile: { width: 138, height: 104, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1.5, borderColor: 'rgba(236,72,153,0.62)' },
  coHostVideo: { flex: 1 },
  coHostMic: { position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.48)', alignItems: 'center', justifyContent: 'center' },
  coHostName: { position: 'absolute', left: 8, bottom: 7, color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  bottomSection: {
    position: 'absolute',
    left: 0,
    right: 0,
    maxHeight: 360,
    zIndex: 7,
  },
  chatList: {
    flex: 1,
    maxHeight: SCREEN_HEIGHT * 0.34,
    width: SCREEN_WIDTH * 0.56,
    marginLeft: 12,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },

  giftBar: { position: 'absolute', left: 12, right: 12, height: 70, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, backgroundColor: 'rgba(0,0,0,0.48)', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', zIndex: 12, elevation: 12 },
  giftBtn: { width: 52, height: 50, alignItems: 'center', justifyContent: 'center', gap: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  giftBtnDisabled: { opacity: 0.45 },
  giftEmoji: { fontSize: 20 },
  giftCost: { color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: FontWeight.bold },

  inputRow: { position: 'absolute', left: 12, right: 12, minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 20, elevation: 20 },
  input: { flex: 1, height: 58, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: Radius.full, paddingHorizontal: 18, color: '#fff', fontSize: FontSize.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
