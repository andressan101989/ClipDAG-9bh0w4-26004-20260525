import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { replaceCallWithHome } from '@/services/callNavigationService';

const redactCallId = (callId: string) => callId ? `${callId.slice(0, 8)}…` : 'pending';

export function useSafeCallScreenExit(callId: string, screen: 'call' | 'video-call' | 'group-call') {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const callIdRef = useRef(callId);
  const previousCallIdRef = useRef(callId);
  const terminalConfirmedRef = useRef(false);
  const exitInFlightRef = useRef<Promise<boolean> | null>(null);
  const exitCompletedRef = useRef(false);

  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  useEffect(() => {
    if (previousCallIdRef.current && callId && previousCallIdRef.current !== callId) {
      exitCompletedRef.current = false;
      exitInFlightRef.current = null;
      terminalConfirmedRef.current = false;
    }
    previousCallIdRef.current = callId;
    callIdRef.current = callId;
  }, [callId]);

  const exitCallScreenSafely = useCallback((reason: string, terminalConfirmed = terminalConfirmedRef.current) => {
    const currentPathname = pathnameRef.current;
    const currentCallId = callIdRef.current;
    const expectedPrefix = `/${screen}/`;
    console.log('[CallNavigation] exit_requested', {
      callId: redactCallId(currentCallId), pathname: currentPathname, canGoBack: false,
      reason, terminalConfirmed, inFlight: Boolean(exitInFlightRef.current),
    });

    if (!terminalConfirmed || exitCompletedRef.current || !currentPathname.startsWith(expectedPrefix)) {
      console.log('[CallNavigation] exit_skipped', {
        callId: redactCallId(currentCallId), pathname: currentPathname,
        reason: !terminalConfirmed ? 'terminal_not_confirmed' : exitCompletedRef.current ? 'already_completed' : 'screen_not_mounted',
      });
      return exitInFlightRef.current ?? Promise.resolve(false);
    }
    if (exitInFlightRef.current) return exitInFlightRef.current;

    const flight = Promise.resolve().then(() => {
      // Once backend/native terminal state is confirmed, use one navigation
      // action only. A replace-entry cold start has no history to pop.
      // CallKit can enter with replace and therefore has no reliable back
      // stack. Every terminal call exits deterministically to Home.
      console.log('[CallNavigation] exit_replace_home', { callId: redactCallId(currentCallId), pathname: currentPathname, reason });
      replaceCallWithHome(router);
      exitCompletedRef.current = true;
      console.log('[CallNavigation] exit_completed', { callId: redactCallId(currentCallId), reason });
      return true;
    }).catch(() => {
      // Do not issue a second navigation action in the same transition.
      console.log('[CallNavigation] exit_skipped', {
        callId: redactCallId(currentCallId), pathname: currentPathname, reason: 'navigation_failed',
      });
      return false;
    });
    exitInFlightRef.current = flight;
    void flight.then(() => {
      if (exitInFlightRef.current === flight) exitInFlightRef.current = null;
    });
    return flight;
  }, [router, screen]);

  return { exitCallScreenSafely, terminalConfirmedRef, exitInFlightRef, exitCompletedRef };
}
