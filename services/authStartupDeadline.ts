export type AuthStartupCompletionReason =
  | 'auth_event'
  | 'registration_error'
  | 'timeout';

type TimerHandle = ReturnType<typeof setTimeout>;

export function deferAuthBootstrap(
  task: () => Promise<void>,
  setTimer: (callback: () => void, timeoutMs: number) => TimerHandle = setTimeout,
) {
  return setTimer(() => {
    void task();
  }, 0);
}

interface AuthStartupDeadlineOptions {
  timeoutMs: number;
  onReady: (reason: AuthStartupCompletionReason) => void;
  setTimer?: (callback: () => void, timeoutMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export function createAuthStartupDeadline({
  timeoutMs,
  onReady,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: AuthStartupDeadlineOptions) {
  let isOpen = true;
  let timerHandle: TimerHandle | undefined;

  const finish = (
    reason: AuthStartupCompletionReason,
    clearPendingTimer: boolean,
  ) => {
    if (!isOpen) return false;

    isOpen = false;
    if (clearPendingTimer && timerHandle !== undefined) {
      clearTimer(timerHandle);
    }
    onReady(reason);
    return true;
  };

  timerHandle = setTimer(() => finish('timeout', false), timeoutMs);

  return {
    complete(reason: Exclude<AuthStartupCompletionReason, 'timeout'>) {
      return finish(reason, true);
    },
    cancel() {
      if (!isOpen) return false;

      isOpen = false;
      if (timerHandle !== undefined) clearTimer(timerHandle);
      return true;
    },
    get isOpen() {
      return isOpen;
    },
  };
}
