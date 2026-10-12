import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWalletConnectInitializer,
  resolveWalletConnectProjectId,
} from '../services/walletConnectRuntime.ts';
import { presentAuthError } from '../services/authErrorPresentation.ts';

const VALID_PROJECT_ID = '0123456789abcdef0123456789abcdef';

test('WalletConnect stays disabled and never invokes AppKit for missing or invalid project IDs', () => {
  for (const candidate of [
    undefined,
    '',
    'walletconnect-project-id-not-configured',
    'placeholder',
    'not-a-project-id',
  ]) {
    let factoryCalls = 0;
    const initializer = createWalletConnectInitializer(candidate, () => {
      factoryCalls += 1;
      return { id: 'unexpected' };
    });

    assert.equal(initializer.isEnabled, false);
    assert.equal(initializer.getInstance(), null);
    assert.equal(initializer.getInstance(), null);
    assert.equal(factoryCalls, 0);
  }
});

test('WalletConnect creates one instance for a canonical project ID and never reconnects by reinitializing', () => {
  let factoryCalls = 0;
  const expected = { id: 'appkit-instance' };
  const initializer = createWalletConnectInitializer(VALID_PROJECT_ID, (projectId) => {
    factoryCalls += 1;
    assert.equal(projectId, VALID_PROJECT_ID);
    return expected;
  });

  assert.equal(initializer.isEnabled, true);
  assert.equal(initializer.getInstance(), expected);
  assert.equal(initializer.getInstance(), expected);
  assert.equal(factoryCalls, 1);
});

test('WalletConnect fails closed after initialization failure without an automatic retry loop', () => {
  let factoryCalls = 0;
  const initializer = createWalletConnectInitializer(VALID_PROJECT_ID, () => {
    factoryCalls += 1;
    throw new Error('relay unavailable with secret-token-that-must-not-leak');
  });

  assert.equal(initializer.getInstance(), null);
  assert.equal(initializer.getInstance(), null);
  assert.equal(initializer.failureCode, 'INITIALIZATION_FAILED');
  assert.equal(factoryCalls, 1);
});

test('project ID validation returns fixed, non-sensitive reasons', () => {
  assert.deepEqual(resolveWalletConnectProjectId(undefined), {
    enabled: false,
    code: 'PROJECT_ID_MISSING',
  });
  assert.deepEqual(resolveWalletConnectProjectId('bad-id'), {
    enabled: false,
    code: 'PROJECT_ID_INVALID',
  });
  assert.deepEqual(resolveWalletConnectProjectId(`  ${VALID_PROJECT_ID.toUpperCase()}  `), {
    enabled: true,
    projectId: VALID_PROJECT_ID.toUpperCase(),
  });
});

test('Auth errors distinguish credentials, reachability, confirmation, expiry, and throttling', () => {
  assert.deepEqual(presentAuthError({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }), {
    kind: 'invalid_credentials',
    message: 'Correo o contraseña incorrectos.',
    retryable: true,
    status: 400,
  });
  assert.equal(presentAuthError({ code: 'email_not_confirmed' }).kind, 'email_not_confirmed');
  assert.equal(presentAuthError(new TypeError('Network request failed')).kind, 'backend_unreachable');
  assert.equal(presentAuthError({ code: 'refresh_token_not_found' }).kind, 'session_expired');
  assert.equal(presentAuthError({ status: 429, code: 'over_request_rate_limit' }).kind, 'rate_limited');
});

test('Auth presentation never echoes untrusted provider details or credentials', () => {
  const secret = 'service-role-secret-value';
  const result = presentAuthError({
    status: 503,
    message: `fetch failed https://private.example.test?apikey=${secret}`,
  });

  assert.equal(result.kind, 'backend_unreachable');
  assert.equal(result.retryable, true);
  assert.doesNotMatch(JSON.stringify(result), /private\.example|apikey|service-role-secret-value/i);
});
