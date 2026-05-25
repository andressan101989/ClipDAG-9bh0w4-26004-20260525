import React, { createContext, useState, useCallback, useEffect, useContext, ReactNode } from 'react';
import { getSupabaseClient } from '@/template';
import { AuthContext } from './AuthContext';
import { SAMPLE_VIDEOS, MOCK_COMMENTS } from '@/services/mockData';
import type { Video, Comment } from '@/services/mockData';

export interface VideoWithMeta extends Video {
  editedAt?: string;
  viewsCount?: number;
  savesCount?: number;
  /** Carousel posts: array of image/video URLs */
  mediaUrls?: string[];
}

export interface VideoAnalytics {
  videoId: string;
  views: number;
  uniqueViews: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  completionRate: number;
  avgWatchMs: number;
  dagEarned: number;
}

interface FeedContextType {
  videos: VideoWithMeta[];
  likedVideos: Set<string>;
  savedVideos: Set<string>;
  comments: Record<string, Comment[]>;
  isLoadingFeed: boolean;
  toggleLike: (videoId: string, creatorId: string) => Promise<void>;
  toggleSave: (videoId: string) => Promise<void>;
  isSaved: (videoId: string) => boolean;
  addComment: (videoId: string, comment: Omit<Comment, 'id' | 'likes' | 'createdAt'>) => Promise<void>;
  addVideo: (video: Omit<Video, 'id' | 'likes' | 'comments' | 'shares' | 'isLiked' | 'createdAt'>) => Promise<void>;
  updateVideo: (videoId: string, updates: { caption?: string; music?: string }) => Promise<{ success: boolean; error?: string }>;
  deleteVideo: (videoId: string, videoUrl?: string, thumbnailUrl?: string) => Promise<{ success: boolean; error?: string }>;
  trackView: (videoId: string, watchDurationMs: number, completed: boolean) => Promise<void>;
  getAnalytics: (videoId: string) => Promise<VideoAnalytics>;
  sendGift: (recipientId: string, videoId: string | null, giftType: string, dagValue: number) => Promise<{ success: boolean; error?: string }>;
  loadMoreVideos: () => Promise<void>;
  isLiked: (videoId: string) => boolean;
  getComments: (videoId: string) => Comment[];
  refreshFeed: () => Promise<void>;
}

export const FeedContext = createContext<FeedContextType | undefined>(undefined);

// ── Map DB row → VideoWithMeta ────────────────────────────────────────────────
function mapVideo(row: Record<string, unknown>, username: string, avatar: string): VideoWithMeta {
  const mediaUrlsRaw = row.media_urls as string[] | null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    username: username || 'user',
    userAvatar: avatar || '',
    videoUrl: (row.video_url as string) || '',
    thumbnailUrl: (row.thumbnail_url as string) || '',
    mediaUrls: Array.isArray(mediaUrlsRaw) && mediaUrlsRaw.length > 0 ? mediaUrlsRaw : undefined,
    caption: (row.caption as string) || '',
    likes: Number(row.likes_count) || 0,
    comments: Number(row.comments_count) || 0,
    shares: Number(row.shares_count) || 0,
    music: (row.music as string) || 'Sin musica',
    isLiked: false,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    editedAt: (row.edited_at as string) || undefined,
    viewsCount: Number(row.views_count) || 0,
    savesCount: Number(row.saves_count) || 0,
  };
}

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
  base64?: string | null
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
    if (error) { console.log('Storage upload error:', error.message); return null; }
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
    return publicUrl;
  } catch (e) {
    console.log('uploadFileFromUri error:', e);
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
async function deleteStorageFile(supabase: ReturnType<typeof getSupabaseClient>, url: string): Promise<void> {
  if (!url || !url.startsWith('http')) return;
  try {
    const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!match) return;
    await supabase.storage.from(match[1]).remove([match[2]]);
  } catch (_) {}
}

const isMockId = (id: string) => /^v\d+$/.test(id);

