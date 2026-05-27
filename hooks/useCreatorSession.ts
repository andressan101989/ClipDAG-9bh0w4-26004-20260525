
/**
 * hooks/useCreatorSession.ts — Encapsulates all @/modules imports for creator-studio
 *
 * Enforces architecture rule: app/ screens must not import from @/modules directly.
 * Creator Studio delegates all infrastructure access through this hook.
 *
 * Responsibilities:
 *   - GPU slot acquisition / release
 *   - Camera resource lease
 *   - SessionOrchestrator registration
 *   - CreatorSessionManager lifecycle
 *   - CreatorRecoveryManager autosave + draft restore
 *   - CrashIntelligence breadcrumbs
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { CreatorSessionManager }  from '@/modules/creator/sessions/CreatorSessionManager';
import { CreatorRecoveryManager } from '@/modules/creator/sessions/CreatorRecoveryManager';
import { SessionOrchestrator }    from '@/modules/sessions/SessionOrchestrator';
import { ResourceManager }        from '@/modules/core/ResourceManager';
import { GPUManager }             from '@/modules/core/GPUManager';
import { CrashIntelligence }      from '@/modules/core/CrashIntelligence';

export interface CreatorSessionCallbacks {
  /** Called when the session is paused (e.g. incoming call) */
  onPause?: () => Promise<void>;
  /** Called when the session resumes */
  onResume?: () => Promise<void>;
  /** Returns a draft if one exists, else null */
  onDraftFound?: (draft: any) => void;
}

export interface CreatorSessionReturn {
  /** True once the full session init has completed */
  sessionReady: boolean;
  /** Manually save a checkpoint (e.g. on tab switch) */
  saveCheckpoint: (state: Record<string, unknown>) => Promise<void>;
  /** Clear the saved draft (e.g. user chooses to discard) */
  clearDraft: () => void;
  /** Proxy for CrashIntelligence.addBreadcrumb — keeps @/modules out of screens */
  addBreadcrumb: (category: string, message: string, data?: Record<string, unknown>) => void;
}

const SESSION_ID    = 'creator_studio_main';
const AUTOSAVE_MS   = 10_000;

/**
 * Usage:
 *
 * ```ts
 * const { sessionReady, saveCheckpoint, clearDraft } = useCreatorSession({
 *   onPause:      async () => { ... },
 *   onResume:     async () => { ... },
 *   onDraftFound: (draft) => { if (draft.metadata?.tab) setTab(draft.metadata.tab); },
 * });
 * ```
 */
export function useCreatorSession(
  callbacks: CreatorSessionCallbacks,
  currentState: () => Record<string, unknown>,
): CreatorSessionReturn {
  const [sessionReady, setSessionReady] = useState(false); // Changed to useState
  const gpuSlotRef      = useRef<string | null>(null);
  const autosaveRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef      = useRef(true);

  // Stable refs for callbacks so useEffect deps stay minimal
  const onPauseRef     = useRef(callbacks.onPause);
  const onResumeRef    = useRef(callbacks.onResume);
  const onDraftRef     = useRef(callbacks.onDraftFound);
  const currentStateRef = useRef(currentState);
  onPauseRef.current      = callbacks.onPause;
  onResumeRef.current     = callbacks.onResume;
  onDraftRef.current      = callbacks.onDraftFound;
  currentStateRef.current = currentState;

  const cleanup = useCallback(async () => {
    if (autosaveRef.current) {
      clearInterval(autosaveRef.current);
      autosaveRef.current = null;
    }
    try {
      await CreatorRecoveryManager.saveCheckpoint(
        SESSION_ID, 'editing', currentStateRef.current(),
      );
    } catch { /* non-critical */ }
    try { await CreatorSessionManager.endSession(SESSION_ID); } catch { /* non-critical */ }
    try { await SessionOrchestrator.endSession(SESSION_ID); }  catch { /* non-critical */ }
    ResourceManager.release('camera', 'CreatorStudio');
    if (gpuSlotRef.current) {
      GPUManager.releaseSlot(gpuSlotRef.current);
      gpuSlotRef.current = null;
    }
    CrashIntelligence.addBreadcrumb('lifecycle', 'CreatorStudio cleanup complete');
  }, []);

  // Exposed: save a checkpoint from outside the hook
  const saveCheckpoint = useCallback(async (state: Record<string, unknown>) => {
    try {
      await CreatorRecoveryManager.saveCheckpoint(SESSION_ID, 'editing', state);
    } catch { /* non-critical */ }
  }, []);

  const clearDraft = useCallback(() => {
    CreatorRecoveryManager.clearDraft(SESSION_ID);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    CrashIntelligence.addBreadcrumb('navigation', 'CreatorStudio mounted');

    const init = async () => {
      try {
        gpuSlotRef.current = await GPUManager.acquireSlot('CreatorStudio', 'high');
        ResourceManager.request('camera', 'CreatorStudio');

        SessionOrchestrator.registerSession('creator_capture', SESSION_ID, {
          onPause:   async () => {
            CrashIntelligence.addBreadcrumb('state', 'CreatorStudio paused');
            await CreatorRecoveryManager.saveCheckpoint(
              SESSION_ID, 'paused', currentStateRef.current(),
            );
            await onPauseRef.current?.();
          },
          onResume:  async () => {
            CrashIntelligence.addBreadcrumb('state', 'CreatorStudio resumed');
            await onResumeRef.current?.();
          },
          onEnd:     async () => { await cleanup(); },
          onRecover: async () => {
            CrashIntelligence.addBreadcrumb('state', 'CreatorStudio recovering');
            return true;
          },
        });

        await CreatorSessionManager.startSession(SESSION_ID);

        const draft = await CreatorRecoveryManager.getLatestDraft(SESSION_ID);
        if (draft && mountedRef.current) {
          onDraftRef.current?.(draft);
        }

        autosaveRef.current = setInterval(async () => {
          await CreatorRecoveryManager.saveCheckpoint(
            SESSION_ID, 'editing', currentStateRef.current(),
          );
        }, AUTOSAVE_MS);

        if (mountedRef.current) {
          setSessionReady(true); // Update state directly
          CrashIntelligence.addBreadcrumb('state', 'CreatorStudio session ready');
        }
      } catch (e: any) {
        CrashIntelligence.addBreadcrumb('error', `CreatorStudio init error: ${e?.message}`);
        console.error('[useCreatorSession] init error:', e?.message);
        if (mountedRef.current) {
          setSessionReady(true); // Still set ready to prevent infinite loading if error occurs
        }
      }
    };

    init();

    return () => {
      mountedRef.current = false;
      // NOTE: React effect cleanup must be synchronous; cleanup() is async.
      // The final saveCheckpoint call inside cleanup() may not complete if the
      // component unmounts abruptly. This is an accepted React limitation.
      // Mitigation: CreatorRecoveryManager autosaves every 10s, so at most
      // one autosave window of work could be lost on fast unmounts.
      cleanup();
    };
  }, [cleanup]);

  const addBreadcrumb = useCallback(
    (category: string, message: string, data?: Record<string, unknown>) => {
      CrashIntelligence.addBreadcrumb(category, message, data);
    },
    [],
  );

  return {
    sessionReady,
    saveCheckpoint,
    clearDraft,
    addBreadcrumb,
  };
}
