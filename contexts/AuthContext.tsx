/**
 * contexts/AuthContext.tsx — v9 (startup-safe, deferred init)
 *
 * Changes vs v8:
 *  - getSupabaseClient() wrapped in try/catch — backend init failure renders
 *    children with safe fallback instead of crashing the tree
 *  - onAuthStateChange deferred with setTimeout(0) so it never blocks
 *    Expo Router startup route registration on iOS
 *  - [BOOT] logs added for each lifecycle stage
 */
import React, { createContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { getSupabaseClient } from '@/template';

export interface AppUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  profession: string;
  website: string;
  location: string;
  followers: number;
  following: number;
  dagBalance: number;
  walletAddress: string | null;
  totalLikes: number;
}

interface AuthContextType {
  user: AppUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  followedUsers: Set<string>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, username: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateProfile: (updates: Partial<AppUser>) => Promise<void>;
  updateDAGBalance: (newBalance: number) => void;
  connectWallet: (address: string) => Promise<void>;
  toggleFollow: (userId: string) => Promise<void>;
  isFollowing: (userId: string) => boolean;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

function generateFallbackAvatar(username: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username || 'user')}`;
}

// Safe no-op fallback used when Supabase client fails to initialize
const SUPABASE_UNAVAILABLE_VALUE: AuthContextType = {
  user: null, isLoading: false, isAuthenticated: false,
  followedUsers: new Set(),
  login:           async () => ({ success: false, error: 'Backend unavailable' }),
  register:        async () => ({ success: false, error: 'Backend unavailable' }),
  logout:          async () => {},
  updateProfile:   async () => {},
  updateDAGBalance: () => {},
  connectWallet:   async () => {},
  toggleFollow:    async () => {},
  isFollowing:     () => false,
  refreshProfile:  async () => {},
};

export function AuthProvider({ children }: { children: ReactNode }) {
  console.log('[BOOT] AuthProvider render');

  // ── Lazy Supabase client ───────────────────────────────────────────────────
  // getSupabaseClient() is called here (not at module scope) so a failure
  // only crashes this component, not the entire module evaluation.
  const supabaseRef = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  if (!supabaseRef.current) {
    try {
      supabaseRef.current = getSupabaseClient();
    } catch (e) {
      console.error('[AuthProvider] getSupabaseClient failed:', e);
    }
  }

  const [user,         setUser]         = useState<AppUser | null>(null);
  const [isLoading,    setIsLoading]    = useState(true);
  const [followedUsers, setFollowedUsers] = useState<Set<string>>(new Set());

  // Render safe fallback if Supabase client is unavailable
  if (!supabaseRef.current) {
    return (
      <AuthContext.Provider value={SUPABASE_UNAVAILABLE_VALUE}>
        {children}
      </AuthContext.Provider>
    );
  }

  const supabase = supabaseRef.current;

  // ── loadProfile ───────────────────────────────────────────────────────────
  const loadProfile = useCallback(async (userId: string, email: string): Promise<AppUser | null> => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) { console.log('Profile load error:', error.message); return null; }

      if (!data) {
        const username = email.split('@')[0];
        const { data: newData, error: insertError } = await supabase
          .from('user_profiles')
          .insert({ id: userId, email, username, dag_balance: 0 })
          .select()
          .single();

        if (insertError) {
          console.log('Profile create error:', insertError.message);
          return {
            id: userId, email, username, displayName: username,
            avatar: generateFallbackAvatar(username),
            bio: '', profession: '', website: '', location: '',
            followers: 0, following: 0, dagBalance: 0, walletAddress: null, totalLikes: 0,
          };
        }

        const d = newData;
        return {
          id: d.id, email: d.email || email,
          username: d.username || username,
          displayName: d.display_name || d.username || username,
          avatar: d.avatar_url || generateFallbackAvatar(d.username || username),
          bio: d.bio || '', profession: d.profession || '',
          website: d.website || '', location: d.location || '',
          followers: d.followers_count || 0, following: d.following_count || 0,
          dagBalance: Number(d.dag_balance || 0),
          walletAddress: d.wallet_address || null, totalLikes: 0,
        };
      }

      return {
        id: data.id, email: data.email || email,
        username: data.username || email.split('@')[0],
        displayName: data.display_name || data.username || email.split('@')[0],
        avatar: data.avatar_url || generateFallbackAvatar(data.username || email.split('@')[0]),
        bio: data.bio || '', profession: data.profession || '',
        website: data.website || '', location: data.location || '',
        followers: data.followers_count || 0, following: data.following_count || 0,
        dagBalance: Number(data.dag_balance || 0),
        walletAddress: data.wallet_address || null, totalLikes: 0,
      };
    } catch (e) {
      console.log('Profile load exception:', e);
      return null;
    }
  }, [supabase]);

  // ── loadFollows ───────────────────────────────────────────────────────────
  const loadFollows = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('follows').select('following_id').eq('follower_id', userId);
      if (data) setFollowedUsers(new Set(data.map((f: any) => f.following_id)));
    } catch (_) {}
  }, [supabase]);

  // ── refreshProfile ────────────────────────────────────────────────────────
  const refreshProfile = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const profile = await loadProfile(authUser.id, authUser.email || '');
        if (profile) setUser(profile);
      }
    } catch (_) {}
  }, [supabase, loadProfile]);

  // ── Auth state listener (DEFERRED — never blocks iOS startup) ────────────
  useEffect(() => {
    console.log('[BOOT] AuthProvider useEffect — scheduling auth listener');

    // Safety timeout: if Supabase never responds, unblock the app after 5s
    const safetyTimeout = setTimeout(() => {
      console.log('[BOOT] AuthProvider safety timeout — forcing isLoading=false');
      setIsLoading(false);
    }, 5000);

    // Defer the actual listener registration so it doesn't block the initial
    // React render pass during Expo Router route registration on iOS.
    const initTimer = setTimeout(() => {
      console.log('[BOOT] AuthProvider — registering onAuthStateChange');
      try {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, session) => {
            clearTimeout(safetyTimeout);
            console.log('[BOOT] AuthProvider — auth event:', event);
            try {
              if (session?.user) {
                const profile = await loadProfile(session.user.id, session.user.email || '');
                setUser(profile);
                if (profile) await loadFollows(session.user.id);
              } else {
                setUser(null);
                setFollowedUsers(new Set());
              }
            } catch (e) {
              console.error('[AuthProvider] auth state handler error:', e);
              setUser(null);
            }
            setIsLoading(false);
          }
        );

        return () => {
          clearTimeout(safetyTimeout);
          subscription?.unsubscribe?.();
        };
      } catch (e) {
        console.error('[AuthProvider] onAuthStateChange registration failed:', e);
        clearTimeout(safetyTimeout);
        setIsLoading(false);
      }
    }, 0); // defer to next event loop tick

    return () => {
      clearTimeout(safetyTimeout);
      clearTimeout(initTimer);
    };
  }, [loadProfile, loadFollows]);

  // ── login / register / logout ─────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Error al iniciar sesion' };
    }
  }, [supabase]);

  const register = useCallback(async (email: string, password: string, username: string) => {
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
  }, [supabase]);

  const logout = useCallback(async () => {
    try { await supabase.auth.signOut(); } catch (_) {}
    setUser(null);
    setFollowedUsers(new Set());
  }, [supabase]);

  // ── updateProfile / updateDAGBalance / connectWallet ─────────────────────
  const updateProfile = useCallback(async (updates: Partial<AppUser>) => {
    if (!user) return;
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
    } catch (_) {}
  }, [user, supabase]);

  const updateDAGBalance = useCallback((newBalance: number) => {
    setUser(prev => prev ? { ...prev, dagBalance: Math.max(0, newBalance) } : null);
  }, []);

  const connectWallet = useCallback(async (address: string) => {
    if (!user) return;
    try {
      await supabase.from('user_profiles')
        .update({ wallet_address: address }).eq('id', user.id);
      setUser(prev => prev ? { ...prev, walletAddress: address } : null);
    } catch (_) {}
  }, [user, supabase]);

  // ── toggleFollow ──────────────────────────────────────────────────────────
  const toggleFollow = useCallback(async (targetUserId: string) => {
    if (!user || targetUserId === user.id) return;
    const isFollowingNow = followedUsers.has(targetUserId);
    setFollowedUsers(prev => {
      const next = new Set(prev);
      isFollowingNow ? next.delete(targetUserId) : next.add(targetUserId);
      return next;
    });
    setUser(u => u ? {
      ...u, following: Math.max(0, u.following + (isFollowingNow ? -1 : 1)),
    } : u);
    try {
      if (isFollowingNow) {
        await supabase.from('follows').delete()
          .eq('follower_id', user.id).eq('following_id', targetUserId);
        await supabase.from('user_profiles')
          .update({ following_count: Math.max(0, user.following - 1) }).eq('id', user.id);
        const { data: tp } = await supabase.from('user_profiles')
          .select('followers_count').eq('id', targetUserId).single();
        if (tp) await supabase.from('user_profiles')
          .update({ followers_count: Math.max(0, (tp.followers_count || 0) - 1) }).eq('id', targetUserId);
      } else {
        await supabase.from('follows')
          .insert({ follower_id: user.id, following_id: targetUserId })
          .select().single().catch(() => null);
        await supabase.from('user_profiles')
          .update({ following_count: user.following + 1 }).eq('id', user.id);
        const { data: tp } = await supabase.from('user_profiles')
          .select('followers_count').eq('id', targetUserId).single();
        if (tp) await supabase.from('user_profiles')
          .update({ followers_count: (tp.followers_count || 0) + 1 }).eq('id', targetUserId);
      }
      await loadFollows(user.id);
    } catch (_) {
      setFollowedUsers(prev => {
        const next = new Set(prev);
        isFollowingNow ? next.add(targetUserId) : next.delete(targetUserId);
        return next;
      });
      setUser(u => u ? {
        ...u, following: Math.max(0, u.following + (isFollowingNow ? 1 : -1)),
      } : u);
    }
  }, [user, followedUsers, supabase, loadFollows]);

  const isFollowing = useCallback((userId: string) => followedUsers.has(userId), [followedUsers]);

  return (
    <AuthContext.Provider value={{
      user, isLoading, isAuthenticated: !!user,
      followedUsers, login, register, logout,
      updateProfile, updateDAGBalance, connectWallet,
      toggleFollow, isFollowing, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