// ── Debounce view tracking: only log a view per video per 60s window ──────────
const viewedRecently = new Map<string, number>();
function canTrackView(videoId: string): boolean {
  const last = viewedRecently.get(videoId) || 0;
  if (Date.now() - last > 60_000) {
    viewedRecently.set(videoId, Date.now());
    return true;
  }
  return false;
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabaseClient();
  const authContext = useContext(AuthContext);
  const user = authContext?.user;

  const [videos, setVideos] = useState<VideoWithMeta[]>([]);
  const [likedVideos, setLikedVideos] = useState<Set<string>>(new Set());
  const [savedVideos, setSavedVideos] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<Record<string, Comment[]>>(MOCK_COMMENTS);
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [dbOffset, setDbOffset] = useState(0);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [hasMoreDb, setHasMoreDb] = useState(true);

  // ── Load videos ───────────────────────────────────────────────────────────
  const loadVideos = useCallback(async (offset = 0) => {
    if (isLoadingFeed) return;
    setIsLoadingFeed(true);
    try {
      const { data, error } = await supabase
        .from('videos')
        .select('*, user_profiles!videos_user_id_fkey(username, avatar_url)')
        .order('created_at', { ascending: false })
        .range(offset, offset + 9);

      if (!error && data && data.length > 0) {
        const mapped: VideoWithMeta[] = data.map(row => {
          const profile = row.user_profiles as Record<string, string> | null;
          return mapVideo(row as unknown as Record<string, unknown>, profile?.username || 'user', profile?.avatar_url || '');
        });
        if (offset === 0) {
          setVideos([...mapped, ...SAMPLE_VIDEOS]);
        } else {
          setVideos(prev => [...prev, ...mapped]);
        }
        setDbOffset(offset + mapped.length);
        setHasMoreDb(data.length === 10);
      } else if (offset === 0) {
        setVideos(SAMPLE_VIDEOS);
        setHasMoreDb(false);
      } else {
        setHasMoreDb(false);
      }
    } catch (_) {
      if (offset === 0) setVideos(SAMPLE_VIDEOS);
    }
    setIsLoadingFeed(false);
    setInitialLoaded(true);
  }, [supabase]);

  // ── Load likes + saves ────────────────────────────────────────────────────
  const loadLikesAndSaves = useCallback(async (userId: string) => {
    try {
      const [{ data: likesData }, { data: savesData }] = await Promise.all([
        supabase.from('likes').select('video_id').eq('user_id', userId),
        supabase.from('video_saves').select('video_id').eq('user_id', userId),
      ]);
      if (likesData) {
        setLikedVideos(new Set([
          ...likesData.map((l: { video_id: string }) => l.video_id),
          ...SAMPLE_VIDEOS.filter(v => v.isLiked).map(v => v.id),
        ]));
      }
      if (savesData) {
        setSavedVideos(new Set(savesData.map((s: { video_id: string }) => s.video_id)));
      }
    } catch (_) {
      setLikedVideos(new Set(SAMPLE_VIDEOS.filter(v => v.isLiked).map(v => v.id)));
    }
  }, [supabase]);

  useEffect(() => {
    if (!initialLoaded) {
      loadVideos(0);
      if (user) loadLikesAndSaves(user.id);
      else setLikedVideos(new Set(SAMPLE_VIDEOS.filter(v => v.isLiked).map(v => v.id)));
    }
  }, [user?.id, initialLoaded]);

  const refreshFeed = useCallback(async () => {
    setInitialLoaded(false);
    setDbOffset(0);
    setHasMoreDb(true);
    await loadVideos(0);
    if (user) await loadLikesAndSaves(user.id);
    setInitialLoaded(true);
  }, [loadVideos, loadLikesAndSaves, user]);

  const isLiked = useCallback((videoId: string) => likedVideos.has(videoId), [likedVideos]);
  const isSaved = useCallback((videoId: string) => savedVideos.has(videoId), [savedVideos]);
  const getComments = useCallback((videoId: string) => comments[videoId] || [], [comments]);

  // ── Toggle Like ───────────────────────────────────────────────────────────
  const toggleLike = useCallback(async (videoId: string, creatorId: string) => {
    if (!user) return;
    const alreadyLiked = likedVideos.has(videoId);

    // Optimistic update
    setLikedVideos(prev => { const n = new Set(prev); alreadyLiked ? n.delete(videoId) : n.add(videoId); return n; });
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, likes: Math.max(0, v.likes + (alreadyLiked ? -1 : 1)) } : v));

    if (isMockId(videoId)) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        // Revert
        setLikedVideos(prev => { const n = new Set(prev); alreadyLiked ? n.add(videoId) : n.delete(videoId); return n; });
        setVideos(prev => prev.map(v => v.id === videoId ? { ...v, likes: Math.max(0, v.likes + (alreadyLiked ? 1 : -1)) } : v));
        return;
      }
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) return;

      const response = await fetch(`${supabaseUrl}/functions/v1/process_dag_reward`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({ video_id: videoId, creator_id: creatorId }),
      });

      if (!response.ok) {
        // Revert on hard failure
        setLikedVideos(prev => { const n = new Set(prev); alreadyLiked ? n.add(videoId) : n.delete(videoId); return n; });
        setVideos(prev => prev.map(v => v.id === videoId ? { ...v, likes: Math.max(0, v.likes + (alreadyLiked ? 1 : -1)) } : v));
      } else {
        // Sync real count
        const { data: updatedVideo } = await supabase.from('videos').select('likes_count').eq('id', videoId).single();
        if (updatedVideo) setVideos(prev => prev.map(v => v.id === videoId ? { ...v, likes: Number(updatedVideo.likes_count) || v.likes } : v));
      }
    } catch (_) {}
  }, [user, likedVideos, supabase]);

  // ── Toggle Save ───────────────────────────────────────────────────────────
  const toggleSave = useCallback(async (videoId: string) => {
    if (!user || isMockId(videoId)) return;
    const alreadySaved = savedVideos.has(videoId);

    setSavedVideos(prev => { const n = new Set(prev); alreadySaved ? n.delete(videoId) : n.add(videoId); return n; });
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, savesCount: Math.max(0, (v.savesCount || 0) + (alreadySaved ? -1 : 1)) } : v));

    try {
      if (alreadySaved) {
        await supabase.from('video_saves').delete().eq('video_id', videoId).eq('user_id', user.id);
        await supabase.from('videos').update({ saves_count: Math.max(0, (videos.find(v => v.id === videoId)?.savesCount || 1) - 1) }).eq('id', videoId);
      } else {
        await supabase.from('video_saves').insert({ video_id: videoId, user_id: user.id });
        await supabase.from('videos').update({ saves_count: (videos.find(v => v.id === videoId)?.savesCount || 0) + 1 }).eq('id', videoId);
      }
    } catch (_) {
      // Revert
      setSavedVideos(prev => { const n = new Set(prev); alreadySaved ? n.add(videoId) : n.delete(videoId); return n; });
    }
  }, [user, savedVideos, supabase, videos]);

  // ── Track View (debounced, 60s per video) ─────────────────────────────────
  const trackView = useCallback(async (videoId: string, watchDurationMs: number, completed: boolean) => {
    if (isMockId(videoId) || !canTrackView(videoId)) return;
    try {
      await supabase.from('video_views').insert({
        video_id: videoId,
        viewer_id: user?.id || null,
        watch_duration_ms: Math.round(watchDurationMs),
        completed,
      });
      // Increment views_count counter
      const current = videos.find(v => v.id === videoId);
      if (current !== undefined) {
        await supabase.from('videos').update({ views_count: (current.viewsCount || 0) + 1 }).eq('id', videoId);
        setVideos(prev => prev.map(v => v.id === videoId ? { ...v, viewsCount: (v.viewsCount || 0) + 1 } : v));
      }
    } catch (_) {}
  }, [user, supabase, videos]);

  // ── Get Analytics for a specific video ───────────────────────────────────
  const getAnalytics = useCallback(async (videoId: string): Promise<VideoAnalytics> => {
    const video = videos.find(v => v.id === videoId);
    const defaults: VideoAnalytics = {
      videoId,
      views: video?.viewsCount || 0,
      uniqueViews: 0,
      likes: video?.likes || 0,
      comments: video?.comments || 0,
      shares: video?.shares || 0,
      saves: video?.savesCount || 0,
      completionRate: 0,
      avgWatchMs: 0,
      dagEarned: (video?.likes || 0) * 0.01,
    };

    if (isMockId(videoId)) return defaults;

    try {
      const { data } = await supabase
        .from('video_views')
        .select('viewer_id, watch_duration_ms, completed')
        .eq('video_id', videoId);

      if (!data || data.length === 0) return defaults;

      const uniqueViewers = new Set(data.filter(r => r.viewer_id).map(r => r.viewer_id)).size;
      const completed = data.filter(r => r.completed).length;
      const totalDurationMs = data.reduce((s, r) => s + (r.watch_duration_ms || 0), 0);

      return {
        ...defaults,
        views: data.length,
        uniqueViews: uniqueViewers,
        completionRate: data.length > 0 ? Math.round((completed / data.length) * 100) : 0,
        avgWatchMs: data.length > 0 ? Math.round(totalDurationMs / data.length) : 0,
      };
    } catch (_) {
      return defaults;
    }
  }, [videos, supabase]);

  // ── Send Gift ─────────────────────────────────────────────────────────────
  const sendGift = useCallback(async (
    recipientId: string,
    videoId: string | null,
    giftType: string,
    dagValue: number
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Inicia sesion para enviar gifts' };
    if (user.id === recipientId) return { success: false, error: 'No puedes enviarte gifts a ti mismo' };
    if ((user.dagBalance || 0) < dagValue) return { success: false, error: 'Balance $DAG insuficiente' };

    try {
      // Insert gift record
      const { error: giftError } = await supabase.from('gifts').insert({
        sender_id: user.id,
        recipient_id: recipientId,
        video_id: videoId,
        gift_type: giftType,
        dag_value: dagValue,
        message: '',
      });
      if (giftError) return { success: false, error: giftError.message };

      // Deduct from sender
      await supabase
        .from('user_profiles')
        .update({ dag_balance: Math.max(0, (user.dagBalance || 0) - dagValue) })
        .eq('id', user.id);

      // Credit recipient
      const { data: recipientData } = await supabase
        .from('user_profiles')
        .select('dag_balance')
        .eq('id', recipientId)
        .single();
      if (recipientData) {
        await supabase
          .from('user_profiles')
          .update({ dag_balance: Number(recipientData.dag_balance || 0) + dagValue })
          .eq('id', recipientId);
      }

      // Log as transaction
      await supabase.from('transactions').insert({
        user_id: user.id,
        amount: dagValue,
        type: 'tip',
        status: 'completed',
        description: `Gift ${giftType} enviado`,
      });

      // Update local DAG balance
      authContext?.updateDAGBalance((user.dagBalance || 0) - dagValue);

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Error al enviar gift' };
    }
  }, [user, supabase, authContext]);

  // ── Add Comment ───────────────────────────────────────────────────────────
  const addComment = useCallback(async (videoId: string, comment: Omit<Comment, 'id' | 'likes' | 'createdAt'>) => {
    const newComment: Comment = { ...comment, id: `c_${Date.now()}`, likes: 0, createdAt: new Date().toISOString() };
    setComments(prev => ({ ...prev, [videoId]: [newComment, ...(prev[videoId] || [])] }));
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, comments: v.comments + 1 } : v));
    if (!isMockId(videoId) && user) {
      try {
        await supabase.from('comments').insert({ user_id: user.id, video_id: videoId, text: comment.text });
        const { data: vid } = await supabase.from('videos').select('comments_count').eq('id', videoId).single();
        if (vid) await supabase.from('videos').update({ comments_count: (vid.comments_count || 0) + 1 }).eq('id', videoId);
      } catch (_) {}
    }
  }, [user, supabase]);

  // ── Add Video ─────────────────────────────────────────────────────────────
  const addVideo = useCallback(async (video: Omit<Video, 'id' | 'likes' | 'comments' | 'shares' | 'isLiked' | 'createdAt'> & { mediaUrls?: string[] }) => {
    if (!user) return;
    try {
      const insertPayload: Record<string, unknown> = {
        user_id: user.id,
        video_url: video.videoUrl,
        thumbnail_url: video.thumbnailUrl || '',
        caption: video.caption,
        music: video.music || 'Sin musica',
      };
      // Carousel support: persist multiple media URLs
      if (video.mediaUrls && video.mediaUrls.length > 1) {
        insertPayload.media_urls = video.mediaUrls;
      }

      const { data, error } = await supabase.from('videos').insert(insertPayload)
        .select('*, user_profiles!videos_user_id_fkey(username, avatar_url)').single();

      if (!error && data) {
        const profile = data.user_profiles as Record<string, string> | null;
        const newVideo: VideoWithMeta = mapVideo(
          data as unknown as Record<string, unknown>,
          profile?.username || user.username || 'user',
          profile?.avatar_url || user.avatar || ''
        );
        setVideos(prev => [newVideo, ...prev]);
      }
    } catch (e) { console.log('addVideo error:', e); }
  }, [user, supabase]);

  // ── Update Video ──────────────────────────────────────────────────────────
  const updateVideo = useCallback(async (videoId: string, updates: { caption?: string; music?: string }): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'No autenticado' };
    if (isMockId(videoId)) {
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, ...updates } : v));
      return { success: true };
    }
    try {
      const { error } = await supabase.from('videos')
        .update({ ...updates, edited_at: new Date().toISOString() })
        .eq('id', videoId).eq('user_id', user.id);
      if (error) return { success: false, error: error.message };
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, ...updates, editedAt: new Date().toISOString() } : v));
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  }, [user, supabase]);

  // ── Delete Video ──────────────────────────────────────────────────────────
  const deleteVideo = useCallback(async (videoId: string, videoUrl?: string, thumbnailUrl?: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'No autenticado' };
    if (isMockId(videoId)) {
      setVideos(prev => prev.filter(v => v.id !== videoId));
      return { success: true };
    }
    try {
      const { error } = await supabase.from('videos').delete().eq('id', videoId).eq('user_id', user.id);
      if (error) return { success: false, error: error.message };
      setVideos(prev => prev.filter(v => v.id !== videoId));
      setLikedVideos(prev => { const n = new Set(prev); n.delete(videoId); return n; });
      setSavedVideos(prev => { const n = new Set(prev); n.delete(videoId); return n; });
      setComments(prev => { const n = { ...prev }; delete n[videoId]; return n; });
      if (videoUrl) await deleteStorageFile(supabase, videoUrl);
      if (thumbnailUrl && thumbnailUrl !== videoUrl) await deleteStorageFile(supabase, thumbnailUrl);
      return { success: true };
    } catch (e: any) { return { success: false, error: e.message }; }
  }, [user, supabase]);

  const loadMoreVideos = useCallback(async () => {
    if (!isLoadingFeed && hasMoreDb) await loadVideos(dbOffset);
  }, [loadVideos, dbOffset, isLoadingFeed, hasMoreDb]);

  return (
    <FeedContext.Provider value={{
      videos, likedVideos, savedVideos, comments, isLoadingFeed,
      toggleLike, toggleSave, isSaved,
      addComment, addVideo, updateVideo, deleteVideo,
      trackView, getAnalytics, sendGift,
      loadMoreVideos, isLiked, getComments, refreshFeed,
    }}>
      {children}
    </FeedContext.Provider>
  );
}
