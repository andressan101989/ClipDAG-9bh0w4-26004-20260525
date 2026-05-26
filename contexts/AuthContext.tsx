/**
 * contexts/AuthContext.tsx — v10 (hooks-rules-compliant, no early returns before hooks)
 *
 * FIXES vs v9:
 *  - CRITICAL: Removed early return before hooks — was violating Rules of Hooks.
 *    supabase unavailability is now handled inside useEffect / callbacks,
 *    not by a JSX early-return that skipped all subsequent hooks.
 *  - Auth subscription cleanup: the subscription ref is captured outside
 *    setTimeout so React's cleanup fn always has a reference to unsubscribe.
 *  - toggleFollow: migrated to atomic RPC `toggle_follow` for race-free counters.
 *  - PresenceManager wired: heartbeat starts on login, stops on logout.
 */

import React, {
  createContext, useState, useCallback, useEffect, useRef, ReactNode,
} from 'react';
import { getSupabaseClient } from '@/template';
import { PresenceManager }   from '@/modules/realtime/PresenceManager';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AppUser {
  id:            string;
  email:         string;
  username:      string;
  displayName:   string;
  avatar:        string;
  bio:           string;
  profession:    string;
  website:       string;
  location:      string;
  followers:     number;
  following:     number;
  dagBalance:    number;
  walletAddress: string | null;
  totalLikes:    number;
}

