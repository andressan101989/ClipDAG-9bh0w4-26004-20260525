/** Canonical chronological organic delivery and interaction authority. */

import React, {
  createContext, useState, useCallback, useEffect,
  useContext, useRef, useMemo, ReactNode,
} from 'react';
import { getSupabaseClient } from '@/template';
import { AuthContext }        from './AuthContext';
import { randomUUID } from 'expo-crypto';
import type { Video, Comment } from '@/services/mockData';
import {
  cursorFromVideoRows,
  videoKeysetOrFilter,
  type VideoKeysetCursor,
} from '@/services/feedKeyset';
import type { FinalizedVideoView } from '@/services/videoPlaybackSession';
import { mapVideoRow } from '@/services/videoPresentation';
import {
  createMediaOperationId,
  deleteMediaAsset,
  extractRpcUuid,
  getSafeMediaError,
  invokeRpcWithSingleAuthRefresh,
  MediaEntityRpcError,
} from '@/services/mediaService';
import {
  deleteStreamVideo,
  extractNullableStreamRpcUuid,
  getSafeStreamError,
} from '@/services/streamService';
import { fetchMarketplaceContentProductTags } from '@/services/marketplaceCreatorContentTagService';
import { sendGift as sendLedgerGift } from '@/services/financial/ledgerClient';

export interface VideoWithMeta extends Video {
  editedAt?:   string;
  viewsCount?: number;
  savesCount?: number;
  /** Carousel posts: array of image/video URLs */
  mediaUrls?:  string[];
}

export type AddVideoInput = Omit<
  Video,
  'id' | 'likes' | 'comments' | 'shares' | 'isLiked' | 'createdAt'
> & {
  mediaUrls?: string[];
  mediaAssetIds?: string[];
  isExclusive?: boolean;
  exclusivePrice?: number;
  exclusiveContentId?: string;
};

export interface VideoAnalytics {
  videoId:        string;
  views:          number;
  uniqueViews:    number;
  likes:          number;
  comments:       number;
  shares:         number;
  saves:          number;
  completionRate: number;
  avgWatchMs:     number;
  dagEarned:      number;
}

export type EnsureVideoLoadedResult =
  | { status: 'available'; videoId: string; alreadyLoaded: boolean }
  | { status: 'unavailable' };

interface FeedContextType {
  videos:          VideoWithMeta[];
  likedVideos:     Set<string>;
  savedVideos:     Set<string>;
  comments:        Record<string, Comment[]>;
  isLoadingFeed:   boolean;
  toggleLike:      (videoId: string, creatorId: string) => Promise<void>;
  toggleSave:      (videoId: string) => Promise<void>;
  isSaved:         (videoId: string) => boolean;
  addComment:      (videoId: string, comment: Omit<Comment, 'id' | 'likes' | 'createdAt'>) => Promise<void>;
  addVideo:        (video: AddVideoInput) => Promise<string | undefined>;
  updateVideo:     (videoId: string, updates: { caption?: string; music?: string }) => Promise<{ success: boolean; error?: string }>;
  deleteVideo:     (videoId: string, videoUrl?: string, thumbnailUrl?: string) => Promise<{ success: boolean; error?: string }>;
  trackView:       (videoId: string, event: FinalizedVideoView) => Promise<void>;
  getAnalytics:    (videoId: string) => Promise<VideoAnalytics>;
  sendGift:        (recipientId: string, videoId: string | null, giftType: string, dagValue: number) => Promise<{ success: boolean; error?: string }>;
  ensureVideoLoadedById: (videoId: string) => Promise<EnsureVideoLoadedResult>;
  loadMoreVideos:  () => Promise<void>;
  isLiked:         (videoId: string) => boolean;
  getComments:     (videoId: string) => Comment[];
  refreshFeed:     () => Promise<void>;
}

export const FeedContext = createContext<FeedContextType | undefined>(undefined);

