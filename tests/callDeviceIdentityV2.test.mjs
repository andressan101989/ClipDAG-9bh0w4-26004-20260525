import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const service = read('services/callDeviceService.ts');
const migration = read('supabase/migrations/20260724120000_repair_call_device_registration.sql');

const transpiled = ts.transpileModule(service, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
});
assert.deepEqual(
  (transpiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error),
  [],
  'callDeviceService.ts must transpile',
);

// Installation identity v2 is uninstall-scoped AsyncStorage state. Legacy
// SecureStore is read only to identify and later remove the superseded row.
assert.match(service, /import AsyncStorage from '@react-native-async-storage\/async-storage'/);
assert.match(service, /onspace\.call\.installation_id\.v2/);
assert.match(service, /onspace\.call_device\.\$\{user\.id\}\.device_id\.v2/);
assert.match(service, /onspace\.call_device\.last_sync_at\.v2/);
assert.match(service, /onspace\.call_device\.last_voip_sync_at\.v2/);
assert.match(service, /const legacyInstallationId = normalizeToken\(await getStored\(LEGACY_INSTALLATION_ID_KEY\)\)/);
assert.match(service, /const created = generateUUID\(\)/);
assert.doesNotMatch(
  service,
  /setAsyncStored\(INSTALLATION_ID_V2_KEY,\s*legacyInstallationId/,
  'legacy installation ID must never be copied into v2 storage',
);

// Migration bypasses throttles, requires a current VoIP token, and keeps the
// legacy identity until the backend confirms the new binding.
assert.match(service, /migrationRequired = identity\.migrationPending \|\| !storedDeviceId \|\| userChanged/);
assert.match(service, /if \(Platform\.OS === 'ios' && !voipPushToken\)[\s\S]*migration retained/);
assert.match(service, /repair_call_device_registration/);
assert.match(service, /if \(!result\?\.tokenBound\) throw/);
const bindingIndex = service.indexOf("debug('[CallDevice] token binding confirmed'");
const cleanupIndex = service.indexOf('await clearLegacyDeviceIdentity(user.id)');
assert.ok(bindingIndex >= 0 && cleanupIndex > bindingIndex,
  'legacy storage cleanup must happen after token binding confirmation');
assert.match(service, /onIosVoipTokenUpdated\(token =>[\s\S]*force: true, voipTokenOverride: token/);
assert.match(service, /state === 'active'[\s\S]*syncCurrentCallDevice/);
assert.match(service, /lastAuthenticatedUserId !== user\.id/);

// The RPC is authenticated, iOS-only, token-required, atomic, idempotent by
// installation ID, and deactivates only the explicit legacy installation or
// rows that previously held the exact same tokens.
assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
assert.match(migration, /if v_platform <> 'ios'/);
assert.match(migration, /if v_voip_push_token is null/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /where cd\.user_id = v_user_id[\s\S]*cd\.installation_id = v_new_installation_id/);
assert.match(migration, /cd\.voip_push_token = v_voip_push_token/);
assert.match(migration, /cd\.installation_id = v_legacy_installation_id/);
assert.match(migration, /and cd\.id <> v_device_id/);
assert.match(migration, /return query[\s\S]*v_token_bound[\s\S]*v_legacy_deactivated/);
assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.call_devices\b/i);

// Deterministic model: registration failure leaves legacy active; success
// transfers the token once, keeps unrelated devices, and repeat is idempotent.
const rows = [
  { id: 'legacy', installation: 'old', token: 'token-a', active: true },
  { id: 'other', installation: 'other-phone', token: 'token-b', active: true },
];
const repair = ({ succeed }) => {
  if (!succeed) return { tokenBound: false, rows: structuredClone(rows) };
  let target = rows.find(row => row.installation === 'new');
  if (!target) {
    target = { id: 'new-device', installation: 'new', token: null, active: true };
    rows.push(target);
  }
  for (const row of rows) {
    if (row.id !== target.id && row.token === 'token-a') {
      row.token = null;
      row.active = false;
    }
  }
  target.token = 'token-a';
  target.active = true;
  return { tokenBound: true, rows: structuredClone(rows) };
};

const failed = repair({ succeed: false });
assert.equal(failed.rows.find(row => row.id === 'legacy').active, true);
const first = repair({ succeed: true });
assert.equal(first.rows.find(row => row.id === 'legacy').active, false);
assert.equal(first.rows.find(row => row.id === 'new-device').token, 'token-a');
assert.equal(first.rows.find(row => row.id === 'other').active, true);
const second = repair({ succeed: true });
assert.equal(second.rows.filter(row => row.installation === 'new').length, 1);
assert.equal(second.rows.filter(row => row.active && row.token === 'token-a').length, 1);

console.log('IOS-C call device identity v2 tests: PASS');
