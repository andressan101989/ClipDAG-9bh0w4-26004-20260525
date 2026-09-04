export const HOST_INVITE_WINDOW_MS = 20_000;

export type LiveHostInvitationAction = 'accept' | 'reject';

export type LiveHostInvitationActionOutcome<T> =
  | { status: 'succeeded'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'ignored' };

export function resolveHostInviteExpiresAt(createdAt: string, now = Date.now()): number {
  const createdAtMs = Date.parse(createdAt);
  return (Number.isFinite(createdAtMs) ? createdAtMs : now) + HOST_INVITE_WINDOW_MS;
}

export function getHostInviteRemainingSeconds(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1_000));
}

export class LiveHostInvitationActionGate {
  private inFlight = false;

  async run<T>(
    _inviteId: string,
    _action: LiveHostInvitationAction,
    responder: () => Promise<T>,
  ): Promise<LiveHostInvitationActionOutcome<T>> {
    if (this.inFlight) return { status: 'ignored' };
    this.inFlight = true;
    try {
      return { status: 'succeeded', value: await responder() };
    } catch (error) {
      return { status: 'failed', error };
    } finally {
      this.inFlight = false;
    }
  }

  get busy(): boolean {
    return this.inFlight;
  }
}