// ── Safe base64 decode (Hermes-compatible) ────────────────────────────────────
export function base64ToUint8Array(base64: string): Uint8Array {
  try {
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    return bytes;
  } catch (_) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup: Record<string, number> = {};
    for (let i = 0; i < chars.length; i++) lookup[chars[i]] = i;
    const cleaned = base64.replace(/[^A-Za-z0-9+/]/g, '');
    const len = cleaned.length;
    let bufLen = (len * 3) >> 2;
    if (cleaned[len - 1] === '=') bufLen--;
    if (cleaned[len - 2] === '=') bufLen--;
    const buf = new Uint8Array(bufLen);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const a = lookup[cleaned[i]] ?? 0;
      const b = lookup[cleaned[i + 1]] ?? 0;
      const c = lookup[cleaned[i + 2]] ?? 0;
      const d = lookup[cleaned[i + 3]] ?? 0;
      buf[p++] = (a << 2) | (b >> 4);
      if (p < bufLen) buf[p++] = ((b & 15) << 4) | (c >> 2);
      if (p < bufLen) buf[p++] = ((c & 3) << 6) | d;
    }
    return buf;
  }
}

// ── Upload file from local URI to Supabase Storage ────────────────────────────
export async function uploadFileFromUri(
  supabase: ReturnType<typeof getSupabaseClient>,
  uri: string,
  bucket: string,
  path: string,
  mimeType: string,
  base64?: string | null,
): Promise<string | null> {
  try {
    let fileData: Uint8Array;
    if (base64) {
      fileData = base64ToUint8Array(base64);
    } else if (uri.startsWith('http://') || uri.startsWith('https://')) {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      const reader = new FileReader();
      fileData = await new Promise<Uint8Array>((resolve, reject) => {
        reader.onloadend = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });
    } else {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      if (typeof FileReader !== 'undefined') {
        const reader = new FileReader();
        fileData = await new Promise<Uint8Array>((resolve, reject) => {
          reader.onloadend = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
          reader.onerror = reject;
          reader.readAsArrayBuffer(blob);
        });
      } else {
        const ab = await blob.arrayBuffer();
        fileData = new Uint8Array(ab);
      }
    }
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, fileData, { contentType: mimeType, upsert: true });
    if (error) { console.error('[uploadFileFromUri] Storage upload error:', error.message); return null; }
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
    return publicUrl;
  } catch (e) {
    console.error('[uploadFileFromUri] error:', e);
    return null;
  }
}

// ── Detect MIME from extension ────────────────────────────────────────────────
export function detectMimeType(uri: string, defaultType: string): string {
  const ext = uri.split('?')[0].toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  };
  return map[ext] || defaultType;
}

// ── Delete storage file by public URL ─────────────────────────────────────────
async function deleteStorageFile(
  supabase: ReturnType<typeof getSupabaseClient>,
  url: string,
): Promise<void> {
  if (!url || !url.startsWith('http')) return;
  try {
    const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!match) return;
    await supabase.storage.from(match[1]).remove([match[2]]);
  } catch (_) {}
}

const isMockId = (id: string) => /^v\d+$/.test(id);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Provider ──────────────────────────────────────────────────────────────────

