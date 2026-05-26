import { useContext } from 'react';
import { AuthContext } from '@/contexts/AuthContext';

// Safe fallback — returns a non-throwing default when AuthProvider is not mounted.
// This prevents crashes in components that are evaluated before providers mount
// (e.g. tab bar layout during expo-router startup route registration).
const AUTH_FALLBACK = {
  user: null,
  isLoading: false,
  isAuthenticated: false,
  followedUsers: new Set<string>(),
  login: async () => ({ success: false, error: 'AuthProvider not mounted' }),
  register: async () => ({ success: false, error: 'AuthProvider not mounted' }),
  logout: async () => {},
  updateProfile: async () => {},
  updateDAGBalance: () => {},
  connectWallet: async () => {},
  toggleFollow: async () => {},
  isFollowing: () => false,
  refreshProfile: async () => {},
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) return AUTH_FALLBACK as any;
  return context;
}
