/**
 * hooks/core/useSessionOrchestrator.ts — React hook for session registration
 *
 * Registers a component's session with SessionOrchestrator and
 * ensures automatic cleanup (unregister) on unmount.
 *
 * Usage:
 *   function CallScreen() {
 *     useSessionOrchestrator('call', callId, {
 *       onPause:   async () => pauseVideo(),
 *       onResume:  async () => resumeVideo(),
 *       onEnd:     async () => hangUp(),
 *       onRecover: async () => reconnect(),
 *     });
 *   }
 */

import { useEffect } from 'react';
import { SessionOrchestrator } from '@/modules/sessions/SessionOrchestrator';
import type { SessionType, SessionHandlers } from '@/modules/sessions/SessionOrchestrator';

export function useSessionOrchestrator(
  type:     SessionType,
  id:       string,
  handlers: SessionHandlers,
  metadata: Record<string, any> = {},
): void {
  useEffect(() => {
    if (!id) return;
    SessionOrchestrator.registerSession(type, id, handlers, metadata);
    return () => {
      SessionOrchestrator.endSession(id).catch(() => {});
    };
  }, [type, id]);
}
