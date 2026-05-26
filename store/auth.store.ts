/**
 * store/auth.store.ts — Auth domain store
 *
 * Reactive state atom for authentication. Decoupled from React Context —
 * can be read/written from anywhere (services, modules, non-React code).
 *
 * Pattern: Observable store with subscriber registry.
 * Contexts consume this store and sync to React state via subscription.
 *
 * Usage:
 *   import { AuthStore } from '@/store/auth.store';
 *
 *   // Read
 *   const { user, isAuthenticated } = AuthStore.getState();
 *
 *   // Write (from service layer)
 *   AuthStore.setState({ user, isAuthenticated: true });
 *
 *   // Subscribe (from hook/context)
 *   const unsub = AuthStore.subscribe(state => setUser(state.user));
 */

import { EventBus } from '@/modules/core/EventBus';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id:             string;
  email:          string;
  username?:      string;
  displayName?:   string;
  avatarUrl?:     string;
  dagBalance:     number;
  walletAddress?: string;
  isCreator:      boolean;
  isPrivate:      boolean;
  followersCount: number;
  followingCount: number;
  createdAt?:     string;
}

export interface AuthState {
  user:              AuthUser | null;
  isAuthenticated:   boolean;
  isLoading:         boolean;
  sessionToken?:     string;
  lastAuthAt?:       number;
  error?:            string;
}

const INITIAL_STATE: AuthState = {
  user:            null,
  isAuthenticated: false,
  isLoading:       true,
};

// ── Store implementation ──────────────────────────────────────────────────────
class AuthStoreImpl {
  private _state: AuthState = { ...INITIAL_STATE };
  private readonly _subscribers = new Set<(s: AuthState) => void>();

  getState(): AuthState {
    return this._state;
  }

  setState(patch: Partial<AuthState>): void {
    const prev = this._state;
    this._state = { ...prev, ...patch };

    // Emit EventBus events on meaningful transitions
    if (!prev.isAuthenticated && this._state.isAuthenticated && this._state.user) {
      EventBus.emit('auth:login', { userId: this._state.user.id });
    }
    if (prev.isAuthenticated && !this._state.isAuthenticated) {
      EventBus.emit('auth:logout');
    }
    if (prev.user?.dagBalance !== this._state.user?.dagBalance && this._state.user) {
      EventBus.emit('wallet:balance_updated', {
        balance: this._state.user.dagBalance,
        userId:  this._state.user.id,
      });
    }

    this._notify();
  }

  /** Update a nested field on the user object. */
  updateUser(patch: Partial<AuthUser>): void {
    if (!this._state.user) return;
    const user = { ...this._state.user, ...patch };
    this.setState({ user });
    if (Object.keys(patch).length > 0 && user.id) {
      const field = Object.keys(patch)[0];
      EventBus.emit('auth:profile_updated', { userId: user.id, field });
    }
  }

  subscribe(fn: (s: AuthState) => void): () => void {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  reset(): void {
    this._state = { ...INITIAL_STATE, isLoading: false };
    this._notify();
  }

  private _notify(): void {
    for (const fn of this._subscribers) {
      try { fn(this._state); } catch { /* isolate subscriber errors */ }
    }
  }
}

export const AuthStore = new AuthStoreImpl();
