import React, { createContext, useState, useCallback, useEffect, useContext, useRef, ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getSupabaseClient } from '@/template';
import { AuthContext } from './AuthContext';
import type { StoryGroup, StoryItem } from '@/components/feature/StoriesBar';
import { isStoryReactionKey, type StoryReactionKey } from '@/components/feature/storyReactions';
import { sendStoryReply } from '@/services/chatService';

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
  deleteStory: (storyId: string) => Promise<StoryDeleteResult>;
  setStoryReaction: (storyId: string, reaction: StoryReactionKey | null) => Promise<void>;
  getStoryReactions: (
    storyId: string,
    cursor?: StoryReactionCursor,
    limit?: number,
  ) => Promise<StoryReactionsPage>;
  replyToStory: (storyId: string, text: string) => Promise<void>;
  refreshStories: () => Promise<void>;
  getStoryGroupForUser: (userId: string | undefined) => StoryGroup | null;
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

export type StoryMediaCleanupStatus = 'scheduled' | 'deleted' | 'asset_in_use' | 'none';

export interface StoryDeleteResult {
  deletedStoryId: string;
  mediaAssetId: string | null;
  mediaCleanupStatus: StoryMediaCleanupStatus;
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

export interface StoryReactionCursor {
  reactedAt: string;
  reactorId: string;
}

export interface StoryReactionRecord {
  reactorId: string;
  username: string;
  avatarUrl: string | null;
  reaction: StoryReactionKey;
  reactedAt: string;
}

export interface StoryReactionsPage {
  reactions: StoryReactionRecord[];
  totalCount: number;
  nextCursor: StoryReactionCursor | null;
}

function pruneExpiredStoryGroups(
  groups: StoryGroup[],
  viewed: Set<string>,
  nowMs: number,
): StoryGroup[] {
  return groups.flatMap(group => {
    const stories = group.stories.filter(story => new Date(story.expiresAt).getTime() > nowMs);
    if (stories.length === 0) return [];
    return [{
      ...group,
      stories,
      hasUnseen: stories.some(story => !viewed.has(story.id)),
    }];
  });
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
  const storyGroupsRef = useRef<StoryGroup[]>([]);
  storyGroupsRef.current = storyGroups;
  const [isLoadingStories, setIsLoadingStories] = useState(false);
  const [viewedStoryIds, setViewedStoryIds] = useState<Set<string>>(new Set());
  const viewedStoryIdsRef = useRef<Set<string>>(new Set());
  const viewFlightsRef = useRef<Map<string, Promise<void>>>(new Map());
  const deleteFlightsRef = useRef<Map<string, Promise<StoryDeleteResult>>>(new Map());
  const reactionFlightsRef = useRef<Map<string, Promise<void>>>(new Map());
  const refreshFlightRef = useRef<Promise<void> | null>(null);
  const refreshPendingRef = useRef(false);
  const storySessionRef = useRef<string | undefined>(user?.id);
  storySessionRef.current = user?.id;

  const fetchCanonicalStories = useCallback(async (actorId: string) => {
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
        return;
      }

      if (!storiesData || storiesData.length === 0) {
        if (storySessionRef.current !== actorId) return;
        setStoryGroups([]);
        viewedStoryIdsRef.current = new Set();
        setViewedStoryIds(new Set());
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
        .eq('viewer_id', actorId)
        .in('story_id', storyIds);

      const activeStoryIds = new Set(storyIds);
      const viewed = new Set<string>((viewedData || []).map((v: { story_id: string }) => v.story_id));
      const { data: reactionData, error: reactionError } = await supabase
        .from('story_reactions')
        .select('story_id, reaction')
        .eq('reactor_id', actorId)
        .in('story_id', storyIds);
      if (reactionError) {
        console.warn('[StoriesContext] Story reaction state load failed', {
          code: reactionError.code ?? 'unknown',
        });
      }
      const ownReactionByStory = new Map<string, StoryReactionKey>();
      for (const row of reactionData || []) {
        if (typeof row.story_id === 'string' && isStoryReactionKey(row.reaction)) {
          ownReactionByStory.set(row.story_id, row.reaction);
        }
      }
      // Preserve RPC-confirmed local views (including owner NOOP semantics)
      // across reconciliation while the Story remains active in this session.
      for (const storyId of viewedStoryIdsRef.current) {
        if (activeStoryIds.has(storyId)) viewed.add(storyId);
      }
      if (storySessionRef.current !== actorId) return;
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
          viewerReaction: ownReactionByStory.get(row.id) ?? null,
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
    } finally {
      if (storySessionRef.current === actorId) setIsLoadingStories(false);
    }
  }, []);