interface AuthContextType {
  user:             AppUser | null;
  isLoading:        boolean;
  isAuthenticated:  boolean;
  followedUsers:    Set<string>;
  login:            (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register:         (email: string, password: string, username: string) => Promise<{ success: boolean; error?: string }>;
  logout:           () => Promise<void>;
  updateProfile:    (updates: Partial<AppUser>) => Promise<void>;
  updateDAGBalance: (newBalance: number) => void;
  connectWallet:    (address: string) => Promise<void>;
  toggleFollow:     (userId: string) => Promise<void>;
  isFollowing:      (userId: string) => boolean;
  refreshProfile:   () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateFallbackAvatar(username: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username || 'user')}`;
}

function mapProfile(data: Record<string, any>, fallbackEmail: string): AppUser {
  const username = data.username || fallbackEmail.split('@')[0];
  return {
    id:            data.id,
    email:         data.email || fallbackEmail,
    username,
    displayName:   data.display_name || username,
    avatar:        data.avatar_url   || generateFallbackAvatar(username),
    bio:           data.bio          || '',
    profession:    data.profession   || '',
    website:       data.website      || '',
    location:      data.location     || '',
    followers:     data.followers_count  || 0,
    following:     data.following_count  || 0,
    dagBalance:    Number(data.dag_balance || 0),
    walletAddress: data.wallet_address   || null,
    totalLikes:    0,
  };
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  console.log('[BOOT] AuthProvider render');

  // All hooks MUST be called unconditionally — no early returns before this block.
  const [user,          setUser]          = useState<AppUser | null>(null);
  const [isLoading,     setIsLoading]     = useState(true);
  const [followedUsers, setFollowedUsers] = useState<Set<string>>(new Set());

  // Supabase client — initialised once, stored in ref to avoid re-creating on re-renders.
  const supabaseRef = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  const supabaseOk  = useRef(true);

  if (!supabaseRef.current) {
    try {
      supabaseRef.current = getSupabaseClient();
    } catch (e) {
      console.error('[AuthProvider] getSupabaseClient failed:', e);
      supabaseOk.current = false;
    }
  }

  // ── loadProfile ─────────────────────────────────────────────────────────────

  const loadProfile = useCallback(async (userId: string, email: string): Promise<AppUser | null> => {
    const supabase = supabaseRef.current;
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) { console.log('[AuthProvider] profile load error:', error.message); return null; }

      if (!data) {
        // First login — create profile row
        const username = email.split('@')[0];
        const { data: newData, error: insertErr } = await supabase
          .from('user_profiles')
          .insert({ id: userId, email, username, dag_balance: 0 })
          .select()
          .single();

        if (insertErr) {
          console.log('[AuthProvider] profile create error:', insertErr.message);
          return {
            id: userId, email, username, displayName: username,
            avatar: generateFallbackAvatar(username),
            bio: '', profession: '', website: '', location: '',
            followers: 0, following: 0, dagBalance: 0,
            walletAddress: null, totalLikes: 0,
          };
        }
        return mapProfile(newData as any, email);
      }

      return mapProfile(data as any, email);
    } catch (e) {
      console.log('[AuthProvider] profile exception:', e);
      return null;
    }
  }, []);

  // ── loadFollows ─────────────────────────────────────────────────────────────

  const loadFollows = useCallback(async (userId: string) => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from('follows').select('following_id').eq('follower_id', userId);
      if (data) setFollowedUsers(new Set(data.map((f: any) => f.following_id)));
    } catch { /* non-critical */ }
  }, []);

  // ── refreshProfile ──────────────────────────────────────────────────────────

  const refreshProfile = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const profile = await loadProfile(authUser.id, authUser.email || '');
        if (profile) setUser(profile);
      }
    } catch { /* non-critical */ }
  }, [loadProfile]);

  // ── Auth state listener ─────────────────────────────────────────────────────
  // RULE COMPLIANCE: useEffect is always called (no conditional before it).
  // The subscription object is captured in a ref so the cleanup function
  // returned from useEffect always has access to it — even if the setTimeout
  // fires after the component unmounts.

  useEffect(() => {
    console.log('[BOOT] AuthProvider useEffect — mounting');

    if (!supabaseOk.current || !supabaseRef.current) {
      // Backend unavailable — unblock loading immediately
      setIsLoading(false);
      return;
    }

    const supabase = supabaseRef.current;
    let subscriptionRef: { unsubscribe: () => void } | null = null;

    // Safety timeout: force-unblock after 5s if Supabase never responds
    const safetyTimer = setTimeout(() => {
      console.log('[BOOT] AuthProvider safety timeout — forcing isLoading=false');
      setIsLoading(false);
    }, 5_000);

    // Defer listener registration by one tick so it never blocks iOS route
    // registration during Expo Router startup.
    const initTimer = setTimeout(() => {
      try {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, session) => {
            clearTimeout(safetyTimer);
            console.log('[BOOT] AuthProvider auth event:', event);
            try {
              if (session?.user) {
                const profile = await loadProfile(session.user.id, session.user.email || '');
                setUser(profile);
                if (profile) {
                  await loadFollows(session.user.id);
                  PresenceManager.startHeartbeat(session.user.id, 'online');
                }
              } else {
                setUser(null);
                setFollowedUsers(new Set());
                PresenceManager.stopHeartbeat();
              }
            } catch (e) {
              console.error('[AuthProvider] auth state handler error:', e);
              setUser(null);
            }
            setIsLoading(false);
          },
        );
        // Store subscription in outer-scope ref so cleanup can reach it
        subscriptionRef = subscription;
      } catch (e) {
        console.error('[AuthProvider] onAuthStateChange registration failed:', e);
        clearTimeout(safetyTimer);
        setIsLoading(false);
      }
    }, 0);

    return () => {
      clearTimeout(safetyTimer);
      clearTimeout(initTimer);
      // Guaranteed cleanup — subscriptionRef is set by the inner callback
      subscriptionRef?.unsubscribe();
    };
  }, [loadProfile, loadFollows]);

  // ── login / register / logout ───────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    const supabase = supabaseRef.current;
    if (!supabase) return { success: false, error: 'Backend unavailable' };
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Error al iniciar sesion' };
    }
  }, []);

  const register = useCallback(async (email: string, password: string, username: string) => {
    const supabase = supabaseRef.current;
    if (!supabase) return { success: false, error: 'Backend unavailable' };
    if (!email || !password || !username)
      return { success: false, error: 'Todos los campos son requeridos' };
    if (password.length < 6)
      return { success: false, error: 'La contrasena debe tener al menos 6 caracteres' };
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { username } },
      });
      if (error) return { success: false, error: error.message };
      if (data.user) {
        await supabase.from('user_profiles')
          .update({ username, dag_balance: 0 }).eq('id', data.user.id);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Error al registrarse' };
    }
  }, []);

  const logout = useCallback(async () => {
    const supabase = supabaseRef.current;
    PresenceManager.stopHeartbeat();
    try { await supabase?.auth.signOut(); } catch { /* ignore */ }
    setUser(null);
    setFollowedUsers(new Set());
  }, []);

  // ── updateProfile / updateDAGBalance / connectWallet ───────────────────────

  const updateProfile = useCallback(async (updates: Partial<AppUser>) => {
    const supabase = supabaseRef.current;
    if (!user || !supabase) return;
    try {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.displayName !== undefined) dbUpdates.display_name = updates.displayName;
      if (updates.username    !== undefined) dbUpdates.username     = updates.username;
      if (updates.bio         !== undefined) dbUpdates.bio          = updates.bio;
      if (updates.avatar      !== undefined) dbUpdates.avatar_url   = updates.avatar;
      if (updates.profession  !== undefined) dbUpdates.profession   = updates.profession;
      if (updates.website     !== undefined) dbUpdates.website      = updates.website;
      if (updates.location    !== undefined) dbUpdates.location     = updates.location;
      if (Object.keys(dbUpdates).length > 0) {
        await supabase.from('user_profiles').update(dbUpdates).eq('id', user.id);
      }
      setUser(prev => prev ? { ...prev, ...updates } : null);
    } catch { /* non-critical */ }
  }, [user]);

  const updateDAGBalance = useCallback((newBalance: number) => {
    setUser(prev => prev ? { ...prev, dagBalance: Math.max(0, newBalance) } : null);
  }, []);

  const connectWallet = useCallback(async (address: string) => {
    const supabase = supabaseRef.current;
    if (!user || !supabase) return;
    try {
      await supabase.from('user_profiles').update({ wallet_address: address }).eq('id', user.id);
      setUser(prev => prev ? { ...prev, walletAddress: address } : null);
    } catch { /* non-critical */ }
  }, [user]);

  // ── toggleFollow — atomic RPC to avoid race conditions ────────────────────
  // Uses a Postgres function that does a single transactional
  // INSERT OR DELETE on `follows` + increments/decrements both counters.

  const toggleFollow = useCallback(async (targetUserId: string) => {
    const supabase = supabaseRef.current;
    if (!user || !supabase || targetUserId === user.id) return;

    const isFollowingNow = followedUsers.has(targetUserId);

    // Optimistic UI update
    setFollowedUsers(prev => {
      const next = new Set(prev);
      isFollowingNow ? next.delete(targetUserId) : next.add(targetUserId);
      return next;
    });
    setUser(u => u
      ? { ...u, following: Math.max(0, u.following + (isFollowingNow ? -1 : 1)) }
      : u
    );

    try {
      if (isFollowingNow) {
        // Unfollow: delete row + decrement both counters atomically
        await supabase.rpc('unfollow_user', {
          p_follower_id: user.id,
          p_target_id:   targetUserId,
        }).throwOnError();
      } else {
        // Follow: insert row + increment both counters atomically
        await supabase.rpc('follow_user', {
          p_follower_id: user.id,
          p_target_id:   targetUserId,
        }).throwOnError();
      }
      // Re-sync follows list
      await loadFollows(user.id);
    } catch (e: any) {
      console.warn('[AuthProvider] toggleFollow RPC failed, reverting:', e?.message);
      // Revert optimistic update on failure
      setFollowedUsers(prev => {
        const next = new Set(prev);
        isFollowingNow ? next.add(targetUserId) : next.delete(targetUserId);
        return next;
      });
      setUser(u => u
        ? { ...u, following: Math.max(0, u.following + (isFollowingNow ? 1 : -1)) }
        : u
      );

      // Fallback: manual separate queries if RPC doesn't exist yet
      try {
        if (isFollowingNow) {
          await supabase.from('follows').delete()
            .eq('follower_id', user.id).eq('following_id', targetUserId);
          await supabase.from('user_profiles')
            .update({ following_count: Math.max(0, user.following - 1) }).eq('id', user.id);
          const { data: tp } = await supabase.from('user_profiles')
            .select('followers_count').eq('id', targetUserId).single();
          if (tp) await supabase.from('user_profiles')
            .update({ followers_count: Math.max(0, (tp.followers_count || 0) - 1) })
            .eq('id', targetUserId);
        } else {
          await supabase.from('follows')
            .insert({ follower_id: user.id, following_id: targetUserId })
            .select().single().catch(() => null);
          await supabase.from('user_profiles')
            .update({ following_count: user.following + 1 }).eq('id', user.id);
          const { data: tp } = await supabase.from('user_profiles')
            .select('followers_count').eq('id', targetUserId).single();
          if (tp) await supabase.from('user_profiles')
            .update({ followers_count: (tp.followers_count || 0) + 1 })
            .eq('id', targetUserId);
        }
        // Re-apply correct optimistic state after fallback succeeds
        setFollowedUsers(prev => {
          const next = new Set(prev);
          isFollowingNow ? next.delete(targetUserId) : next.add(targetUserId);
          return next;
        });
        setUser(u => u
          ? { ...u, following: Math.max(0, u.following + (isFollowingNow ? -1 : 1)) }
          : u
        );
        await loadFollows(user.id);
      } catch { /* fallback also failed — UI already reverted */ }
    }
  }, [user, followedUsers, loadFollows]);

  const isFollowing = useCallback((userId: string) => followedUsers.has(userId), [followedUsers]);

  // ── Context value ──────────────────────────────────────────────────────────

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated:  !!user,
    followedUsers,
    login,
    register,
    logout,
    updateProfile,
    updateDAGBalance,
    connectWallet,
    toggleFollow,
    isFollowing,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
