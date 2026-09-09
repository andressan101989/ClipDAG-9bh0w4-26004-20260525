import React, { createContext, useState, useCallback, useEffect, useContext, useRef, ReactNode } from 'react';
import { getSupabaseClient } from '@/template';
import { AuthContext } from './AuthContext';
import type { StoryGroup, StoryItem } from '@/components/feature/StoriesBar';

interface StoriesContextType {
  storyGroups: StoryGroup[];
  isLoadingStories: boolean;
  addStory: (mediaAssetId: string) => Promise<string | undefined>;
  markStoryViewed: (storyId: string) => Promise<void>;
  getStoryViewers: (
    storyId: string,
    cursor?: StoryViewerCursor,
    limit?: number,
  ) => Promise<StoryViewersPage>;
  refreshStories: () => Promise<void>;
  viewedStoryIds: Set<string>;
}

export const StoriesContext = createContext<StoriesContextType | undefined>(undefined);

export interface StoryViewerCursor {
  viewedAt: string;
  viewerId: string;
}

export interface StoryViewerRecord {
  viewerId: string;
  username: string;
  avatarUrl: string | null;
  viewedAt: string;
}

export interface StoryViewersPage {
  viewers: StoryViewerRecord[];
  totalCount: number;
  nextCursor: StoryViewerCursor | null;
}

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
  const viewedStoryIdsRef = useRef<Set<string>>(new Set());
  const viewFlightsRef = useRef<Map<string, Promise<void>>>(new Map());
  const storySessionRef = useRef<string | undefined>(user?.id);
  storySessionRef.current = user?.id;

  const loadStories = useCallback(async () => {
    if (!user) return;
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) { setIsLoadingStories(false); return; }
    setIsLoadingStories(true);
    try {
      // Visibility is enforced by the stories RLS authority (owner/follow plus
      // bidirectional block checks). Client filters are presentation only.
      const { data: storiesData, error } = await supabase
        .from('stories')
        .select(`
          id, user_id, media_url, media_type, created_at, expires_at,
          user_profiles!stories_user_id_fkey(id, username, avatar_url)
        `)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        console.log('Stories load error:', error.message);
        setIsLoadingStories(false);
        return;
      }

      if (!storiesData || storiesData.length === 0) {
        setStoryGroups([]);
        viewedStoryIdsRef.current = new Set();
        setViewedStoryIds(new Set());
        setIsLoadingStories(false);
        return;
      }

      const storyIds = storiesData.map(row => row.id);
      const { data: storyLinks, error: storyLinksError } = await supabase
        .from('media_asset_links')
        .select('entity_id, asset_id')
        .eq('entity_type', 'story')
        .eq('slot', 'media')
        .eq('position', 0)
        .in('entity_id', storyIds);
      if (storyLinksError) {
        console.warn('[StoriesContext] story media link discovery failed', {
          code: storyLinksError.code,
        });
      }
      const storyAssetIds = new Map<string, string>();
      for (const link of storyLinks || []) {
        if (typeof link.entity_id === 'string' && typeof link.asset_id === 'string') {
          storyAssetIds.set(link.entity_id, link.asset_id);
        }
      }

      // Load viewed story IDs
      const { data: viewedData } = await supabase
        .from('story_views')
        .select('story_id')
        .eq('viewer_id', user.id)
        .in('story_id', storyIds);

      const viewed = new Set<string>((viewedData || []).map((v: { story_id: string }) => v.story_id));
      viewedStoryIdsRef.current = viewed;
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
          mediaAssetId: storyAssetIds.get(row.id),
          mediaUrl: typeof row.media_url === 'string' ? row.media_url : null,
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
      viewedStoryIdsRef.current = new Set();
      viewFlightsRef.current.clear();
      setViewedStoryIds(new Set());
    }
  }, [user?.id]);

  const addStory = useCallback(async (mediaAssetId: string) => {
    if (!user) return undefined;
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return undefined;
    const { data, error } = await supabase.rpc('create_story_with_media', {
      p_asset_id: mediaAssetId,
    });
    if (error || typeof data !== 'string') {
      console.warn('[StoriesContext] story persistence failed', {
        stage: 'STORY_CREATE_RPC',
        code: error?.code ?? 'missing_story_id',
      });
      throw Object.assign(new Error('STORY_CREATE_FAILED'), {
        stage: 'STORY_CREATE_RPC',
        code: error?.code ?? 'missing_story_id',
      });
    }
    await loadStories();
    return data;
  }, [user, loadStories]);

  const markStoryViewed = useCallback(async (storyId: string) => {
    if (!user || viewedStoryIdsRef.current.has(storyId)) return;
    const actorId = user.id;
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) return;
    const existingFlight = viewFlightsRef.current.get(storyId);
    if (existingFlight) return existingFlight;

    const flight = (async () => {
      const { data, error } = await supabase.rpc('mark_story_viewed', {
        p_story_id: storyId,
      });
      if (error) {
        console.warn('[StoriesContext] Story view persistence failed', {
          code: error.code ?? 'unknown',
        });
        return;
      }

      const result = Array.isArray(data) ? data[0] : data;
      const status = result?.status;
      if (status !== 'recorded' && status !== 'already_recorded' && status !== 'owner') {
        console.warn('[StoriesContext] Story view persistence returned an invalid status');
        return;
      }
      if (storySessionRef.current !== actorId) return;

      const nextViewed = new Set(viewedStoryIdsRef.current);
      nextViewed.add(storyId);
      viewedStoryIdsRef.current = nextViewed;
      setViewedStoryIds(nextViewed);
      setStoryGroups(prev => prev.map(group => ({
        ...group,
        hasUnseen: group.stories.some(story => !nextViewed.has(story.id)),
      })));
    })().finally(() => {
      if (viewFlightsRef.current.get(storyId) === flight) {
        viewFlightsRef.current.delete(storyId);
      }
    });

    viewFlightsRef.current.set(storyId, flight);
    return flight;
  }, [user]);

  const getStoryViewers = useCallback(async (
    storyId: string,
    cursor?: StoryViewerCursor,
    limit = 50,
  ): Promise<StoryViewersPage> => {
    if (!user) throw new Error('STORY_VIEWERS_NOT_AUTHENTICATED');
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) throw new Error('STORY_VIEWERS_CLIENT_UNAVAILABLE');

    const safeLimit = Math.max(1, Math.min(limit, 100));
    const { data, error } = await supabase.rpc('get_story_viewers', {
      p_story_id: storyId,
      p_limit: safeLimit,
      p_before_viewed_at: cursor?.viewedAt ?? null,
      p_before_viewer_id: cursor?.viewerId ?? null,
    });
    if (error) {
      console.warn('[StoriesContext] Story viewers load failed', {
        code: error.code ?? 'unknown',
      });
      throw new Error('STORY_VIEWERS_LOAD_FAILED');
    }

    const rows = Array.isArray(data) ? data : [];
    const viewers: StoryViewerRecord[] = rows.flatMap((row: any) => {
      if (
        typeof row?.viewer_id !== 'string'
        || typeof row?.username !== 'string'
        || typeof row?.viewed_at !== 'string'
      ) return [];
      return [{
        viewerId: row.viewer_id,
        username: row.username,
        avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
        viewedAt: row.viewed_at,
      }];
    });
    const last = viewers[viewers.length - 1];
    return {
      viewers,
      totalCount: rows.length > 0 ? Number(rows[0].total_count) || 0 : 0,
      nextCursor: last ? { viewedAt: last.viewedAt, viewerId: last.viewerId } : null,
    };
  }, [user]);

  return (
    <StoriesContext.Provider value={{
      storyGroups,
      isLoadingStories,
      addStory,
      markStoryViewed,
      getStoryViewers,
      refreshStories: loadStories,
      viewedStoryIds,
    }}>
      {children}
    </StoriesContext.Provider>
  );
}