export function FeedProvider({ children }: { children: ReactNode }) {
  const authContext = useContext(AuthContext);
  const user = authContext?.user;

  // The client is stored once so backend unavailability can fail soft to an
  // empty/error state without substituting fixture content.
  const supabaseRef   = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  const supabaseOk    = useRef(true);
  const isLoadingRef  = useRef(false);
  const videosRef     = useRef<VideoWithMeta[]>([]);
  const clientSessionIdRef = useRef<string | null>(null);
  const exactVideoFlightsRef = useRef(new Map<string, Promise<EnsureVideoLoadedResult>>());

  if (!clientSessionIdRef.current) clientSessionIdRef.current = randomUUID();

  if (!supabaseRef.current) {
    try {
      supabaseRef.current = getSupabaseClient();
    } catch (e) {
      console.warn('[FeedContext] getSupabaseClient failed:', e);
      supabaseOk.current = false;
    }
  }

  const [videos,          setVideos]          = useState<VideoWithMeta[]>([]);
  const [likedVideos,     setLikedVideos]     = useState<Set<string>>(new Set());
  const [savedVideos,     setSavedVideos]     = useState<Set<string>>(new Set());
  const [comments,        setComments]        = useState<Record<string, Comment[]>>({});
  const [isLoadingFeed,   setIsLoadingFeed]   = useState(false);
  const [dbCursor,        setDbCursor]        = useState<VideoKeysetCursor | null>(null);
  const [initialLoaded,   setInitialLoaded]   = useState(false);
  const [hasMoreDb,       setHasMoreDb]       = useState(true);
  const [blockedUserIds,  setBlockedUserIds]  = useState<Set<string>>(new Set());

  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  // ── Load videos ───────────────────────────────────────────────────────────
  const loadVideos = useCallback(async (cursor: VideoKeysetCursor | null = null) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoadingFeed(true);
    try {
      const supabase = supabaseRef.current;
      if (!supabase || !supabaseOk.current) {
        if (!cursor) setVideos([]);
        setHasMoreDb(false);
        return;
      }

      let query = supabase
        .from('videos')
        .select('*, user_profiles!videos_user_id_fkey(username, avatar_url)')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(10);
      if (cursor) query = query.or(videoKeysetOrFilter(cursor));
      const { data, error } = await query;

      if (error) throw error;

      if (data && data.length > 0) {
        const mapped: VideoWithMeta[] = data.map(row => {
          const profile = row.user_profiles as Record<string, string> | null;
          return mapVideoRow(row as unknown as Record<string, unknown>, profile?.username || 'user', profile?.avatar_url || '');
        });
        if (!cursor) {
          setVideos(mapped);
        } else {
          setVideos(prev => {
            const existingIds = new Set(prev.map(video => video.id));
            return [...prev, ...mapped.filter(video => !existingIds.has(video.id))];
          });
        }
        setDbCursor(cursorFromVideoRows(data));
        setHasMoreDb(data.length === 10);
      } else {
        if (!cursor) setVideos([]);
        setHasMoreDb(false);
      }
    } catch (e) {
      console.warn('[FeedContext] loadVideos error:', e);
      if (!cursor) setVideos([]);
      setHasMoreDb(false);
    } finally {
      isLoadingRef.current = false;
      setIsLoadingFeed(false);
      setInitialLoaded(true);
    }
  }, []);

  // ── Load blocked users ────────────────────────────────────────────────────
  const loadBlockedUsers = useCallback(async (userId: string) => {
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return;
    try {
      const { data } = await supabase
        .from('blocked_users')
        .select('blocked_id')
        .eq('blocker_id', userId);
      if (data) setBlockedUserIds(new Set(data.map((r: { blocked_id: string }) => r.blocked_id)));
    } catch (e) {
      console.warn('[FeedContext] loadBlockedUsers error:', e);
    }
  }, []);

  // ── Load likes + saves ────────────────────────────────────────────────────
  const loadLikesAndSaves = useCallback(async (userId: string) => {
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) {
      setLikedVideos(new Set());
      setSavedVideos(new Set());
      return;
    }
    try {
      const [{ data: likesData }, { data: savesData }] = await Promise.all([
        supabase.from('likes').select('video_id').eq('user_id', userId),
        supabase.from('video_saves').select('video_id').eq('user_id', userId),
      ]);
      setLikedVideos(new Set((likesData || []).map((l: { video_id: string }) => l.video_id)));
      if (savesData) {
        setSavedVideos(new Set(savesData.map((s: { video_id: string }) => s.video_id)));
      }
    } catch (e) {
      console.warn('[FeedContext] loadLikesAndSaves error:', e);
      setLikedVideos(new Set());
      setSavedVideos(new Set());
    }
  }, []);

  useEffect(() => {
    if (!initialLoaded) {
      loadVideos(null);
      if (user) {
        loadLikesAndSaves(user.id);
        loadBlockedUsers(user.id);
      } else {
        setLikedVideos(new Set());
        setSavedVideos(new Set());
      }
    }
  }, [user?.id, initialLoaded]);

  const refreshFeed = useCallback(async () => {
    setInitialLoaded(false);
    setDbCursor(null);
    setHasMoreDb(true);
    await loadVideos(null);
    if (user) {
      await loadLikesAndSaves(user.id);
      await loadBlockedUsers(user.id);
    }
    setInitialLoaded(true);
  }, [loadVideos, loadLikesAndSaves, loadBlockedUsers, user]);

  const confirmMarketplaceContentVisible = useCallback(async (videoId: string) => {
    // The public product-tag RPC is the existing authenticated facade that
    // delegates visibility to marketplace_creator_content_visible. Trying the
    // two canonical types avoids reading the video row merely to infer its type.
    for (const contentType of ['feed', 'reel'] as const) {
      try {
        const result = await fetchMarketplaceContentProductTags(contentType, videoId);
        return result.visible;
      } catch {
        // A type mismatch is intentionally indistinguishable from a missing ID.
      }
    }
    return false;
  }, []);

  const ensureVideoLoadedById = useCallback((videoId: string): Promise<EnsureVideoLoadedResult> => {
    const normalizedId = videoId.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalizedId)) return Promise.resolve({ status: 'unavailable' });

    const loaded = videosRef.current.find(video => video.id === normalizedId);
    if (loaded) {
      return Promise.resolve({ status: 'available', videoId: loaded.id, alreadyLoaded: true });
    }

    const pending = exactVideoFlightsRef.current.get(normalizedId);
    if (pending) return pending;

    const flight = (async (): Promise<EnsureVideoLoadedResult> => {
      const supabase = supabaseRef.current;
      if (!supabase || !supabaseOk.current) return { status: 'unavailable' };
      if (!await confirmMarketplaceContentVisible(normalizedId)) return { status: 'unavailable' };

      const { data, error } = await supabase
        .from('videos')
        .select('*, user_profiles!videos_user_id_fkey(username, avatar_url)')
        .eq('id', normalizedId)
        .maybeSingle();
      if (error || !data) return { status: 'unavailable' };

      const profile = data.user_profiles as Record<string, string> | null;
      const mapped = mapVideoRow(
        data as unknown as Record<string, unknown>,
        profile?.username || 'user',
        profile?.avatar_url || '',
      );
      setVideos(current => {
        if (current.some(video => video.id === mapped.id)) return current;
        const next = [...current, mapped];
        videosRef.current = next;
        return next;
      });
      return { status: 'available', videoId: mapped.id, alreadyLoaded: false };
    })().catch((): EnsureVideoLoadedResult => ({ status: 'unavailable' })).finally(() => {
      if (exactVideoFlightsRef.current.get(normalizedId) === flight) {
        exactVideoFlightsRef.current.delete(normalizedId);
      }
    });

    exactVideoFlightsRef.current.set(normalizedId, flight);
    return flight;
  }, [confirmMarketplaceContentVisible]);

  const isLiked     = useCallback((videoId: string) => likedVideos.has(videoId), [likedVideos]);
  const isSaved     = useCallback((videoId: string) => savedVideos.has(videoId), [savedVideos]);
  const getComments = useCallback((videoId: string) => comments[videoId] || [], [comments]);

  // ── Toggle Like ───────────────────────────────────────────────────────────
  const toggleLike = useCallback(async (videoId: string, creatorId: string) => {
    const supabase = supabaseRef.current;
    if (!user) return undefined;
    const alreadyLiked = likedVideos.has(videoId);

    // Optimistic update
    setLikedVideos(prev => { const n = new Set(prev); alreadyLiked ? n.delete(videoId) : n.add(videoId); return n; });
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, likes: Math.max(0, v.likes + (alreadyLiked ? -1 : 1)) } : v));

    if (isMockId(videoId) || !supabase || !supabaseOk.current) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        // Revert
        setLikedVideos(prev => { const n = new Set(prev); alreadyLiked ? n.add(videoId) : n.delete(videoId); return n; });
        setVideos(prev => prev.map(v => v.id === videoId ? { ...v, likes: Math.max(0, v.likes + (alreadyLiked ? 1 : -1)) } : v));
        return;
      }
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const anonKey     = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) return;

      const response = await fetch(`${supabaseUrl}/functions/v1/process_dag_reward`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey':        anonKey,
        },
        body: JSON.stringify({ video_id: videoId, creator_id: creatorId }),
      });

      if (!response.ok) {
        setLikedVideos(prev => { const n = new Set(prev); alreadyLiked ? n.add(videoId) : n.delete(videoId); return n; });
        setVideos(prev => prev.map(v => v.id === videoId ? { ...v, likes: Math.max(0, v.likes + (alreadyLiked ? 1 : -1)) } : v));
      } else {
        const { data: updatedVideo } = await supabase.from('videos').select('likes_count').eq('id', videoId).single();
        if (updatedVideo) setVideos(prev => prev.map(v => v.id === videoId ? { ...v, likes: Number(updatedVideo.likes_count) || v.likes } : v));
      }
    } catch (e) {
      console.warn('[FeedContext] toggleLike error:', e);
    }
  }, [user, likedVideos]);

  // ── Toggle Save — stale-closure-free counter update ───────────────────────
  // Uses functional setVideos to read the LATEST savesCount, not a closure.
  const toggleSave = useCallback(async (videoId: string) => {
    const supabase = supabaseRef.current;
    if (!user || isMockId(videoId)) return;
    const alreadySaved = savedVideos.has(videoId);

    // Optimistic
    setSavedVideos(prev => { const n = new Set(prev); alreadySaved ? n.delete(videoId) : n.add(videoId); return n; });
    setVideos(prev => prev.map(v =>
      v.id === videoId ? { ...v, savesCount: Math.max(0, (v.savesCount || 0) + (alreadySaved ? -1 : 1)) } : v,
    ));

    if (!supabase || !supabaseOk.current) return;

    try {
      if (alreadySaved) {
        await supabase.from('video_saves').delete().eq('video_id', videoId).eq('user_id', user.id);
        // Atomic RPC — no need to read the current count first, so no
        // stale-closure race is even possible.
        supabase.rpc('increment_video_counter', {
          p_video_id: videoId, p_field: 'saves_count', p_delta: -1,
        }).then(undefined, () => {});
      } else {
        await supabase.from('video_saves').insert({ video_id: videoId, user_id: user.id });
        supabase.rpc('increment_video_counter', {
          p_video_id: videoId, p_field: 'saves_count', p_delta: 1,
        }).then(undefined, () => {});
      }
    } catch (e) {
      console.warn('[FeedContext] toggleSave error:', e);
      // Revert
      setSavedVideos(prev => { const n = new Set(prev); alreadySaved ? n.add(videoId) : n.delete(videoId); return n; });
      setVideos(prev => prev.map(v =>
        v.id === videoId ? { ...v, savesCount: Math.max(0, (v.savesCount || 0) + (alreadySaved ? 1 : -1)) } : v,
      ));
    }
  }, [user, savedVideos]);

  // ── Track View — stale-closure-free ──────────────────────────────────────
  const trackView = useCallback(async (videoId: string, event: FinalizedVideoView) => {
    const supabase = supabaseRef.current;
    if (!UUID_PATTERN.test(videoId) || !supabase || !supabaseOk.current) return;
    const payload = {
      p_video_id: videoId,
      p_client_event_id: event.clientEventId,
      p_client_session_id: clientSessionIdRef.current,
      p_watch_duration_ms: Math.max(0, Math.round(event.watchDurationMs)),
      p_exit_reason: event.exitReason,
    };
    try {
      let response = await supabase.rpc('record_video_view_v1', payload);
      if (response.error) response = await supabase.rpc('record_video_view_v1', payload);
      if (response.error) throw response.error;
      const result = Array.isArray(response.data) ? response.data[0] : response.data;
      if (result && result.status === 'recorded') {
        setVideos(prev => prev.map(video => video.id === videoId
          ? { ...video, viewsCount: Number(result.views_count) || (video.viewsCount || 0) + 1 }
          : video));
      }
    } catch (e) {
      console.warn('[FeedContext] trackView error:', e);
    }
  }, []);

  // ── Get Analytics ─────────────────────────────────────────────────────────
  const getAnalytics = useCallback(async (videoId: string): Promise<VideoAnalytics> => {
    const supabase = supabaseRef.current;
    const video = videos.find(v => v.id === videoId);
    const defaults: VideoAnalytics = {
      videoId,
      views:          video?.viewsCount || 0,
      uniqueViews:    0,
      likes:          video?.likes || 0,
      comments:       video?.comments || 0,
      shares:         video?.shares || 0,
      saves:          video?.savesCount || 0,
      completionRate: 0,
      avgWatchMs:     0,
      dagEarned:      (video?.likes || 0) * 0.01,
    };

    if (isMockId(videoId) || !supabase || !supabaseOk.current) return defaults;

    try {
      const { data, error } = await supabase.rpc('get_my_video_analytics_v1', {
        p_video_id: videoId,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result) return defaults;

      return {
        ...defaults,
        views:          Number(result.views) || 0,
        uniqueViews:    Number(result.unique_authenticated_viewers) || 0,
        completionRate: Math.round((Number(result.completion_rate) || 0) * 100),
        avgWatchMs:     Math.round(Number(result.avg_watch_ms) || 0),
      };
    } catch (e) {
      console.warn('[FeedContext] getAnalytics error:', e);
      return defaults;
    }
  }, [videos]);

  // ── Send Gift ─────────────────────────────────────────────────────────────
  const sendGift = useCallback(async (
    recipientId: string,
    videoId:     string | null,
    giftType:    string,
    dagValue:    number,
  ): Promise<{ success: boolean; error?: string }> => {
    const supabase = supabaseRef.current;
    if (!user) return { success: false, error: 'Inicia sesion para enviar gifts' };
    if (user.id === recipientId) return { success: false, error: 'No puedes enviarte gifts a ti mismo' };
    if ((user.dagBalance || 0) < dagValue) return { success: false, error: 'Balance $DAG insuficiente' };
    if (!supabase || !supabaseOk.current) return { success: false, error: 'Backend no disponible' };

    try {
      const result = await sendLedgerGift({
        toUserId: recipientId,
        videoId: videoId ?? undefined,
        giftType,
        amount: dagValue,
      });
      if (!result.success) return { success: false, error: result.error || 'No se pudo enviar el gift' };
      await authContext?.refreshProfile();
      return { success: true };
    } catch (e: any) {
      console.warn('[FeedContext] sendGift error:', e);
      return { success: false, error: e.message || 'Error al enviar gift' };
    }
  }, [user, authContext]);

  // ── Add Comment ───────────────────────────────────────────────────────────
  const addComment = useCallback(async (videoId: string, comment: Omit<Comment, 'id' | 'likes' | 'createdAt'>) => {
    const supabase = supabaseRef.current;
    const newComment: Comment = { ...comment, id: `c_${Date.now()}`, likes: 0, createdAt: new Date().toISOString() };
    setComments(prev => ({ ...prev, [videoId]: [newComment, ...(prev[videoId] || [])] }));
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, comments: v.comments + 1 } : v));
    if (!isMockId(videoId) && user && supabase && supabaseOk.current) {
      try {
        await supabase.from('comments').insert({ user_id: user.id, video_id: videoId, text: comment.text });
        // Atomic RPC replaces the previous read-then-write (select
        // comments_count, then update with the computed value), which
        // raced under concurrent commenters.
        await supabase.rpc('increment_video_counter', {
          p_video_id: videoId, p_field: 'comments_count', p_delta: 1,
        });
      } catch (e) {
        console.warn('[FeedContext] addComment error:', e);
      }
    }
  }, [user]);

  // ── Add Video ─────────────────────────────────────────────────────────────
  const addVideo = useCallback(async (video: AddVideoInput) => {
    const supabase = supabaseRef.current;
    if (!user) return;
    if (!supabase || !supabaseOk.current) return undefined;
    try {
      if (video.mediaUrls && video.mediaUrls.length >= 2) {
        const operationId=createMediaOperationId('carousel');
        const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
        if(sessionError||!sessionData.session) {
          throw new MediaEntityRpcError({
            stage:'CAROUSEL_AUTH',code:'session_missing',message:'session_missing',
            operationId,
          });
        }
        const invokeCarousel=()=>supabase.rpc('create_carousel_post',{
          p_caption:video.caption,
          p_music:video.music||'Sin musica',
          p_asset_ids:video.mediaAssetIds??[],
        });
        const {data,error}=await invokeRpcWithSingleAuthRefresh(
          invokeCarousel,
          ()=>supabase.auth.refreshSession().then(result=>({
            error:result.error?new MediaEntityRpcError({
              stage:'CAROUSEL_AUTH',code:result.error.code??'session_refresh_failed',
              message:result.error.message,operationId,
            }):null,
          })),
        );
        if (error) {
          const safe=getSafeMediaError(error,'CAROUSEL_CREATE_POST',{operationId});
          console.warn('[FeedContext] carousel RPC failed', {
            operationId:safe.operationId,stage:safe.stage,code:safe.code,
            message:safe.message,details:safe.details,hint:safe.hint,status:safe.httpStatus,
          });
          throw new MediaEntityRpcError({
            stage:'CAROUSEL_CREATE_POST',code:safe.code,message:safe.message,
            details:safe.details,hint:safe.hint,httpStatus:safe.httpStatus,operationId,
          });
        }
        let postId:string;
        try { postId=extractRpcUuid(data,'create_carousel_post'); }
        catch(error) {
          const safe=getSafeMediaError(error,'CAROUSEL_CLIENT_RESPONSE',{operationId});
          throw new MediaEntityRpcError({...safe,operationId});
        }
        const newVideo: VideoWithMeta = {
          id: postId,
          userId: user.id,
          username: user.username || 'user',
          userAvatar: user.avatar || '',
          videoUrl: video.videoUrl,
          thumbnailUrl: video.thumbnailUrl || video.videoUrl,
          mediaUrls: [...video.mediaUrls],
          caption: video.caption,
          likes: 0,
          comments: 0,
          shares: 0,
          music: video.music || 'Sin musica',
          isLiked: false,
          createdAt: new Date().toISOString(),
        };
        setVideos(prev => [newVideo, ...prev]);
        return postId;
      }
      if (video.mediaAssetIds?.length === 1) {
        const { data, error } = await supabase.rpc('create_photo_post_with_media', {
          p_caption: video.caption,
          p_music: video.music || 'Sin musica',
          p_asset_id: video.mediaAssetIds[0],
        });
        if (error) {
          throw Object.assign(new Error('PHOTO_CREATE_POST_FAILED'), {
            code: error.code ?? 'unknown',
            stage: 'PHOTO_CREATE_POST',
          });
        }
        const photoId=extractRpcUuid(data,'create_photo_post_with_media');
        const newVideo: VideoWithMeta = {
          id:photoId,userId:user.id,username:user.username||'user',userAvatar:user.avatar||'',
          videoUrl:video.videoUrl,thumbnailUrl:video.videoUrl,caption:video.caption,
          likes:0,comments:0,shares:0,music:video.music||'Sin musica',
          isLiked:false,createdAt:new Date().toISOString(),
        };
        setVideos(prev => [newVideo,...prev]);
        return photoId;
      }

      const insertPayload: Record<string, unknown> = {
        user_id:       user.id,
        video_url:     video.videoUrl,
        thumbnail_url: video.thumbnailUrl || '',
        caption:       video.caption,
        music:         video.music || 'Sin musica',
      };
      const { data, error } = await supabase.from('videos').insert(insertPayload)
        .select('*, user_profiles!videos_user_id_fkey(username, avatar_url)').single();

      if (!error && data) {
        const profile = data.user_profiles as Record<string, string> | null;
        const newVideo: VideoWithMeta = mapVideoRow(
          data as unknown as Record<string, unknown>,
          profile?.username || user.username || 'user',
          profile?.avatar_url || user.avatar || '',
        );
        setVideos(prev => [newVideo, ...prev]);
        return newVideo.id;
      }
      if (error) {
        console.warn('[FeedContext] media entity creation failed', {
          stage: 'CREATE_POST',
          code: error.code ?? 'unknown',
        });
      }
      return undefined;
    } catch (e) {
      const controlled=getSafeMediaError(e,'CREATE_POST');
      console.warn('[FeedContext] addVideo failed', {
        operationId:controlled.operationId,stage:controlled.stage,code:controlled.code,
        message:controlled.message,details:controlled.details,hint:controlled.hint,
      });
      if (controlled.stage.startsWith('CAROUSEL_') || controlled.stage === 'PHOTO_CREATE_POST') throw e;
      return undefined;
    }
  }, [user]);

  // ── Update Video ──────────────────────────────────────────────────────────
  const updateVideo = useCallback(async (videoId: string, updates: { caption?: string; music?: string }): Promise<{ success: boolean; error?: string }> => {
    const supabase = supabaseRef.current;
    if (!user) return { success: false, error: 'No autenticado' };
    if (isMockId(videoId)) {
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, ...updates } : v));
      return { success: true };
    }
    if (!supabase || !supabaseOk.current) return { success: false, error: 'Backend no disponible' };
    try {
      const { error } = await supabase.from('videos')
        .update({ ...updates, edited_at: new Date().toISOString() })
        .eq('id', videoId).eq('user_id', user.id);
      if (error) return { success: false, error: error.message };
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, ...updates, editedAt: new Date().toISOString() } : v));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, [user]);

  // ── Delete Video ──────────────────────────────────────────────────────────
  const deleteVideo = useCallback(async (videoId: string, videoUrl?: string, thumbnailUrl?: string): Promise<{ success: boolean; error?: string }> => {
    const supabase = supabaseRef.current;
    if (!user) return { success: false, error: 'No autenticado' };
    if (isMockId(videoId)) {
      setVideos(prev => prev.filter(v => v.id !== videoId));
      return { success: true };
    }
    if (!supabase || !supabaseOk.current) return { success: false, error: 'Backend no disponible' };
    try {
      const {data:streamAsset,error:streamRpcError}=await supabase.rpc('delete_stream_video_post',{
        p_video_id:videoId,
      });
      if(streamRpcError) return {success:false,error:streamRpcError.message};
      const streamAssetId=extractNullableStreamRpcUuid(streamAsset,'delete_stream_video_post');
      if(streamAssetId) {
        setVideos(prev=>prev.filter(v=>v.id!==videoId));
        setLikedVideos(prev=>{const n=new Set(prev);n.delete(videoId);return n;});
        setSavedVideos(prev=>{const n=new Set(prev);n.delete(videoId);return n;});
        setComments(prev=>{const n={...prev};delete n[videoId];return n;});
        await deleteStreamVideo(streamAssetId).catch(error=>{
          const safe=getSafeStreamError(error,'STREAM_DELETE');
          console.warn('[FeedContext] Stream provider delete deferred',{
            operationId:safe.operationId,stage:safe.stage,code:safe.code,
          });
        });
        return {success:true};
      }
      const { data: linkedAssets } = await supabase
        .from('media_asset_links')
        .select('asset_id')
        .eq('entity_type', 'video_post')
        .eq('entity_id', videoId);
      const { error } = await supabase.from('videos').delete().eq('id', videoId).eq('user_id', user.id);
      if (error) return { success: false, error: error.message };
      setVideos(prev => prev.filter(v => v.id !== videoId));
      setLikedVideos(prev => { const n = new Set(prev); n.delete(videoId); return n; });
      setSavedVideos(prev => { const n = new Set(prev); n.delete(videoId); return n; });
      setComments(prev => { const n = { ...prev }; delete n[videoId]; return n; });
      if (linkedAssets?.length) {
        await Promise.all(linkedAssets.map(({ asset_id }) => deleteMediaAsset(asset_id)));
      } else {
        if (videoUrl) await deleteStorageFile(supabase, videoUrl);
        if (thumbnailUrl && thumbnailUrl !== videoUrl) await deleteStorageFile(supabase, thumbnailUrl);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, [user]);

  const loadMoreVideos = useCallback(async () => {
    if (!isLoadingRef.current && hasMoreDb && dbCursor) await loadVideos(dbCursor);
  }, [loadVideos, dbCursor, hasMoreDb]);

  const filteredVideos = useMemo(
    () => blockedUserIds.size > 0 ? videos.filter(v => !blockedUserIds.has(v.userId)) : videos,
    [videos, blockedUserIds],
  );

  return (
    <FeedContext.Provider value={{
      videos: filteredVideos, likedVideos, savedVideos, comments, isLoadingFeed,
      toggleLike, toggleSave, isSaved,
      addComment, addVideo, updateVideo, deleteVideo,
      trackView, getAnalytics, sendGift,
      ensureVideoLoadedById, loadMoreVideos, isLiked, getComments, refreshFeed,
    }}>
      {children}
    </FeedContext.Provider>
  );
}
