/**
 * components/feature/LiveStreamsList.tsx
 *
 * Horizontal list of currently-live streams (live_sessions.status = 'live'),
 * joined with user_profiles for host username/avatar. Polls every 10s so new
 * streams appear and ended ones drop off without a manual refresh. Tapping a
 * card navigates to /live/watch/[streamId].
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from '@/components/ui/SafeImage';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getSupabaseClient } from '@/template';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const POLL_INTERVAL_MS = 10_000;
const STALE_VISIBLE_MS = 90_000;

interface LiveStream {
  id: string;
  title: string;
  viewerCount: number;
  hostUsername: string;
  hostAvatar: string;
}

export function LiveStreamsList() {
  const router = useRouter();
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchLiveStreams = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) { if (mountedRef.current) setLoading(false); return; }
    try {
      const heartbeatCutoff = new Date(Date.now() - STALE_VISIBLE_MS).toISOString();
      const { data, error } = await supabase
        .from('live_sessions')
        .select('id, title, viewer_count, started_at, last_heartbeat_at, user_profiles!live_sessions_host_id_fkey(username, avatar_url)')
        .eq('status', 'live')
        .or(`last_heartbeat_at.gte.${heartbeatCutoff},and(last_heartbeat_at.is.null,started_at.gte.${heartbeatCutoff})`)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!mountedRef.current) return;
      if (error || !data) { setStreams([]); setLoading(false); return; }

      setStreams(data.map((s: any) => ({
        id:           s.id,
        title:        s.title ?? '',
        viewerCount:  s.viewer_count ?? 0,
        hostUsername: s.user_profiles?.username ?? 'Usuario',
        hostAvatar:   s.user_profiles?.avatar_url ?? '',
      })));
      setLoading(false);
    } catch (e) {
      console.error('[LiveStreamsList] fetchLiveStreams error:', e);
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchLiveStreams();
    pollRef.current = setInterval(fetchLiveStreams, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [fetchLiveStreams]);

  if (loading) {
    return (
      <View style={s.section}>
        <Text style={s.sectionTitle}>En vivo</Text>
        <ActivityIndicator color={Colors.primary} style={{ alignSelf: 'flex-start', marginTop: Spacing.xs }} />
      </View>
    );
  }

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>En vivo</Text>
      {streams.length === 0 ? (
        <Text style={s.emptyText}>No hay transmisiones en vivo</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
          {streams.map(stream => (
            <Pressable
              key={stream.id}
              style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
              onPress={() => router.push(`/live/watch/${stream.id}` as any)}
            >
              <View style={s.avatarWrap}>
                {stream.hostAvatar ? (
                  <Image source={{ uri: stream.hostAvatar }} style={s.avatar} contentFit="cover" />
                ) : (
                  <View style={[s.avatar, s.avatarFallback]}>
                    <Text style={s.avatarInitial}>{stream.hostUsername.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={s.liveBadge}>
                  <View style={s.liveDot} />
                  <Text style={s.liveBadgeText}>EN VIVO</Text>
                </View>
              </View>
              <Text style={s.hostUsername} numberOfLines={1}>@{stream.hostUsername}</Text>
              <Text style={s.streamTitle} numberOfLines={1}>{stream.title}</Text>
              <View style={s.viewerRow}>
                <MaterialIcons name="visibility" size={11} color={Colors.textSubtle} />
                <Text style={s.viewerText}>{stream.viewerCount.toLocaleString()}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section:     { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  emptyText:   { color: Colors.textSubtle, fontSize: FontSize.sm },
  row:         { gap: Spacing.sm, paddingRight: Spacing.md },
  card: {
    width: 140, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.border, gap: 4,
  },
  avatarWrap: { alignItems: 'center', marginBottom: 2 },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: { backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: Colors.primary, fontSize: 18, fontWeight: FontWeight.bold },
  liveBadge: {
    position: 'absolute', bottom: -4, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.secondary, borderRadius: Radius.full,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  liveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#fff' },
  liveBadgeText: { color: '#fff', fontSize: 8, fontWeight: FontWeight.bold },
  hostUsername: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, textAlign: 'center', marginTop: 6 },
  streamTitle: { color: Colors.textSecondary, fontSize: FontSize.xs, textAlign: 'center' },
  viewerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 2 },
  viewerText: { color: Colors.textSubtle, fontSize: 11 },
});
