import { getSupabaseClient } from '@/template';
import type { VideoWithMeta } from '@/contexts/FeedContext';

const PLAYABLE_URL_RE = /^(https?:\/\/|file:\/\/)/i;
const VIDEO_PATH_RE = /(^|\/)(videos|gtv-videos-bucket)(\/|$)|\.(mp4|mov|avi|mkv|webm|m4v|m3u8|mpd)(\?|$)|cloudflarestream\.com|videodelivery\.net/i;

function stripStorageBucketPrefix(path: string, bucket: string): string {
  const cleanPath = path.trim().replace(/^\/+/, '');
  if (cleanPath.startsWith(`public/${bucket}/`)) return cleanPath.slice(`public/${bucket}/`.length);
  if (cleanPath.startsWith(`${bucket}/`)) return cleanPath.slice(`${bucket}/`.length);
  return cleanPath;
}

function normalizePlayableUrl(url: unknown, bucket: 'videos' | 'images'): string {
  if (typeof url !== 'string') return '';
  const rawUrl = url.trim();
  if (!rawUrl) return '';
  if (PLAYABLE_URL_RE.test(rawUrl)) return rawUrl;

  try {
    const storagePath = stripStorageBucketPrefix(rawUrl, bucket);
    const { data: { publicUrl } } = getSupabaseClient().storage.from(bucket).getPublicUrl(storagePath);
    return publicUrl || '';
  } catch {
    return '';
  }
}

function inferMediaBucket(url: unknown): 'videos' | 'images' {
  return typeof url === 'string' && VIDEO_PATH_RE.test(url) ? 'videos' : 'images';
}

/** One presentation mapper for every public.videos caller. */
export function mapVideoRow(
  row: Record<string, unknown>,
  username = 'user',
  avatar = '',
): VideoWithMeta {
  const mediaUrlsRaw = row.media_urls as string[] | null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    username: username || 'user',
    userAvatar: avatar || '',
    videoUrl: normalizePlayableUrl(row.video_url, inferMediaBucket(row.video_url)),
    thumbnailUrl: normalizePlayableUrl(row.thumbnail_url, 'images'),
    mediaUrls: Array.isArray(mediaUrlsRaw) && mediaUrlsRaw.length > 0
      ? mediaUrlsRaw
        .map(url => normalizePlayableUrl(url, inferMediaBucket(url)))
        .filter(Boolean)
      : undefined,
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
