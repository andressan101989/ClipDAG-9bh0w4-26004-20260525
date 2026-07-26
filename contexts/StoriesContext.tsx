import React, { createContext, useState, useCallback, useEffect, useContext, useRef, ReactNode } from 'react';
import { getSupabaseClient } from '@/template';
import { AuthContext } from './AuthContext';
import type { StoryGroup, StoryItem } from '@/components/feature/StoriesBar';

interface StoriesContextType {
  storyGroups: StoryGroup[];
  isLoadingStories: boolean;
  addStory: (mediaUrl: string, mediaType: 'photo' | 'video', allowOptimistic?: boolean, mediaAssetId?: string) => Promise<string | undefined>;
  markStoryViewed: (storyId: string) => Promise<void>;
  refreshStories: () => Promise<void>;
  viewedStoryIds: Set<string>;
}

export const StoriesContext = createContext<StoriesContextType | undefined>(undefined);

type StoryProfile = {
  id: string;
  username: string;
  avatar_url: string | null;
};

function firstStoryProfile(value: unknown): StoryProfile | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== 'object') return null;
  const profile = candidate as Partial<StoryProfile>;
  if (typeof profile.id !== 'string' || typeof profile.username !== 'string') return null;
  return {
    id: profile.id,
    username: profile.username,
    avatar_url: typeof profile.avatar_url === 'string' ? profile.avatar_url : null,
  };
}

// Generate a fallback avatar based on username
function generateAvatarUrl(username: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
}

export function StoriesProvider({ children }: { children: ReactNode }) {
  const supabaseRef = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  const supabaseOk  = useRef(true);
  if (!supabaseRef.current) {
    try { supabaseRef.current = getSupabaseClient(); }
    catch (e) { console.warn('[StoriesContext] getSupabaseClient failed:', e); supabaseOk.current = false; }
  }
  const authContext = useContext(AuthContext);
  const user = authContext?.user;

  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [isLoadingStories, setIsLoadingStories] = useState(false);
  const [viewedStoryIds, setViewedStoryIds] = useState<Set<string>>(new Set());

  const loadStories = useCallback(async () => {
    if (!user) return;
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) { setIsLoadingStories(false); return; }
    setIsLoadingStories(true);
    try {
      // Load follows
      const { data: followData } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);

      const followedIds = (followData || []).map((f: { following_id: string }) => f.following_id);
      // Always include own stories
      const allIds = [user.id, ...followedIds];

      const { data: storiesData, error } = await supabase
        .from('stories')
        .select(`
          id, user_id, media_url, media_type, created_at, expires_at,
          user_profiles!stories_user_id_fkey(id, username, avatar_url)
        `)
        .in('user_id', allIds)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        console.log('Stories load error:', error.message);
        setIsLoadingStories(false);
        return;
      }

      if (!storiesData || storiesData.length === 0) {
        setStoryGroups([]);
        setIsLoadingStories(false);
        return;
      }

      // Load viewed story IDs
      const { data: viewedData } = await supabase
        .from('story_views')
        .select('story_id')
        .eq('viewer_id', user.id);

      const viewed = new Set<string>((viewedData || []).map((v: { story_id: string }) => v.story_id));
      setViewedStoryIds(viewed);

      // Group by user
      const groupMap = new Map<string, StoryGroup>();
      for (const row of storiesData) {
        const profile = firstStoryProfile(row.user_profiles);
        const username = profile?.username || 'user';
        const avatar = profile?.avatar_url || generateAvatarUrl(username);

        const story: StoryItem = {
          id: row.id,
          userId: row.user_id,
          mediaUrl: row.media_url,
          mediaType: row.media_type as 'photo' | 'video',
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        };

        if (groupMap.has(row.user_id)) {
          const group = groupMap.get(row.user_id)!;
          group.stories.push(story);
          if (!viewed.has(row.id)) group.hasUnseen = true;
        } else {
          groupMap.set(row.user_id, {
            userId: row.user_id,
            username,
            avatar,
            hasUnseen: !viewed.has(row.id),
            stories: [story],
          });
        }
      }

      setStoryGroups(Array.from(groupMap.values()));
    } catch (e) {
      console.log('Stories context error:', e);
    }
    setIsLoadingStories(false);
  }, [user]);

  useEffect(() => {
    if (user?.id) {
      loadStories();
    } else {
      setStoryGroups([]);
    }
  }, [user?.id]);

  const addStory = useCallback(async (
    mediaUrl: string,
    mediaType: 'photo' | 'video',
    allowOptimistic = true,
    mediaAssetId?: string,
  ) => {
    if (!user) return undefined;
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return undefined;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    try {
      const result = mediaType === 'photo' && mediaAssetId
        ? await supabase.rpc('create_photo_story_with_media', {
          p_media_urls: [mediaUrl],
          p_asset_ids: [mediaAssetId],
        })
        : await supabase.from('stories').insert({
          user_id: user.id,
          media_url: mediaUrl,
          media_type: mediaType,
          expires_at: expiresAt,
        }).select('id').single();
      const data = mediaType === 'photo' && mediaAssetId
        ? { id: result.data as string | null }
        : result.data as { id?: string } | null;
      const error = result.error;

      if (!error && data?.id) {
        await loadStories();
        return data.id as string;
      } else {
        console.warn('[StoriesContext] story persistence failed', {
          stage: 'STORY_INSERT',
          code: error?.code ?? 'missing_story_id',
        });
        if (!allowOptimistic) {
          throw Object.assign(new Error('STORY_INSERT_FAILED'), {
            stage: 'STORY_INSERT',
            code: error?.code ?? 'missing_story_id',
          });
        }
        // Optimistic local add if DB fails
        const localStory: StoryItem = {
          id: `local_${Date.now()}`,
          userId: user.id,
          mediaUrl,
          mediaType,
          createdAt: new Date().toISOString(),
          expiresAt,
        };
        setStoryGroups(prev => {
          const existing = prev.find(g => g.userId === user.id);
          if (existing) {
            return prev.map(g => g.userId === user.id
              ? { ...g, stories: [localStory, ...g.stories], hasUnseen: false }
              : g
            );
          }
          return [{
            userId: user.id,
            username: user.username,
            avatar: user.avatar || generateAvatarUrl(user.username),
            hasUnseen: false,
            stories: [localStory],
          }, ...prev];
        });
      }
    } catch (error) {
      if (!allowOptimistic) throw error;
    }
    return undefined;
  }, [user, loadStories]);

  const markStoryViewed = useCallback(async (storyId: string) => {
    if (!user || viewedStoryIds.has(storyId)) return;
    setViewedStoryIds(prev => new Set([...prev, storyId]));
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return;
    try {
      await supabase.from('story_views').insert({
        story_id: storyId,
        viewer_id: user.id,
      });
    } catch (_) {}

    // Update hasUnseen in groups
    setStoryGroups(prev => prev.map(g => {
      const newViewed = new Set([...viewedStoryIds, storyId]);
      return {
        ...g,
        hasUnseen: g.stories.some(s => !newViewed.has(s.id)),
      };
    }));
  }, [user, viewedStoryIds]);

  return (
    <StoriesContext.Provider value={{
      storyGroups,
      isLoadingStories,
      addStory,
      markStoryViewed,
      refreshStories: loadStories,
      viewedStoryIds,
    }}>
      {children}
    </StoriesContext.Provider>
  );
}
