export type ForegroundClaimResult =
  | 'claimed_onspace'
  | 'claimed_callkit'
  | 'deadline_elapsed'
  | 'terminal'
  | 'legacy_or_not_found'
  | 'retryable_error';

export function classifyForegroundClaim(
  owner: unknown,
  presentationStatus: unknown,
): ForegroundClaimResult {
  if (owner === 'onspace') return 'claimed_onspace';
  if (owner === 'callkit' && presentationStatus === 'deadline_elapsed') return 'deadline_elapsed';
  if (owner === 'callkit') return 'claimed_callkit';
  if (owner === 'terminal') return 'terminal';
  if (owner === 'not_found' && presentationStatus === 'not_found') return 'legacy_or_not_found';
  return 'retryable_error';
}

export function shouldSuppressForegroundModal(result: ForegroundClaimResult): boolean {
  return result === 'claimed_callkit' || result === 'terminal';
}
