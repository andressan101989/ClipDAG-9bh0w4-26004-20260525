import React, { createContext, useState, useCallback, useEffect, ReactNode } from 'react';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [followedUsers, setFollowedUsers] = useState<Set<string>>(new Set());

  const supabase = getSupabaseClient();

  const loadProfile = useCallback(async (userId: string, email: string): Promise<AppUser | null> => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.log('Profile load error:', error.message);
        return null;
      }

      if (!data) {
        // Profile not created yet (race condition with trigger) — create it
        const username = email.split('@')[0];
        const { data: newData, error: insertError } = await supabase
          .from('user_profiles')
          .insert({
            id: userId,
            email,
            username,
            dag_balance: 0,
          })
          .select()
          .single();

        if (insertError) {
          console.log('Profile create error:', insertError.message);
          // Return a minimal profile without DB
          return {
            id: userId,
            email,
            username,
            displayName: username,
            avatar: generateFallbackAvatar(username),
            bio: '',
            profession: '',
            website: '',
            location: '',
            followers: 0,
            following: 0,
            dagBalance: 0,
            walletAddress: null,
            totalLikes: 0,
          };
        }

        const d = newData;
        return {
          id: d.id,
          email: d.email || email,
          username: d.username || username,
          displayName: d.display_name || d.username || username,
          avatar: d.avatar_url || generateFallbackAvatar(d.username || username),
          bio: d.bio || '',
          profession: d.profession || '',
          website: d.website || '',
          location: d.location || '',
          followers: d.followers_count || 0,
          following: d.following_count || 0,
          dagBalance: Number(d.dag_balance || 0),
          walletAddress: d.wallet_address || null,
          totalLikes: 0,
        };
      }

      return {
        id: data.id,
        email: data.email || email,
        username: data.username || email.split('@')[0],
        displayName: data.display_name || data.username || email.split('@')[0],
        avatar: data.avatar_url || generateFallbackAvatar(data.username || email.split('@')[0]),
        bio: data.bio || '',
        profession: data.profession || '',
        website: data.website || '',
        location: data.location || '',
        followers: data.followers_count || 0,
        following: data.following_count || 0,
        dagBalance: Number(data.dag_balance || 0),
        walletAddress: data.wallet_address || null,
        totalLikes: 0,
      };
    } catch (e) {
      console.log('Profile load exception:', e);
      return null;
    }
  }, [supabase]);

  const loadFollows = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', userId);

      if (data) {
        setFollowedUsers(new Set(data.map((f: { following_id: string }) => f.following_id)));
      }
    } catch (_) {}
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const profile = await loadProfile(authUser.id, authUser.email || '');
        if (profile) setUser(profile);
      }
    } catch (_) {}
  }, [supabase, loadProfile]);

  // Listen to auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (session?.user) {
          const profile = await loadProfile(session.user.id, session.user.email || '');
          setUser(profile);
          if (profile) {
            await loadFollows(session.user.id);
          }
        } else {
          setUser(null);
          setFollowedUsers(new Set());
        }
      } catch (_) {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => subscription?.unsubscribe?.();
  }, [loadProfile, loadFollows]);

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
    if (!email || !password || !username) {
      return { success: false, error: 'Todos los campos son requeridos' };
    }
    if (password.length < 6) {
      return { success: false, error: 'La contrasena debe tener al menos 6 caracteres' };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });

      if (error) return { success: false, error: error.message };

      if (data.user) {
        // Update username in profile (trigger creates it, we update username)
        await supabase
          .from('user_profiles')
          .update({ username, dag_balance: 0 })
          .eq('id', data.user.id);
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Error al registrarse' };
    }
  }, [supabase]);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (_) {}
    setUser(null);
    setFollowedUsers(new Set());
  }, [supabase]);

  const updateProfile = useCallback(async (updates: Partial<AppUser>) => {
    if (!user) return;
    try {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.displayName !== undefined) dbUpdates.display_name = updates.displayName;
      if (updates.username !== undefined) dbUpdates.username = updates.username;
      if (updates.bio !== undefined) dbUpdates.bio = updates.bio;
      if (updates.avatar !== undefined) dbUpdates.avatar_url = updates.avatar;
      if (updates.profession !== undefined) dbUpdates.profession = updates.profession;
      if (updates.website !== undefined) dbUpdates.website = updates.website;
      if (updates.location !== undefined) dbUpdates.location = updates.location;

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
      await supabase
        .from('user_profiles')
        .update({ wallet_address: address })
        .eq('id', user.id);
      setUser(prev => prev ? { ...prev, walletAddress: address } : null);
    } catch (_) {}
  }, [user, supabase]);

  const toggleFollow = useCallback(async (targetUserId: string) => {
    if (!user || targetUserId === user.id) return;
    const isFollowingNow = followedUsers.has(targetUserId);

    // Optimistic update of local state
    setFollowedUsers(prev => {
      const next = new Set(prev);
      isFollowingNow ? next.delete(targetUserId) : next.add(targetUserId);
      return next;
    });
    setUser(u => u ? {
      ...u,
      following: Math.max(0, u.following + (isFollowingNow ? -1 : 1)),
    } : u);

    try {
      if (isFollowingNow) {
        // Remove follow record
        await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', targetUserId);

        // Decrement following_count for current user (best effort)
        await supabase
          .from('user_profiles')
          .update({ following_count: Math.max(0, user.following - 1) })
          .eq('id', user.id);

        // Decrement followers_count for target user (best effort)
        const { data: targetProfile } = await supabase
          .from('user_profiles')
          .select('followers_count')
          .eq('id', targetUserId)
          .single();
        if (targetProfile) {
          await supabase
            .from('user_profiles')
            .update({ followers_count: Math.max(0, (targetProfile.followers_count || 0) - 1) })
            .eq('id', targetUserId);
        }
      } else {
        // Insert follow record (ignore duplicate error)
        await supabase
          .from('follows')
          .insert({ follower_id: user.id, following_id: targetUserId })
          .select()
          .single()
          .catch(() => null); // ignore unique constraint error if already followed

        // Increment following_count for current user
        await supabase
          .from('user_profiles')
          .update({ following_count: user.following + 1 })
          .eq('id', user.id);

        // Increment followers_count for target user
        const { data: targetProfile } = await supabase
          .from('user_profiles')
          .select('followers_count')
          .eq('id', targetUserId)
          .single();
        if (targetProfile) {
          await supabase
            .from('user_profiles')
            .update({ followers_count: (targetProfile.followers_count || 0) + 1 })
            .eq('id', targetUserId);
        }
      }

      // Reload follows list to keep followedUsers set accurate
      await loadFollows(user.id);
    } catch (_) {
      // Revert optimistic update on error
      setFollowedUsers(prev => {
        const next = new Set(prev);
        isFollowingNow ? next.add(targetUserId) : next.delete(targetUserId);
        return next;
      });
      setUser(u => u ? {
        ...u,
        following: Math.max(0, u.following + (isFollowingNow ? 1 : -1)),
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
