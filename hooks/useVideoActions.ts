/**
 * hooks/useVideoActions.ts — Thin hook wrapper for VideoActions module dependencies
 *
 * Enforces architecture rule: components/ must not import from @/modules directly.
 * VideoActions uses this hook to access SecurityManager and CrashIntelligence.
 */

import { useCallback } from 'react';
import { SecurityManager }   from '@/modules/core/SecurityManager';
import { CrashIntelligence } from '@/modules/core/CrashIntelligence';

type SecurityAction = 'like' | 'comment' | 'search' | 'send_gift' | 'join_battle' | 'create_video';

export interface VideoActionsHook {
  /** Returns true if the action is allowed for the given user */
  checkAction: (action: SecurityAction, userId: string) => boolean;
  /** Proxy for CrashIntelligence.addBreadcrumb */
  addBreadcrumb: (category: string, message: string, data?: Record<string, unknown>) => void;
}

export function useVideoActions(): VideoActionsHook {
  const checkAction = useCallback(
    (action: SecurityAction, userId: string): boolean =>
      SecurityManager.checkAction(action, userId),
    [],
  );

  const addBreadcrumb = useCallback(
    (category: string, message: string, data?: Record<string, unknown>) => {
      CrashIntelligence.addBreadcrumb(category, message, data);
    },
    [],
  );

  return { checkAction, addBreadcrumb };
}
