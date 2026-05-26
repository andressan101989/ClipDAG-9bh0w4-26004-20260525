/**
 * modules/core/AppLifecycle.ts — Centralized app lifecycle + cleanup registry
 *
 * Responsibilities:
 *   1. Monitor AppState (foreground / background / inactive)
 *   2. Provide a global cleanup registry so any module can register
 *      teardown callbacks without coupling to React lifecycle
 *   3. Emit lifecycle events via EventBus so modules can react to
 *      foreground/background transitions without polling AppState directly
 *   4. Track mount/unmount of major feature modules for diagnostics
 *
 * Usage:
 *   import { AppLifecycle } from '@/modules/core/AppLifecycle';
 *
 *   // Register a cleanup (auto-removed when app goes to background)
 *   const unregister = AppLifecycle.registerCleanup('my-poll', () => {
 *     clearInterval(myInterval);
 *   });
 *
 *   // Listen for foreground return
 *   AppLifecycle.onForeground(() => {
 *     startPolling();
 *   });
 *
 *   // Always unregister on component unmount
 *   useEffect(() => unregister, []);
 */

import { AppState, AppStateStatus } from 'react-native';
import { EventBus } from './EventBus';

type CleanupFn = () => void;

interface CleanupEntry {
  id:      string;
  cleanup: CleanupFn;
  /** If true, this cleanup runs when app backgrounds (not just on unmount). */
  onBackground?: boolean;
}

class AppLifecycleManager {
  private readonly _cleanupRegistry = new Map<string, CleanupEntry>();
  private readonly _foregroundListeners: Set<() => void> = new Set();
  private readonly _backgroundListeners: Set<() => void> = new Set();

  private _currentState: AppStateStatus = AppState.currentState;
  private _initialized = false;

  /** Must be called once in the root layout (_layout.tsx or App.tsx). */
  initialize(): void {
    if (this._initialized) return;
    this._initialized = true;

    AppState.addEventListener('change', this._handleAppStateChange.bind(this));
    console.log('[AppLifecycle] initialized — initial state:', this._currentState);
  }

  /** Current app state ('active', 'background', 'inactive'). */
  get state(): AppStateStatus {
    return this._currentState;
  }

  /** True while the app is in the foreground (active). */
  get isActive(): boolean {
    return this._currentState === 'active';
  }

  // ── Cleanup registry ────────────────────────────────────────────────────────

  /**
   * Register a cleanup function. Returns an unregister callback.
   *
   * @param id         Unique key — re-registering the same id replaces the old entry.
   * @param cleanup    Function to call on cleanup.
   * @param onBackground  If true, also calls cleanup when app goes to background.
   */
  registerCleanup(id: string, cleanup: CleanupFn, onBackground = false): () => void {
    this._cleanupRegistry.set(id, { id, cleanup, onBackground });
    return () => this.unregisterCleanup(id);
  }

  unregisterCleanup(id: string): void {
    this._cleanupRegistry.delete(id);
  }

  /** Run all registered cleanups (e.g., on auth logout or app reset). */
  runAllCleanups(): void {
    for (const entry of this._cleanupRegistry.values()) {
      try { entry.cleanup(); } catch (e: any) {
        console.warn(`[AppLifecycle] cleanup "${entry.id}" error:`, e?.message ?? e);
      }
    }
    this._cleanupRegistry.clear();
  }

  /** Number of registered cleanups (diagnostics). */
  get cleanupCount(): number {
    return this._cleanupRegistry.size;
  }

  // ── Lifecycle listeners ─────────────────────────────────────────────────────

  /** Register a callback for app coming to foreground. Returns unsubscribe fn. */
  onForeground(fn: () => void): () => void {
    this._foregroundListeners.add(fn);
    return () => this._foregroundListeners.delete(fn);
  }

  /** Register a callback for app going to background. Returns unsubscribe fn. */
  onBackground(fn: () => void): () => void {
    this._backgroundListeners.add(fn);
    return () => this._backgroundListeners.delete(fn);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _handleAppStateChange(nextState: AppStateStatus): void {
    const prev = this._currentState;
    this._currentState = nextState;

    if (prev !== 'active' && nextState === 'active') {
      console.log('[AppLifecycle] → foreground');
      EventBus.emit('app:foreground');
      for (const fn of this._foregroundListeners) {
        try { fn(); } catch (e: any) {
          console.warn('[AppLifecycle] foreground listener error:', e?.message);
        }
      }
    }

    if (prev === 'active' && nextState !== 'active') {
      console.log('[AppLifecycle] → background');
      EventBus.emit('app:background');
      for (const fn of this._backgroundListeners) {
        try { fn(); } catch (e: any) {
          console.warn('[AppLifecycle] background listener error:', e?.message);
        }
      }
      // Run all background-cleanup-registered entries
      for (const entry of this._cleanupRegistry.values()) {
        if (entry.onBackground) {
          try { entry.cleanup(); } catch { /* ignore */ }
        }
      }
    }
  }
}

export const AppLifecycle = new AppLifecycleManager();