  // All invalidation sources converge here. Events that arrive during a load
  // set one pending bit, so bursts result in at most one follow-up query.
  const loadStories = useCallback(async () => {
    if (!storySessionRef.current) return;
    if (refreshFlightRef.current) {
      refreshPendingRef.current = true;
      return refreshFlightRef.current;
    }

    const flight = (async () => {
      do {
        refreshPendingRef.current = false;
        const actorId = storySessionRef.current;
        if (!actorId) return;
        await fetchCanonicalStories(actorId);
      } while (refreshPendingRef.current && storySessionRef.current);
    })().finally(() => {
      if (refreshFlightRef.current === flight) refreshFlightRef.current = null;
    });
    refreshFlightRef.current = flight;
    return flight;
  }, [fetchCanonicalStories]);

  useEffect(() => {
    setStoryGroups([]);
    viewedStoryIdsRef.current = new Set();
    viewFlightsRef.current.clear();
    deleteFlightsRef.current.clear();
    reactionFlightsRef.current.clear();
    setViewedStoryIds(new Set());
    if (user?.id) {
      refreshPendingRef.current = true;
      void loadStories();
    } else {
      refreshPendingRef.current = false;
      setIsLoadingStories(false);
    }
  }, [user?.id, loadStories]);

  // One provider-owned channel per authenticated session. Its payload is never
  // merged into state; it only triggers the RLS-authorized canonical query.
  useEffect(() => {
    const actorId = user?.id;
    const supabase = supabaseRef.current;
    if (!actorId || !supabase || !supabaseOk.current) return;

    let active = true;
    const channel = supabase
      .channel(`stories-v2:${actorId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'stories',
      }, () => {
        if (active && storySessionRef.current === actorId) void loadStories();
      })
      .subscribe(status => {
        if (active && status === 'SUBSCRIBED' && storySessionRef.current === actorId) {
          void loadStories();
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id, loadStories]);

  useEffect(() => {
    if (!user?.id) return;
    let previousState: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', nextState => {
      if (previousState !== 'active' && nextState === 'active') void loadStories();
      previousState = nextState;
    });
    return () => subscription.remove();
  }, [user?.id, loadStories]);

  // Reconcile at the nearest expiry instead of polling. Local pruning happens
  // first, so an expired Story cannot linger while the network is unavailable.
  useEffect(() => {
    if (!user?.id || storyGroups.length === 0) return;
    const now = Date.now();
    const nextExpiry = Math.min(...storyGroups.flatMap(group =>
      group.stories.map(story => new Date(story.expiresAt).getTime()),
    ));
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => {
      setStoryGroups(previous => pruneExpiredStoryGroups(previous, viewedStoryIdsRef.current, Date.now()));
      void loadStories();
    }, Math.max(0, nextExpiry - now + 25));
    return () => clearTimeout(timer);
  }, [user?.id, storyGroups, loadStories]);

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

  const deleteStory = useCallback(async (storyId: string): Promise<StoryDeleteResult> => {
    if (!user) throw new Error('STORY_DELETE_NOT_AUTHENTICATED');
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) throw new Error('STORY_DELETE_CLIENT_UNAVAILABLE');

    const existingFlight = deleteFlightsRef.current.get(storyId);
    if (existingFlight) return existingFlight;

    const actorId = user.id;
    const flight = (async () => {
      const { data, error } = await supabase.rpc('delete_story', {
        p_story_id: storyId,
      });
      if (error) {
        console.warn('[StoriesContext] Story deletion failed', {
          code: error.code ?? 'unknown',
        });
        throw new Error('STORY_DELETE_FAILED');
      }

      const row = Array.isArray(data) ? data[0] : data;
      const cleanupStatus = row?.media_cleanup_status;
      if (
        row?.deleted_story_id !== storyId
        || (row?.media_asset_id !== null && typeof row?.media_asset_id !== 'string')
        || !['scheduled', 'deleted', 'asset_in_use', 'none'].includes(cleanupStatus)
      ) {
        throw new Error('STORY_DELETE_INVALID_RESPONSE');
      }
      if (storySessionRef.current !== actorId) throw new Error('STORY_DELETE_SESSION_CHANGED');

      await loadStories();
      return {
        deletedStoryId: row.deleted_story_id,
        mediaAssetId: row.media_asset_id,
        mediaCleanupStatus: cleanupStatus as StoryMediaCleanupStatus,
      };
    })().finally(() => {
      if (deleteFlightsRef.current.get(storyId) === flight) {
        deleteFlightsRef.current.delete(storyId);
      }
    });

    deleteFlightsRef.current.set(storyId, flight);
    return flight;
  }, [user, loadStories]);

  const setStoryReaction = useCallback(async (
    storyId: string,
    reaction: StoryReactionKey | null,
  ): Promise<void> => {
    if (!user) throw new Error('STORY_REACTION_NOT_AUTHENTICATED');
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) throw new Error('STORY_REACTION_CLIENT_UNAVAILABLE');
    const existingFlight = reactionFlightsRef.current.get(storyId);
    if (existingFlight) return existingFlight;

    const actorId = user.id;
    const previous = storyGroupsRef.current
      .flatMap(group => group.stories)
      .find(story => story.id === storyId)?.viewerReaction ?? null;
    const updateLocal = (next: StoryReactionKey | null) => {
      setStoryGroups(groups => groups.map(group => ({
        ...group,
        stories: group.stories.map(story => story.id === storyId
          ? { ...story, viewerReaction: next }
          : story),
      })));
    };
    updateLocal(reaction);

    const flight = (async () => {
      const { data, error } = await supabase.rpc('set_story_reaction', {
        p_story_id: storyId,
        p_reaction: reaction,
      });
      if (error) {
        if (storySessionRef.current === actorId) updateLocal(previous);
        console.warn('[StoriesContext] Story reaction persistence failed', {
          code: error.code ?? 'unknown',
        });
        throw new Error('STORY_REACTION_FAILED');
      }
      const row = Array.isArray(data) ? data[0] : data;
      const persisted = row?.reaction;
      if (
        !['set', 'removed', 'unchanged'].includes(row?.status)
        || (persisted !== null && !isStoryReactionKey(persisted))
      ) {
        if (storySessionRef.current === actorId) updateLocal(previous);
        throw new Error('STORY_REACTION_INVALID_RESPONSE');
      }
      if (storySessionRef.current === actorId) updateLocal(persisted ?? null);
    })().finally(() => {
      if (reactionFlightsRef.current.get(storyId) === flight) {
        reactionFlightsRef.current.delete(storyId);
      }
    });

    reactionFlightsRef.current.set(storyId, flight);
    return flight;
  }, [user]);

  const getStoryReactions = useCallback(async (
    storyId: string,
    cursor?: StoryReactionCursor,
    limit = 50,
  ): Promise<StoryReactionsPage> => {
    if (!user) throw new Error('STORY_REACTIONS_NOT_AUTHENTICATED');
    const supabase = supabaseRef.current;
    if (!supabase || !supabaseOk.current) throw new Error('STORY_REACTIONS_CLIENT_UNAVAILABLE');
    const { data, error } = await supabase.rpc('get_story_reactions', {
      p_story_id: storyId,
      p_limit: Math.max(1, Math.min(limit, 100)),
      p_before_updated_at: cursor?.reactedAt ?? null,
      p_before_reactor_id: cursor?.reactorId ?? null,
    });
    if (error) {
      console.warn('[StoriesContext] Story reactions load failed', {
        code: error.code ?? 'unknown',
      });
      throw new Error('STORY_REACTIONS_LOAD_FAILED');
    }
    const rows = Array.isArray(data) ? data : [];
    const reactions: StoryReactionRecord[] = rows.flatMap((row: any) => {
      if (
        typeof row?.reactor_id !== 'string'
        || typeof row?.username !== 'string'
        || typeof row?.reacted_at !== 'string'
        || !isStoryReactionKey(row?.reaction)
      ) return [];
      return [{
        reactorId: row.reactor_id,
        username: row.username,
        avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
        reaction: row.reaction,
        reactedAt: row.reacted_at,
      }];
    });
    const last = reactions[reactions.length - 1];
    return {
      reactions,
      totalCount: rows.length > 0 ? Number(rows[0].total_count) || 0 : 0,
      nextCursor: last ? { reactedAt: last.reactedAt, reactorId: last.reactorId } : null,
    };
  }, [user]);

  const replyToStory = useCallback(async (storyId: string, text: string): Promise<void> => {
    if (!user) throw new Error('STORY_REPLY_NOT_AUTHENTICATED');
    const trimmed = text.trim();
    if (!trimmed) throw new Error('STORY_REPLY_EMPTY');
    try {
      await sendStoryReply(storyId, trimmed);
    } catch (error: any) {
      console.warn('[StoriesContext] Story reply failed', {
        code: typeof error?.code === 'string' ? error.code : 'request_failed',
      });
      throw new Error('STORY_REPLY_FAILED');
    }
  }, [user]);

  const getStoryGroupForUser = useCallback((userId: string | undefined) => {
    if (!userId) return null;
    return storyGroupsRef.current.find(group => group.userId === userId) ?? null;
  }, []);

  return (
    <StoriesContext.Provider value={{
      storyGroups,
      isLoadingStories,
      addStory,
      markStoryViewed,
      getStoryViewers,
      deleteStory,
      setStoryReaction,
      getStoryReactions,
      replyToStory,
      refreshStories: loadStories,
      getStoryGroupForUser,
      viewedStoryIds,
    }}>
      {children}
    </StoriesContext.Provider>
  );
}
