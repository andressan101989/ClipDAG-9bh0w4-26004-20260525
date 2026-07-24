import {
  classifyForegroundClaim,
  shouldSuppressForegroundModal,
} from '../services/callPresentationPolicy';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const onspace = classifyForegroundClaim('onspace', 'claimed');
assert(onspace === 'claimed_onspace', 'onspace must be authoritative');
assert(!shouldSuppressForegroundModal(onspace), 'onspace must show the modal');

const processing = classifyForegroundClaim('callkit', 'processing');
assert(processing === 'claimed_callkit', 'processing with callkit owner is authoritative');
assert(shouldSuppressForegroundModal(processing), 'authoritative callkit must suppress the modal');

const deadline = classifyForegroundClaim('callkit', 'deadline_elapsed');
assert(deadline === 'deadline_elapsed', 'deadline is not a persisted callkit owner');
assert(!shouldSuppressForegroundModal(deadline), 'deadline alone must not create sticky suppression');

const legacy = classifyForegroundClaim('not_found', 'not_found');
assert(legacy === 'legacy_or_not_found', 'not_found must preserve IOS-B fallback');
assert(!shouldSuppressForegroundModal(legacy), 'legacy must not be treated as authoritative callkit');

const terminal = classifyForegroundClaim('terminal', 'ended');
assert(shouldSuppressForegroundModal(terminal), 'terminal calls must not show a modal');

const unknown = classifyForegroundClaim(null, null);
assert(unknown === 'retryable_error', 'unknown responses must fail closed without false ownership');
