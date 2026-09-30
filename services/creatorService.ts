/**
 * services/creatorService.ts
 *
 * Creator profile data: fetch profile, stats, content, plans, followers.
 */
import { getSupabaseClient } from '@/template';
import type { VideoWithMeta } from '@/contexts/FeedContext';
import { mapVideoRow } from '@/services/videoPresentation';

export interface CreatorProfile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  profession: string;
  website: string;
  location: string;
  followers_count: number;
  following_count: number;
  is_private: boolean;
}

export interface CreatorStats {
  total_videos: number;
  total_likes: number;
  total_views: number;
  total_earnings_bdag: number;
  active_subscribers: number;
  content_sales: number;
}

const db = () => getSupabaseClient();

/** Fetch full creator profile by user ID */
export async function fetchCreatorProfile(userId: string): Promise<CreatorProfile | null> {
  const { data } = await db()
    .from('public_user_profiles')
    .select('id, username, display_name, bio, avatar_url, profession, website, location, followers_count, following_count, is_private')
    .eq('id', userId)
    .single();
  return (data as CreatorProfile) ?? null;
}

/** Fetch creator's published videos */
export async function fetchCreatorVideos(userId: string, limit = 30) {
  const { data } = await db()
    .from('videos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  return data ?? [];
}

function profileFromVideoRow(row: Record<string, unknown>): { username: string; avatarUrl: string } {
  const relation = row.user_profiles;
  const profile = (Array.isArray(relation) ? relation[0] : relation) as Record<string, unknown> | null;
  return {
    username: typeof profile?.username === 'string' ? profile.username : 'user',
    avatarUrl: typeof profile?.avatar_url === 'string' ? profile.avatar_url : '',
  };
}

function presentVideoRows(rows: unknown[] | null): VideoWithMeta[] {
  return (rows ?? []).map(raw => {
    const row = raw as Record<string, unknown>;
    const profile = profileFromVideoRow(row);
    return mapVideoRow(row, profile.username, profile.avatarUrl);
  });
}

/** Canonical creator/profile content query. public.videos RLS owns eligibility. */
export async function fetchCreatorVideoFeed(userId: string, limit = 100): Promise<VideoWithMeta[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const { data, error } = await db()
    .from('videos')
    .select('*, user_profiles!videos_user_id_fkey(username, avatar_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return presentVideoRows(data);
}

/** Saved content comes from its own server authority, never the Feed page window. */
export async function fetchSavedVideoFeed(userId: string, limit = 100): Promise<VideoWithMeta[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const { data: saves, error: savesError } = await db()
    .from('video_saves')
    .select('id, video_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(safeLimit);
  if (savesError) throw savesError;

  const orderedIds = (saves ?? []).map(save => save.video_id as string);
  if (orderedIds.length === 0) return [];
  const { data: videos, error: videosError } = await db()
    .from('videos')
    .select('*, user_profiles!videos_user_id_fkey(username, avatar_url)')
    .in('id', orderedIds);
  if (videosError) throw videosError;

  const presentedById = new Map(presentVideoRows(videos).map(video => [video.id, video]));
  return orderedIds.flatMap(id => {
    const video = presentedById.get(id);
    return video ? [video] : [];
  });
}

/** Fetch creator's exclusive content */
export async function fetchCreatorExclusiveContent(userId: string) {
  const { data } = await db()
    .from('exclusive_content')
    .select('*')
    .eq('creator_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  return data ?? [];
}

/** Fetch creator's active subscription plans */
export async function fetchCreatorSubscriptionPlans(userId: string) {
  const { data } = await db()
    .from('subscription_plans')
    .select('*')
    .eq('creator_id', userId)
    .eq('status', 'active')
    .order('price_bdag', { ascending: true });
  return data ?? [];
}

/** Check if a user is following a creator */
export async function checkIsFollowing(followerId: string, followingId: string): Promise<boolean> {
  const { data } = await db()
    .from('follows')
    .select('id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .single();
  return !!data;
}

/** Follow a creator */
export async function followCreator(followerId: string, followingId: string): Promise<boolean> {
  const { error } = await db()
    .from('follows')
    .insert({ follower_id: followerId, following_id: followingId });
  return !error;
}

/** Unfollow a creator */
export async function unfollowCreator(followerId: string, followingId: string): Promise<boolean> {
  const { error } = await db()
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);
  return !error;
}

/** Fetch creator economy stats (earnings, subscribers, etc.) */
export async function fetchCreatorStats(userId: string): Promise<CreatorStats> {
  const [videos, contentSales, subs] = await Promise.all([
    db().from('videos').select('likes_count, views_count').eq('user_id', userId),
    db().from('content_purchases').select('creator_earnings').eq('creator_id', userId).eq('status', 'completed'),
    db().from('creator_subscriptions').select('id').eq('creator_id', userId).eq('status', 'active'),
  ]);

  const totalLikes   = (videos.data ?? []).reduce((s: number, v: any) => s + Number(v.likes_count ?? 0), 0);
  const totalViews   = (videos.data ?? []).reduce((s: number, v: any) => s + Number(v.views_count ?? 0), 0);
  const totalEarned  = (contentSales.data ?? []).reduce((s: number, r: any) => s + Number(r.creator_earnings ?? 0), 0);

  return {
    total_videos:        (videos.data ?? []).length,
    total_likes:         totalLikes,
    total_views:         totalViews,
    total_earnings_bdag: totalEarned,
    active_subscribers:  (subs.data ?? []).length,
    content_sales:       (contentSales.data ?? []).length,
  };
}

/** Search creator profiles by username */
export async function searchCreators(query: string, limit = 20): Promise<CreatorProfile[]> {
  const { data } = await db()
    .from('public_user_profiles')
    .select('id, username, display_name, avatar_url, bio, followers_count')
    .ilike('username', `%${query}%`)
    .order('followers_count', { ascending: false })
    .limit(limit);
  return (data as CreatorProfile[]) ?? [];
}

/** Fetch featured/boosted creators */
export async function fetchFeaturedCreators(limit = 12): Promise<CreatorProfile[]> {
  const { data } = await db()
    .from('public_user_profiles')
    .select('id, username, display_name, avatar_url, bio, followers_count, profession')
    .order('followers_count', { ascending: false })
    .limit(limit);
  return (data as CreatorProfile[]) ?? [];
}
