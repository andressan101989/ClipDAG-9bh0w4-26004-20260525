/**
 * services/creatorService.ts
 *
 * Creator profile data: fetch profile, stats, content, plans, followers.
 */
import { getSupabaseClient } from '@/template';

export interface CreatorProfile {
  id: string;
  username: string;
  email: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  profession: string;
  website: string;
  location: string;
  followers_count: number;
  following_count: number;
  dag_balance?: number;
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
    .from('user_profiles')
    .select('*')
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
    .limit(limit);
  return data ?? [];
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
    .from('user_profiles')
    .select('id, username, display_name, avatar_url, bio, followers_count')
    .ilike('username', `%${query}%`)
    .order('followers_count', { ascending: false })
    .limit(limit);
  return (data as CreatorProfile[]) ?? [];
}

/** Fetch featured/boosted creators */
export async function fetchFeaturedCreators(limit = 12): Promise<CreatorProfile[]> {
  const { data } = await db()
    .from('user_profiles')
    .select('id, username, display_name, avatar_url, bio, followers_count, profession')
    .order('followers_count', { ascending: false })
    .limit(limit);
  return (data as CreatorProfile[]) ?? [];
}
