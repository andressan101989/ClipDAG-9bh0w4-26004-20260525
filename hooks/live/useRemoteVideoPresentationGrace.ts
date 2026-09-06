import { useEffect, useRef, useState, type ReactNode } from 'react';

export const REMOTE_VIDEO_PLACEHOLDER_GRACE_MS = 700;

type RemoteVideoPresentationScope = {
  battleId: string | null;
  roundNumber: number | null;
  opponentId: string | null;
  enabled: boolean;
};

type RetainedSurface = {
  opponentId: string;
  surface: ReactNode;
};

/**
 * Keeps an already-confirmed remote surface mounted across a brief projection
 * gap. This affects presentation only; media membership remains authoritative
 * in useAgoraEngine's remoteUids.
 */
export function useRemoteVideoPresentationGrace(
  surface: ReactNode,
  { battleId, roundNumber, opponentId, enabled }: RemoteVideoPresentationScope,
): ReactNode {
  const scopeKey = enabled && battleId && opponentId
    ? `${battleId}:${roundNumber ?? 0}:${opponentId}`
    : null;
  const mountedRef = useRef(true);
  const activeScopeRef = useRef(scopeKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const retainedRef = useRef<RetainedSurface | null>(null);
  const [expiredScopeKey, setExpiredScopeKey] = useState<string | null>(null);

  activeScopeRef.current = scopeKey;
  if (enabled && opponentId && surface !== null && surface !== undefined) {
    retainedRef.current = { opponentId, surface };
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      retainedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    if (!scopeKey || !opponentId) {
      retainedRef.current = null;
      setExpiredScopeKey(null);
      return;
    }
    if (surface !== null && surface !== undefined) {
      setExpiredScopeKey(null);
      return;
    }
    if (retainedRef.current?.opponentId !== opponentId) {
      setExpiredScopeKey(scopeKey);
      return;
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!mountedRef.current
        || generation !== generationRef.current
        || activeScopeRef.current !== scopeKey) return;
      setExpiredScopeKey(scopeKey);
    }, REMOTE_VIDEO_PLACEHOLDER_GRACE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [opponentId, scopeKey, surface]);

  if (!scopeKey) return surface;
  if (surface !== null && surface !== undefined) return surface;
  const retained = retainedRef.current;
  return retained?.opponentId === opponentId && expiredScopeKey !== scopeKey
    ? retained.surface
    : null;
}
