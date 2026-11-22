import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { closeSync, constants as fsConstants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { types } from 'node:util';
import { buildPrivateRuntimeClosure } from './nelyon-private-runtime-closure.mjs';
import {
  readTrustedB2HistoricalRuntimeClosure,
  readTrustedB2HistoricalDescriptorBytes,
  readTrustedB2RecoveryProvenance,
  readTrustedB2ChainProvenance,
} from './nelyon-b2-recovery-provenance.mjs';
import { createReleaseAuthorityContext, publicAuthorityReceipt, assertAuthorityReceiptMatch } from './nelyon-release-authority-context.mjs';
import { assertB2CatalogSecurityCoverage } from './nelyon-b2-source-parity.mjs';
import {
  advisorExceptionsForPhase,
  F5_SECURITY_ADVISOR_RELATION_ADDITIONS,
  normalizedCronCommandSha256,
  FINANCE_POLICY_DIGESTS,
  normalizeCronCommand,
  projectCronBaselineItems,
  projectProductionBaselineFinance,
  selectRecentCompletedBackup,
  validateWebControlCentersB1InstalledState,
  verifyAdminRecoveryInfrastructurePostState,
  verifyProductionAdminRecoverySnapshot,
  verifyProductionPreSnapshot,
  verifyProductionRecoverySnapshot,
  verifyProductionSnapshotPair,
  verifyCronSnapshotTransition,
  verifyRecoveryInfrastructureBaseline,
} from './nelyon-production-snapshot-adapter.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const GIT_CHILD_ENV_KEYS = Object.freeze([
  'CI', 'COMSPEC', 'GIT_OPTIONAL_LOCKS', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'LANG', 'LC_ALL',
  'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE',
]);

function gitChildEnvironment(environment = process.env) {
  const result = Object.create(null);
  for (const key of GIT_CHILD_ENV_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') {
      result[key] = descriptor.value;
    }
  }
  result.GIT_TERMINAL_PROMPT = '0';
  return result;
}

export const F3_FINANCE_AUTHORITY_TRANSITION = Object.freeze({
  "id": "creator-premium-f3-foundation-v1",
  "phase": "foundation_only",
  "baseline_sha": "238e987933c7198400534121e61fb3d2750ba5ba",
  "reviewed_source_sha": "aea1a8772ea0ca9c0ede94a9b1f103eaa200dccc",
  "integration_base_sha": "2d8bf717a011f3afe54af1df5cd0f991f94811f3",
  "approved_sha_ancestry": "verified_integration_base",
  "migration_path": "supabase/migrations/20261025011000_creator_premium_f3_bounded_financial_activation.sql",
  "migration_blob": "8d3e57ccf78de470c951fa4f43d2aeb6fd2233da",
  "migration_sha256": "b72c9d74368b4bcf54d120d76273154367922aaa4ff1876f828715b7cda54dc6",
  "function": "bdag-ledger",
  "function_path": "supabase/functions/bdag-ledger/index.ts",
  "function_blob": "d13817091912dc1d9f80d143f95b8676ce26162a",
  "function_source_sha256": "79e79bd31a62920401b8d55d48e1754ce58149294c8960c7995a070078b796f9",
  "config_blob": "7c3ff52db72f9983aa4128f5c2e7e686bba31d5d",
  "client_contract": "creator-premium-f3-v2",
  "client_sources": [
    {
      "path": "services/creatorPremiumFinanceContracts.mjs",
      "blob": "591a7d91de580c473af8812954ab806e1d4e01c7",
      "sha256": "422d20fdfde1d525d6fd34585257355f129cca9ac3a88ad6f351d2d8a2c38f7a"
    },
    {
      "path": "services/financial/ledgerClient.ts",
      "blob": "7c169e05d5d23bcb5e3834abfd559cd098602db1",
      "sha256": "bb3978856789dae33677592b4cd5c0b7f60030b9113cb3bc32032f1501f0f328"
    }
  ],
  "frozen_f2_parser": {
    "ref": "2d8bf717a011f3afe54af1df5cd0f991f94811f3",
    "path": "services/creatorPremiumFinanceContracts.mjs",
    "blob": "40e7fd7809ca61570b9c8c00d438f5e83021be45",
    "sha256": "e55a1c494a8055af1f0990bc096e043aa3c70de693fa85945c161bc6a61fdcc2"
  },
  "productive_paths": [
    "supabase/functions/bdag-ledger/index.ts",
    "supabase/migrations/20261025011000_creator_premium_f3_bounded_financial_activation.sql"
  ],
  "foundation_guards": [
    "creator_premium_finance_policy_f3_foundation_off_check",
    "creator_premium_finance_auth_f3_foundation_insert_guard"
  ],
  "requires_separate_baseline_promotion": true
});
export const F3_C2_FINANCE_AUTHORITY_TRANSITION = Object.freeze({
  id: 'creator-premium-f3-c2-governance-v1',
  from_phase: 'f3_foundation',
  to_phase: 'f3_c2',
  baseline_sha: '8908c4f9e6b5d48614301e51b16793ed7ae6f895',
  reviewed_source_sha: 'e692d932e1ce5f6f24b67205373db443f538a464',
  integration_base_sha: '0dace3e84031922a35f9213957bd77d886cf3b7a',
  approved_sha_ancestry: 'verified_integration_base',
  migration_path: 'supabase/migrations/20261025160452_creator_premium_f3_c2_isolated_canary_governance.sql',
  migration_blob: '0c3436a83df2804a4a33d41d0514c50239f5bcd2',
  migration_sha256: '0348d73b14afae63cb3f90bd22346cd1f607c7904a7c7285aa7daa2da7a901bc',
  productive_paths: [
    'supabase/migrations/20261025160452_creator_premium_f3_c2_isolated_canary_governance.sql',
  ],
  foundation_guards: [
    'creator_premium_finance_policy_f3_foundation_off_check',
    'creator_premium_finance_auth_f3_foundation_insert_guard',
  ],
  requires_separate_baseline_promotion: true,
});
export const F4_GENERAL_FINANCE_AUTHORITY_TRANSITION = Object.freeze({
  id: 'creator-premium-f4-general-bdag-activation-v1',
  from_phase: 'f3_c2',
  to_phase: 'f4_general',
  baseline_sha: '7721b50dafa6a54a131dd44ddad83ece250fe9e3',
  reviewed_source_sha: 'fc70374445471ad63411b6de3ea7fd86a6730bd6',
  integration_base_sha: 'aa31271700f54f8d3c27a9fa89b592d8b56ddad1',
  approved_sha_ancestry: 'verified_integration_base',
  migration_path: 'supabase/migrations/20261026030000_creator_premium_f4_general_bdag_activation.sql',
  migration_blob: '8197f838edd56d9b5e52c69f2b039bec4fbcc5f6',
  migration_sha256: 'da78d4f1a45b86692c82693af1a30373dfebfde4152a3ab16da9ddb6fd00b16e',
  productive_paths: [
    'supabase/migrations/20261026030000_creator_premium_f4_general_bdag_activation.sql',
  ],
  from_policy: {
    activation_mode: 'off',
    active_authorization_id: null,
    platform_fee_bps: 0,
    purchase_enabled: false,
    refunds_enabled: false,
    subscription_enabled: false,
  },
  to_policy: {
    activation_mode: 'general',
    active_authorization_id: 'f4000000-0000-4000-8000-000000000001',
    platform_fee_bps: 2000,
    purchase_enabled: true,
    refunds_enabled: true,
    subscription_enabled: true,
  },
  requires_separate_baseline_promotion: true,
});
export const F5_AUTONOMOUS_FINANCE_AUTHORITY_TRANSITION = Object.freeze({
  id: 'creator-premium-f5-autonomous-subscriptions-v1',
  from_phase: 'f4_general',
  to_phase: 'f5_autonomous',
  baseline_sha: '02c238618b05cd01c7388cc592ba7ac426973ce5',
  reviewed_source_sha: '94de72a46558aab408c0f4d062f80462fd17f116',
  integration_base_sha: '8b869746ea4bbc08fb79d42fe06f316849a7bfb9',
  approved_sha_ancestry: 'verified_integration_base',
  migration_path: 'supabase/migrations/20261026072512_creator_premium_f5_autonomous_subscriptions.sql',
  migration_blob: 'ca08f3a5224cea2ef6b4390bc625d55f378b2ca6',
  migration_sha256: '5975e535f4818981e076f4f8617caa8e357852a4926a3f1c8c5e8879712299f3',
  function: 'bdag-ledger',
  function_path: 'supabase/functions/bdag-ledger/index.ts',
  function_blob: 'e50f8109c6ec479483cb64f3da68812c446b0dda',
  function_source_sha256: 'de3d258f3b4db069a848418bd0b4921d32520cb56d133f918747699af48c53ed',
  config_blob: '7c3ff52db72f9983aa4128f5c2e7e686bba31d5d',
  client_contract: 'creator-premium-f3-v2',
  client_sources: [
    { path: 'services/creatorPremiumFinanceContracts.mjs', blob: '116068dcb37812721b5960af158fc249a225b6ee',
      sha256: '03774e0de62200f3734dc63a2995afdac02e19d4d8f6589995acca33c9a060b9' },
    { path: 'services/financial/ledgerClient.ts', blob: '01a8f7f622c78f637d15a8e3eadf4af71017a47b',
      sha256: '1f718c565a305366e614dc8905e87a5b1017832bcbdc416ad0d4e97d484e9c6f' },
    { path: 'services/creatorPremiumFinanceContracts.d.mts', blob: 'b89adf820f389147e9f1fdaa8fdc1c003bfd3bd0',
      sha256: '250d37537cc746e3eef726e72753c930dd1fe7d5f96a1afbdacfdd89e53aa107' },
    { path: 'services/creatorPremiumService.ts', blob: '5899c8d9564b8d7691f7a3266f8050ec13e18bb7',
      sha256: '979baec6879a6f8ce9fb579205e36cdd6a1f63da8eb17ee741b90739665ca7d7' },
  ],
  productive_paths: [
    'supabase/functions/bdag-ledger/index.ts',
    'supabase/migrations/20261026072512_creator_premium_f5_autonomous_subscriptions.sql',
  ],
  finance_policy: {
    activation_mode: 'general', active_authorization_id: 'f4000000-0000-4000-8000-000000000001',
    platform_fee_bps: 2000, purchase_enabled: true, refunds_enabled: true, subscription_enabled: true,
  },
  cron_job: {
    jobname: 'creator-premium-auto-renewals-f5', schedule: '*/5 * * * *', database: 'postgres',
    username: 'postgres', active: true,
    command: 'select private.process_creator_premium_auto_renewals_f5_v1(25);',
    normalized_command_sha256: '31518881633261ec69720f0604f35d81c2b784db4a24a87c32d9d696304173f1',
  },
  requires_separate_baseline_promotion: true,
});
export const STORIES_B1_SECURITY_NEGATIVE_AUTHORIZATION_EVIDENCE = Object.freeze({
  version: 'stories-v2-interactive-b1-security-negative-authorization-v1',
  migration_path: 'supabase/migrations/20261027042552_stories_v2_interactive_b1.sql',
  test_paths: [
    'tests/nelyonProductionSnapshotAdapter.test.mjs',
    'tests/storiesV2InteractiveB1Database.test.mjs',
  ],
  cases: [
    { actor: 'anon', expected: 'rpc_and_relation_acl_denied' },
    { actor: 'authenticated_non_owner', expected: 'domain_authority_denied' },
    { actor: 'authenticated_owner', expected: 'bounded_operation_only' },
    { actor: 'service_role', expected: 'legacy_wrapper_or_server_pipeline_only' },
    { actor: 'authenticated_replay', expected: 'idempotent_single_effect' },
    { actor: 'authenticated_after_expiry', expected: 'story_expired' },
  ],
});
export const STORIES_B1_SECURITY_NEGATIVE_AUTHORIZATION_EVIDENCE_SHA256 = sha256Hex(
  canonicalJson(STORIES_B1_SECURITY_NEGATIVE_AUTHORIZATION_EVIDENCE),
);

const STORIES_B1_ORIGIN = Object.freeze({
  migration: '20261027042552_stories_v2_interactive_b1',
  migration_blob: '9b7d8ce8b1e375d1f4b4a1dfde8c1ec032d23ae4',
  source_sha: 'c4e75f63e67433f032212852349626f755e9d2de',
});
const STORIES_B1_OWNER_ACL = Object.freeze(
  ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
    .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })),
);
const storyB1TableException = (advisor_fingerprint, name) => ({
  advisor_fingerprint,
  advisor_type: 'table',
  advisor_severity: 'INFO',
  object: { schema: 'private', name },
  attestation: {
    owner: 'postgres',
    rls_enabled: true,
    force_rls: true,
    acl: STORIES_B1_OWNER_ACL.map(item => ({ ...item })),
  },
  authorization: {
    functional_reason: 'Stores private Stories B1 authority state behind owner-only ACL and FORCE RLS; access is mediated by bounded server RPCs.',
    controls: ['force_rls', 'negative_authorization_tests', 'owner_only_acl', 'private_schema', 'server_rpc_only'],
    negative_test_evidence_sha256: STORIES_B1_SECURITY_NEGATIVE_AUTHORIZATION_EVIDENCE_SHA256,
  },
  origin: { ...STORIES_B1_ORIGIN },
  technical_approval: 'verified',
});
const storyB1RpcException = ({
  advisor_fingerprint,
  name,
  argument_types,
  identity_arguments,
  definition_sha256,
  service_role = false,
}) => ({
  advisor_fingerprint,
  advisor_type: 'authenticated_security_definer_function_executable',
  advisor_severity: 'WARN',
  object: { schema: 'public', name, argument_types, identity_arguments },
  attestation: {
    security_definer: true,
    owner: 'postgres',
    search_path: ['search_path=""'],
    acl: [
      { grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false },
      { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ...(service_role
        ? [{ grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }]
        : []),
    ],
    execute: { anon: false, authenticated: true, public: false, service_role },
    definition_sha256,
  },
  authorization: {
    functional_reason: 'Exposes a bounded authenticated Stories operation while retaining ownership, visibility, expiry, idempotency, moderation, and rate-limit checks server-side.',
    controls: ['authenticated_session', 'domain_authority_checks', 'negative_authorization_tests', 'server_side_validation'],
    negative_test_evidence_sha256: STORIES_B1_SECURITY_NEGATIVE_AUTHORIZATION_EVIDENCE_SHA256,
  },
  origin: { ...STORIES_B1_ORIGIN },
  technical_approval: 'verified',
});
const STORIES_B1_SECURITY_ADVISOR_TRANSITION = Object.freeze({
  introduced_exceptions: [
    storyB1TableException('186ff09e7098d14e92b174eab02d28581cdb3fa96c827aaae5d68b4dd5851358', 'story_analytics_events'),
    storyB1TableException('c082a5b2e8e3d61079830d093086f13bffb9aa2db7b995ff6d1f760a627621fb', 'story_b1_worker_lane_state'),
    storyB1TableException('fbc12c0778e1f330784e5218fe36cd8ddfea0d9a631e4dee6ce11267ece5565d', 'story_interactive_elements'),
    storyB1TableException('2eda0da977ce4d7c878e2c9b7b4ce4d35956aaaac366c555f030f1f504f32fb5', 'story_interactive_responses'),
    storyB1TableException('02f70259c8630d617662e0f414f90c8911232232732206c89ce5ac05505c80e3', 'story_operation_policy'),
    storyB1TableException('cc5a7b318440e0c5f395434404b5cc422a35aa5b03b2b972c57d75a514a9a961', 'story_safety_state'),
    storyB1RpcException({
      advisor_fingerprint: 'e023793e926627cbbbeabe0e5e23b22d1db7c60fdb4a4cf9922be2b35c28e43e',
      name: 'create_story_from_content',
      argument_types: ['uuid', 'jsonb', 'uuid', 'jsonb'],
      identity_arguments: 'p_video_id uuid, p_composition jsonb, p_client_story_id uuid, p_interactive_definitions jsonb',
      definition_sha256: '5b6c6cd3d6a1f86dd5e2b0b888cc67798dbfeb30bef12ab7cc699f0f15497e01',
    }),
    storyB1RpcException({
      advisor_fingerprint: 'd7e531c4fba0d02da9a666b26ea960d27837a699415c5ac1c3c89eb41766d510',
      name: 'create_story_with_media', argument_types: ['uuid'], identity_arguments: 'p_asset_id uuid',
      definition_sha256: '136f73f1b9f3e376cf4cf3022d1572912678bf05f9d9c2ee1c04fdbaca8a778d', service_role: true,
    }),
    storyB1RpcException({
      advisor_fingerprint: '4372ff9ba19d85901be4b83b6fff6b6d5668b5fc90dcaeec39c7b592c99fc8ff',
      name: 'create_story_with_media', argument_types: ['uuid', 'jsonb', 'uuid'],
      identity_arguments: 'p_asset_id uuid, p_composition jsonb, p_client_story_id uuid',
      definition_sha256: '27d0de28edff7afc83b02390421f7a3663187644a534228080ad50a9acc594b3', service_role: true,
    }),
    storyB1RpcException({
      advisor_fingerprint: 'e2ccf267fa8e3420ee8c9070607243f35523e0e1cb9a0d66e05ff7596a18c747',
      name: 'create_story_with_media', argument_types: ['uuid', 'jsonb', 'uuid', 'jsonb'],
      identity_arguments: 'p_asset_id uuid, p_composition jsonb, p_client_story_id uuid, p_interactive_definitions jsonb',
      definition_sha256: 'f584e1899eb14709546e50d0c90a82f1be7112c2b1501a72757e983e1834b497',
    }),
    storyB1RpcException({
      advisor_fingerprint: '3a12c5201d6f193ab09a1d9dd0fcc7edd8d2de6833ffaa9a7b3442096b21c302',
      name: 'get_story_interactive_results',
      argument_types: ['uuid', 'uuid', 'integer', 'timestamp with time zone', 'uuid'],
      identity_arguments: 'p_story_id uuid, p_element_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_respondent_id uuid',
      definition_sha256: '60bfb01e8254a016a428a5a7d9ed8e7a4fc392bd5b67a97a84e6e270fdd8be22',
    }),
    storyB1RpcException({
      advisor_fingerprint: '30f89b13ad41bd7db1630ee0d452f5546ff901e0c3986e35549a8adb3fe5cc46',
      name: 'get_story_interactive_state', argument_types: ['uuid'], identity_arguments: 'p_story_id uuid',
      definition_sha256: 'a460242424186b2229e9e2c24c3472c31ae23d05a7ba9442408a70ea280abe15',
    }),
    storyB1RpcException({
      advisor_fingerprint: 'fcea83f01492a208ea21a68e14fcd4d8f28027e2bbeecb6a9a5bd1fc295acdc1',
      name: 'moderate_story_question', argument_types: ['uuid', 'uuid', 'uuid', 'text'],
      identity_arguments: 'p_story_id uuid, p_element_id uuid, p_respondent_id uuid, p_action text',
      definition_sha256: 'd9a0157bedc9e4f0529ad8c7f1981af1606e7fd05c1a3f0cade603b4f14fc7ee',
    }),
    storyB1RpcException({
      advisor_fingerprint: 'c7ef8314fc6979b4d081375881a37c64f7e7241082a6125ae07e75ee81fb2007',
      name: 'record_story_event', argument_types: ['uuid', 'text', 'uuid'],
      identity_arguments: 'p_story_id uuid, p_event_type text, p_event_id uuid',
      definition_sha256: '348b79e75614e7fd42bc136c7e3eac93cd3cbe7475f983428ff75326d24886f8',
    }),
    storyB1RpcException({
      advisor_fingerprint: 'f41e771230d466749fae7ce825436a3fd93878ceb68a7dfc43b4392e976ac26d',
      name: 'respond_to_story_element', argument_types: ['uuid', 'uuid', 'uuid', 'jsonb'],
      identity_arguments: 'p_story_id uuid, p_element_id uuid, p_idempotency_key uuid, p_payload jsonb',
      definition_sha256: '634d5c415eef8147a43780dd81b4d75f8fcb77645c74dbfe2c1460c23cf1df70',
    }),
  ],
  removed_findings: [
    {
      fingerprint: '9b4cde0225530c588b9832739ad2b8a131ef6f4b408cdd760da9301deda6c000',
      level: 'WARN', resource_kind: 'authenticated_security_definer_function_executable',
      object: { schema: 'public', name: 'create_story_with_media', argument_types: ['uuid'], identity_arguments: 'p_asset_id uuid', old_language: 'sql' },
      replacement: { fingerprint: 'd7e531c4fba0d02da9a666b26ea960d27837a699415c5ac1c3c89eb41766d510', language: 'plpgsql', definition_sha256: '136f73f1b9f3e376cf4cf3022d1572912678bf05f9d9c2ee1c04fdbaca8a778d' },
      origin: { ...STORIES_B1_ORIGIN },
    },
    {
      fingerprint: 'bd8275738ba7f668dc16573d7454a0f722d3507bbc196c3aa0a6f30dcaf87f01',
      level: 'WARN', resource_kind: 'authenticated_security_definer_function_executable',
      object: { schema: 'public', name: 'create_story_with_media', argument_types: ['uuid', 'jsonb', 'uuid'], identity_arguments: 'p_asset_id uuid, p_composition jsonb, p_client_story_id uuid', old_language: 'sql' },
      replacement: { fingerprint: '4372ff9ba19d85901be4b83b6fff6b6d5668b5fc90dcaeec39c7b592c99fc8ff', language: 'plpgsql', definition_sha256: '27d0de28edff7afc83b02390421f7a3663187644a534228080ad50a9acc594b3' },
      origin: { ...STORIES_B1_ORIGIN },
    },
  ],
});

export const STORIES_B1_RELEASE_TRANSITION = Object.freeze({
  id: 'stories-v2-interactive-b1-infrastructure-v1',
  from_phase: 'stories_v2_legacy',
  to_phase: 'stories_v2_interactive_b1_fail_closed',
  baseline_sha: 'd8c3847b14486f249d9d8fa83aa74c8cff37bf6b',
  reviewed_source_sha: 'c4e75f63e67433f032212852349626f755e9d2de',
  integration_base_sha: '9a436857664c1862c6f16807d45834f107076380',
  approved_sha_ancestry: 'verified_integration_base',
  migration_path: 'supabase/migrations/20261027042552_stories_v2_interactive_b1.sql',
  migration_blob: '9b7d8ce8b1e375d1f4b4a1dfde8c1ec032d23ae4',
  migration_sha256: 'c152091e602efeec21ad89f94ce20301def0a76d3a3e9383f8b10dd4f45f709d',
  config_blob: '7c3ff52db72f9983aa4128f5c2e7e686bba31d5d',
  productive_paths: [
    'supabase/functions/_shared/premiumStreamSecurity.ts',
    'supabase/functions/cleanup-stale-media-uploads/index.ts',
    'supabase/functions/content-safety-scan/audioPipeline.mjs',
    'supabase/functions/content-safety-scan/index.ts',
    'supabase/functions/create-media-upload/index.ts',
    'supabase/functions/create-stream-upload/index.ts',
    'supabase/functions/get-stream-playback/index.ts',
    'supabase/functions/stream-webhook/index.ts',
    'supabase/migrations/20261027042552_stories_v2_interactive_b1.sql',
  ],
  path_attestations: [
    { path: 'supabase/functions/_shared/premiumStreamSecurity.ts', blob: 'fa0da71f350a7f43a19a8ebb42d6e62afa09e757', sha256: '884216642a3e82528f9db6842fa786f1fa932c4a125a56f98de4701582c0baf4' },
    { path: 'supabase/functions/cleanup-stale-media-uploads/index.ts', blob: '5012a083b0729a3362422f2e951371b849462406', sha256: '33f6ef335c29dd7369b174ac10b657e230c431c2aaaeb58922b1517233b6eb2f' },
    { path: 'supabase/functions/content-safety-scan/audioPipeline.mjs', blob: '70ac9bf3a1f0db98b616acd2556003de29995ca7', sha256: '568e3f21a9af69e6e5c6b5d3e04a03e4fe77bcb76df1b7f9a6161339000b8322' },
    { path: 'supabase/functions/content-safety-scan/index.ts', blob: '80a32f5b51d1eb037cf23cb6f96243bce40ad6d3', sha256: '5d044c389d86581bdcaf5e705371485dc405e660b8ea2637063ec12dfd5001f9' },
    { path: 'supabase/functions/create-media-upload/index.ts', blob: '99c62f2e424bc9a0522dfa3a6ea96a538012c165', sha256: 'b7426b7866cc6ce4ceecbf92641c142c3bc6645778b41a202c8d5ec27048c3b5' },
    { path: 'supabase/functions/create-stream-upload/index.ts', blob: 'ba3bc8237169a150b8d6fbfd6f9196316aa2d657', sha256: '48f8533ebd6de53e590414c6ec6585622170f2befc0d8082d346c518521f4a90' },
    { path: 'supabase/functions/get-stream-playback/index.ts', blob: '16a252edb5b30e2d5d62fef14189ebfe797cce60', sha256: '89a6b98cc34f35f3def712dc30772b2a4c672d42eaa6e35e38ca6149019b8632' },
    { path: 'supabase/functions/stream-webhook/index.ts', blob: '10b51e63ebab9e88b88ab4b534e2dc2c0e3b3df9', sha256: '6a1595bdc06a0cc864074b09b9756b0410cc2e7f91ba5bbbe14da27b30fbe90a' },
    { path: 'supabase/migrations/20261027042552_stories_v2_interactive_b1.sql', blob: '9b7d8ce8b1e375d1f4b4a1dfde8c1ec032d23ae4', sha256: 'c152091e602efeec21ad89f94ce20301def0a76d3a3e9383f8b10dd4f45f709d' },
  ],
  functions: [
    { name: 'cleanup-stale-media-uploads', source_sha256: '991f0654142513bb434169dc58487dedaccb52d75f049e6644edaf838ebfec2c', verify_jwt: false },
    { name: 'content-safety-scan', source_sha256: '88cd6b7dc2acc1eae981e97b6a7d6abaf5683a66d41092359d6647281fc784d3', verify_jwt: true },
    { name: 'create-media-upload', source_sha256: '00bb7b3de834baa5b9d5b1b8ce89bb8e5a0a327fff6a2a14393f3a36f68188d9', verify_jwt: true },
    { name: 'create-stream-upload', source_sha256: '437106a0b2f1dabb72fd6c6a497049f7fbb200818057bb13ff19d970954299cf', verify_jwt: true },
    { name: 'get-stream-playback', source_sha256: '491ba432a35e930b9908f240b61ee80545fc0b07841fecc116ee4d38e12f4762', verify_jwt: true },
    { name: 'stream-webhook', source_sha256: '3333e33d58c4682ab49b52207cd5993bb79005dd068d367c29f696c2b87a1525', verify_jwt: false },
  ],
  security_advisor: STORIES_B1_SECURITY_ADVISOR_TRANSITION,
  safety: {
    activation: false,
    complete_evidence_state: 'review',
    fabricated_pass_allowed: false,
    incomplete_evidence_state: 'pending',
    mode: 'fail_closed_review',
    owner_approved_policy: false,
    physical_readiness_claim_allowed: false,
  },
  finance_policy: {
    platform_fee_bps: 2000,
    purchase_enabled: true,
    refunds_enabled: true,
    subscription_enabled: true,
  },
  requires_separate_baseline_promotion: true,
});

export const STORIES_SAFETY_C2_RELEASE_TRANSITION = Object.freeze({
  "id": "stories-v2-safety-c2-publish-first-async-review-v1",
  "from_phase": "stories_v2_safety_c1_technical_prep_fail_closed",
  "to_phase": "stories_v2_safety_c2_publish_first_async_review",
  "baseline_sha": "e4c7199da157446f455822ea96e812784354b1db",
  "reviewed_source_sha": "244d458bb55b73782f4e7a32004b764ce622702e",
  "integration_base_sha": "25ce25cd23226af0ff729adc618380436d432501",
  "approved_sha_ancestry": "verified_integration_base",
  "migration_path": "supabase/migrations/20261027191918_stories_v2_safety_c2_publish_first_async_review.sql",
  "migration_blob": "a621158297c9d75b56fe739f1c7dd72c8b786c97",
  "migration_sha256": "4f83efa4087650788f4a975d88489a3d407a66cc421c951da6cd77c1ec8701d1",
  "productive_paths": [
    "supabase/functions/get-stream-playback/index.ts",
    "supabase/migrations/20261027191918_stories_v2_safety_c2_publish_first_async_review.sql"
  ],
  "path_attestations": [
    {
      "path": "supabase/functions/get-stream-playback/index.ts",
      "blob": "1e1d63a7585ea4d2aff4e42cd985b560976f6f7d",
      "sha256": "1d9bde70fdd575503b75819b0776029990ec786691f89e2f26bd185953ef23d5"
    },
    {
      "path": "supabase/migrations/20261027191918_stories_v2_safety_c2_publish_first_async_review.sql",
      "blob": "a621158297c9d75b56fe739f1c7dd72c8b786c97",
      "sha256": "4f83efa4087650788f4a975d88489a3d407a66cc421c951da6cd77c1ec8701d1"
    }
  ],
  "functions": [
    {
      "name": "get-stream-playback",
      "source_sha256": "2b790fa26aa2dadb025c55365340f8dd3085f37cc839040055b3254bf31bdfd9",
      "verify_jwt": true
    }
  ],
  "config_changed": false,
  "policy_artifact": {
    "path": "docs/stories-v2-content-safety-policy-publish-first-v1.json",
    "blob": "054d4b58d81028fbd05dfa29e24326196db65f70",
    "sha256": "cda5960571c33b88e3b22a7d442aeb6b5cee9250b2d0a298b8907a72ba083fcf",
    "policy_id": "nelyon.stories.general.safety.publish_first.v1"
  },
  "preserved_paths": [
    {
      "path": "supabase/functions/content-safety-scan/index.ts",
      "blob": "80a32f5b51d1eb037cf23cb6f96243bce40ad6d3",
      "sha256": "5d044c389d86581bdcaf5e705371485dc405e660b8ea2637063ec12dfd5001f9"
    },
    {
      "path": "supabase/functions/content-safety-scan/audioPipeline.mjs",
      "blob": "70ac9bf3a1f0db98b616acd2556003de29995ca7",
      "sha256": "568e3f21a9af69e6e5c6b5d3e04a03e4fe77bcb76df1b7f9a6161339000b8322"
    },
    {
      "path": "supabase/config.toml",
      "blob": "7c3ff52db72f9983aa4128f5c2e7e686bba31d5d",
      "sha256": "22ba64183c399f012593bef27ed5795065dc741a90808268bc7dbb23582d5959"
    }
  ],
  "helper_attestations": [
    {
      "identity": "private.content_safety_target_snapshot(text,uuid)",
      "definition_sha256": "28a12d9cf823eeebe68017a687f038a68e926bcc9dbb63101f3a0405f8b1a04b",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.content_safety_visual_source(text,uuid)",
      "definition_sha256": "7006dbf8f506852b9a251a891d0329f64f22383a54a5b7e89d4873e152f5666d",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.create_story_from_content_core_c2_v1(uuid,jsonb,uuid)",
      "definition_sha256": "8c757c4cadd266046a64b21a260383bcc7edbf6771eb3b328bd9dcacb71d019c",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.enqueue_content_safety_scan(text,uuid,text)",
      "definition_sha256": "76020c7fd4cd68169f2e9fc9596a7fcca0e9f6468547d3dd62ed4b24e0d775bb",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_alert_moderation_c2_v1()",
      "definition_sha256": "3c4c634352705652eab1beb0a27fe67f845bcfc7495e3a03f78de17562afeba1",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_author_text_bundle_c1_v1(uuid)",
      "definition_sha256": "cb4e87cd6da0de3d3aa67c66a30b561ccdb68fbec24e0a9264779400ec840a73",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_can_access(uuid,boolean)",
      "definition_sha256": "d2d480bc91190028718f09468c5bed7f72727cf7e036b3dbad5cccbe7e99abbc",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": true,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_content_safety_candidate_c1_v1(uuid)",
      "definition_sha256": "6eb36a146908d378eeebdb0ca7a24f33ac1cb3876213bafb74f79ccfb2b0be9d",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_content_safety_control_c1_v1()",
      "definition_sha256": "eeb34ea22b46c7373915083212e6f82bcb34afdf1921db956d9221529156d379",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_content_safety_control_c2_v1()",
      "definition_sha256": "5396053f90cb7c494fda5f8aadd1e2a28d9288674f13fc05411c59024421889f",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_content_safety_policy_c1_v1()",
      "definition_sha256": "2e7881a96094970ef987c41dd6166e55c027757a3dacd7d3035cec0b192a5b5a",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_content_safety_policy_c2_v1()",
      "definition_sha256": "50a1e9384a43def5f9ab20a4d01a773dcb244a47bd13b8e4243d2272da041d77",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_current_fingerprint(uuid)",
      "definition_sha256": "c2b07454cd20c94c9b669fc1b662daede4a89b0a64fd1954eae651e1e2c30014",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_enqueue_media_safety_v1(uuid)",
      "definition_sha256": "9be19b0ae8f8232f68d47202fc5e2a33a2548c5c68ed59b5021221e8cd0f2ca9",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_initialize_safety()",
      "definition_sha256": "9f8b209bc4c1a5b1da9281b949ab18af3c0326e1738e5333af7adf4ae9d8213f",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_publish_c2_v1(uuid,uuid)",
      "definition_sha256": "a68c8e7cea00e2959ed5be286f4b40673951e41f3298d9018cf92068abe6bb98",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_refresh_safety_from_transcript_c1_v1()",
      "definition_sha256": "56dd495f6fe8197f234c2d5ca55134f0f529b9a949ce7c61dae73c42d6910dcb",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_runtime_status_c2_v1(uuid)",
      "definition_sha256": "24f3afedef669a9aa3064b7080e6c6d05a31af2932af98b742b9beb108147bfe",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "private.story_sync_safety_from_scan_v1()",
      "definition_sha256": "5d07e049fbbe595239f09f39561d820d267d176ca8f3d2834613e7d44e96fb26",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": false,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "public.admin_moderate_story(uuid,text,text,uuid)",
      "definition_sha256": "35302740034ba636eba83f0a0ace03b7f1aa124cb2ffd1af4e6ef57db7a81ac4",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": true,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "public.create_story_from_content(uuid,jsonb,uuid,jsonb)",
      "definition_sha256": "26ab9b07eb16a4409d42bb59a3266af552ead619fc02aa12ff153a6dd905ca7f",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": true,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "public.create_story_from_content(uuid,jsonb,uuid)",
      "definition_sha256": "82632e1f2b891ff7e435ad4d5e80186fdf78a64b1092d549d8ab4863eb78f4fe",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": true,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "public.create_story_with_media(uuid,jsonb,uuid,jsonb)",
      "definition_sha256": "88457706580fb314cc484aa52574da009e77bff9084284828dac1b49c99845eb",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": true,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "public.create_story_with_media(uuid,jsonb,uuid)",
      "definition_sha256": "ce887696a60e9f52031334a3779d8132d69efb4ad8e37e8fe719ab9939e0ff1b",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": true,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "public.create_story_with_media(uuid)",
      "definition_sha256": "99c9e0cbc57d72b9da4f9fa304f570ba2142a0d84fdc0bcd8be5ada29239a98b",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": true,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "public.get_admin_story_detail(uuid)",
      "definition_sha256": "9e4f1e31cd4203b8bf5468c83052f93cc6b05a5ef31496e9da19476d78ee0314",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": true,
        "public": false,
        "service_role": false
      }
    },
    {
      "identity": "public.search_admin_stories(text,text,uuid,timestampwithtimezone,uuid,integer)",
      "definition_sha256": "d547adb94693ba5ef2a6975f8175372f0146b8c57e0c1d3a3bbfae527d7db96e",
      "owner": "postgres",
      "security_definer": true,
      "search_path": [
        "search_path=\"\""
      ],
      "execute": {
        "anon": false,
        "authenticated": true,
        "public": false,
        "service_role": false
      }
    }
  ],
  "trigger_attestation": {
    "name": "content_safety_story_transcript_refresh_c1",
    "table": "private.content_safety_audio_transcripts",
    "enabled": "O",
    "definition_sha256": "5af6160fc3312ff676295ec876b7b5d1d75fef56e9b81a70aa99028626252de5",
    "function_identity": "private.story_refresh_safety_from_transcript_c1_v1()"
  },
  "alert_trigger_attestation": {
    "name": "content_safety_story_alert_moderation_c2",
    "table": "private.content_safety_alerts",
    "enabled": "O",
    "definition_sha256": "60c9698dc0ee608138902fb5be1440185233e6cc523a54d8c054464fcf87d4dd",
    "function_identity": "private.story_alert_moderation_c2_v1()"
  },
  "initialization_trigger_attestation": {
    "name": "story_initialize_safety",
    "table": "public.stories",
    "enabled": "O",
    "definition_sha256": "a87b90beba3fc21c799de14b6578329fd3b73340d66dc66afc8a0f2a8e989e94",
    "function_identity": "private.story_initialize_safety()"
  },
  "column_attestations": [
    {
      "name": "moderated_at",
      "type": "timestamp with time zone",
      "default": null,
      "not_null": false
    },
    {
      "name": "moderation_actor_id",
      "type": "uuid",
      "default": null,
      "not_null": false
    },
    {
      "name": "moderation_reason",
      "type": "text",
      "default": null,
      "not_null": false
    },
    {
      "name": "moderation_status",
      "type": "text",
      "default": "'unreviewed'::text",
      "not_null": true
    },
    {
      "name": "publication_policy_id",
      "type": "text",
      "default": null,
      "not_null": false
    },
    {
      "name": "publication_status",
      "type": "text",
      "default": "'unpublished'::text",
      "not_null": true
    },
    {
      "name": "published_at",
      "type": "timestamp with time zone",
      "default": null,
      "not_null": false
    }
  ],
  "safety": {
    "activation": true,
    "owner_approved_operating_model": true,
    "owner_approved_policy": false,
    "mode": "PUBLISH_FIRST_ASYNC_REVIEW",
    "automatic_allow_authorized": false,
    "automatic_block_authorized": false,
    "numeric_thresholds": null,
    "historical_backfill": false
  },
  "finance_policy": {
    "platform_fee_bps": 2000,
    "purchase_enabled": true,
    "refunds_enabled": true,
    "subscription_enabled": true
  },
  "requires_separate_baseline_promotion": true
});

export const STORIES_QA_C1_RELEASE_TRANSITION = Object.freeze({"id":"stories-v2-qa-c1-question-answer-v1","from_phase":"stories_v2_safety_c2_publish_first_async_review","to_phase":"stories_v2_qa_c1_question_answer","baseline_sha":"c1c3043b24abe898a4400f858d646a2f788ee201","reviewed_source_sha":"3b7652e9ae7d9c66ce3f06286f738a724f3a9cd5","integration_base_sha":"10c549ac0dd84d28ccd832264184619ec56ba97f","approved_sha_ancestry":"verified_integration_base","migration_path":"supabase/migrations/20261029042807_stories_v2_qa_c1_question_answer_authority.sql","migration_blob":"b1f025b12f6d4e9fadf178630ee0e46c283bbd1c","migration_sha256":"7bd4afded4f6e0b36fa702c1eb83eedfed42f7b502ee9e2f97ada7121a1cf73c","migration_byte_length":24537,"productive_paths":["supabase/migrations/20261029042807_stories_v2_qa_c1_question_answer_authority.sql"],"functions":[],"config_changed":false,"helper_attestations":[{"identity":"private.story_validate_composition(jsonb)","definition_sha256":"2d16a92c6a3dd33fe85d96e14578917922be5ab68f5fe0e9c235e7c81b1b6069","owner":"postgres","volatility":"i","security_definer":false,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":false,"public":false,"service_role":false}},{"identity":"private.story_author_text_bundle_c1_v1(uuid)","definition_sha256":"28e76f502eaae19a0e74f43a96edaf29571088868e5f19fed31caf0547c52af0","owner":"postgres","volatility":"s","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":false,"public":false,"service_role":false}},{"identity":"private.story_question_answer_source_qa_c1_v1(uuid,uuid,uuid)","definition_sha256":"123f625492ac7a6b1c9480a8a1b3798a3ac6f18a895b2872c2ad01d334eadea5","owner":"postgres","volatility":"s","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":false,"public":false,"service_role":false}},{"identity":"public.prepare_story_question_answer(uuid,uuid,uuid)","definition_sha256":"8c9cf9f018d577e93c82354307bb0d6e8d0503c3a548c8fed66ad216a4d285d3","owner":"postgres","volatility":"s","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb)","definition_sha256":"4d1bfef144382ae5a67a5d1b665a1f64a559d4a45cba93aadd3b8399cf65afbd","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"private.story_check_question_answer_link_qa_c1_v1()","definition_sha256":"e4e1a93d081cf53680b5eb54c593c92d35b48bf1dc2c2bc842f1ab9b13d5470d","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":false,"public":false,"service_role":false}},{"identity":"public.create_story_with_media(uuid,jsonb,uuid)","definition_sha256":"0b204e2add3b8f2c38b29b6f1e7f33e661783abb2cdf8838d8172d54184fb3d1","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"public.create_story_with_media(uuid,jsonb,uuid,jsonb)","definition_sha256":"0171be4b3d51e3746fee472eea356306e0decbdb5d7dce35770b727a8e75901e","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"public.create_story_from_content(uuid,jsonb,uuid)","definition_sha256":"fa070316fdf7fd91770d711fefd4248c0286164899dfdcc20fbf58f1e9a78413","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"public.create_story_from_content(uuid,jsonb,uuid,jsonb)","definition_sha256":"1876897fd6665ed9528acb3306ecbc41d81111599753359bfa6d882cccf84a89","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}}],"c2_helper_replacements":["private.story_author_text_bundle_c1_v1(uuid)","public.create_story_with_media(uuid,jsonb,uuid)","public.create_story_with_media(uuid,jsonb,uuid,jsonb)","public.create_story_from_content(uuid,jsonb,uuid)","public.create_story_from_content(uuid,jsonb,uuid,jsonb)"],"rpc_replacements":["public.create_story_with_media(uuid,jsonb,uuid)","public.create_story_with_media(uuid,jsonb,uuid,jsonb)","public.create_story_from_content(uuid,jsonb,uuid)","public.create_story_from_content(uuid,jsonb,uuid,jsonb)"],"rpc_predecessor_exception":{"advisor_fingerprint":"010c78c43ba2cb32439c48ef8433d2706776f45f128fc2aa0572eb3b15377a14","advisor_type":"authenticated_security_definer_function_executable","advisor_severity":"WARN","object":{"schema":"public","name":"create_story_from_content","argument_types":["uuid","jsonb","uuid"],"identity_arguments":"p_video_id uuid, p_composition jsonb, p_client_story_id uuid"},"attestation":{"security_definer":true,"owner":"postgres","search_path":["search_path=\"\""],"acl":[{"grantee":"authenticated","privilege_type":"EXECUTE","is_grantable":false},{"grantee":"postgres","privilege_type":"EXECUTE","is_grantable":false}],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false},"definition_sha256":"82632e1f2b891ff7e435ad4d5e80186fdf78a64b1092d549d8ab4863eb78f4fe"},"authorization":{"functional_reason":"Exposes a bounded authenticated Stories operation while retaining ownership, visibility, expiry, idempotency, moderation, and rate-limit checks server-side.","controls":["authenticated_session","domain_authority_checks","negative_authorization_tests","server_side_validation"],"negative_test_evidence_sha256":"b55e754403fdfc3b225270e105741e3dbb397817148e64c5a37cd76794b9465b"},"origin":{"migration":"20261027191918_stories_v2_safety_c2_publish_first_async_review","migration_blob":"a621158297c9d75b56fe739f1c7dd72c8b786c97","source_sha":"244d458bb55b73782f4e7a32004b764ce622702e"},"technical_approval":"verified"},"relation_attestation":{"schema":"private","name":"story_question_answer_links","owner":"postgres","rls_enabled":true,"force_rls":true,"policy_count":0,"realtime_membership_count":0,"acl":[{"grantee":"postgres","privilege_type":"DELETE","is_grantable":false},{"grantee":"postgres","privilege_type":"INSERT","is_grantable":false},{"grantee":"postgres","privilege_type":"MAINTAIN","is_grantable":false},{"grantee":"postgres","privilege_type":"REFERENCES","is_grantable":false},{"grantee":"postgres","privilege_type":"SELECT","is_grantable":false},{"grantee":"postgres","privilege_type":"TRIGGER","is_grantable":false},{"grantee":"postgres","privilege_type":"TRUNCATE","is_grantable":false},{"grantee":"postgres","privilege_type":"UPDATE","is_grantable":false}],"columns":[{"position":1,"name":"story_id","type":"uuid","not_null":true,"default":null},{"position":2,"name":"source_story_id","type":"uuid","not_null":true,"default":null},{"position":3,"name":"source_element_id","type":"uuid","not_null":true,"default":null},{"position":4,"name":"respondent_id","type":"uuid","not_null":true,"default":null},{"position":5,"name":"request_hash","type":"text","not_null":true,"default":null},{"position":6,"name":"created_at","type":"timestamp with time zone","not_null":true,"default":"clock_timestamp()"}],"constraints":[{"name":"story_question_answer_links_pkey","type":"p","definition":"PRIMARY KEY (story_id)","columns":["story_id"],"valid":true,"deferrable":false,"initially_deferred":false},{"name":"story_question_answer_links_request_hash_check","type":"c","definition":"CHECK (request_hash ~ '^[a-f0-9]{64}$'::text)","columns":["request_hash"],"valid":true,"deferrable":false,"initially_deferred":false},{"name":"story_question_answer_links_source_story_id_source_element_fkey","type":"f","definition":"FOREIGN KEY (source_story_id, source_element_id, respondent_id) REFERENCES private.story_interactive_responses(story_id, element_id, respondent_id) ON DELETE CASCADE","columns":["source_story_id","source_element_id","respondent_id"],"referenced_relation":"private.story_interactive_responses","referenced_columns":["story_id","element_id","respondent_id"],"update_action":"a","delete_action":"c","valid":true,"deferrable":false,"initially_deferred":false},{"name":"story_question_answer_links_story_id_fkey","type":"f","definition":"FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE","columns":["story_id"],"referenced_relation":"public.stories","referenced_columns":["id"],"update_action":"a","delete_action":"c","valid":true,"deferrable":false,"initially_deferred":false}],"indexes":[{"name":"story_question_answer_links_pkey","definition":"CREATE UNIQUE INDEX story_question_answer_links_pkey ON private.story_question_answer_links USING btree (story_id)","columns":["story_id"],"unique":true,"primary":true,"valid":true,"ready":true,"predicate":null,"expression":null},{"name":"story_question_answer_links_source","definition":"CREATE INDEX story_question_answer_links_source ON private.story_question_answer_links USING btree (source_story_id, source_element_id, respondent_id)","columns":["source_story_id","source_element_id","respondent_id"],"unique":false,"primary":false,"valid":true,"ready":true,"predicate":null,"expression":null}]},"trigger_attestation":{"name":"story_question_answer_link_required","table":"public.stories","function_identity":"private.story_check_question_answer_link_qa_c1_v1()","definition_sha256":"b0566debb8aa63ccc3de2c3733fb6ea4191fa580191206747e5a7fc468440ebf","tgtype":21,"enabled":"O","internal":false,"deferrable":true,"initially_deferred":true},"security_advisor":{"provider":{"source":"supabase/splinter","commit":"fccca4b1c4d8b48b8ccd69bd6b30e84adcb92975","sql_sha256":"d8d558baad3e03832e521c527907fa50a9a172fabd899dd0f5c2504a5a0e9349"},"normalized_digest":"b32e3e37e5776d90e73b1ee67ce79e74362f892ec84470cbb2b3b24f33c5c36d","introduced_exceptions":[{"advisor_fingerprint":"9cf89de2d5c962441f655087f8b3e5e89f2e7d6d94ce4196b48bd41bee29790a","advisor_type":"authenticated_security_definer_function_executable","advisor_severity":"WARN","object":{"schema":"public","name":"prepare_story_question_answer","argument_types":["uuid","uuid","uuid"],"identity_arguments":"p_source_story_id uuid, p_source_element_id uuid, p_respondent_id uuid"},"attestation":{"security_definer":true,"owner":"postgres","search_path":["search_path=\"\""],"acl":[{"grantee":"authenticated","privilege_type":"EXECUTE","is_grantable":false},{"grantee":"postgres","privilege_type":"EXECUTE","is_grantable":false}],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false},"definition_sha256":"8c9cf9f018d577e93c82354307bb0d6e8d0503c3a548c8fed66ad216a4d285d3"},"authorization":{"functional_reason":"Read-only authenticated preflight revalidates private question ownership and lifecycle server-side.","controls":["authenticated_session","negative_authorization_tests","owner_binding","read_only"],"negative_test_evidence_sha256":"5b13d971dcdcba94075d7bf8e7715e98cec2daac9c55e324611f27ec71689f66"},"origin":{"migration":"20261029042807_stories_v2_qa_c1_question_answer_authority","migration_blob":"b1f025b12f6d4e9fadf178630ee0e46c283bbd1c","source_sha":"3b7652e9ae7d9c66ce3f06286f738a724f3a9cd5"},"technical_approval":"verified"},{"advisor_fingerprint":"2195e746b4232e0a54f1fbb9fdd51dc4d87014ec20c4b8d6a6bd8b05bbc25d39","advisor_type":"authenticated_security_definer_function_executable","advisor_severity":"WARN","object":{"schema":"public","name":"create_story_question_answer_with_media","argument_types":["uuid","uuid","uuid","uuid","jsonb","uuid","jsonb"],"identity_arguments":"p_source_story_id uuid, p_source_element_id uuid, p_respondent_id uuid, p_asset_id uuid, p_composition jsonb, p_client_story_id uuid, p_interactive_definitions jsonb"},"attestation":{"security_definer":true,"owner":"postgres","search_path":["search_path=\"\""],"acl":[{"grantee":"authenticated","privilege_type":"EXECUTE","is_grantable":false},{"grantee":"postgres","privilege_type":"EXECUTE","is_grantable":false}],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false},"definition_sha256":"4d1bfef144382ae5a67a5d1b665a1f64a559d4a45cba93aadd3b8399cf65afbd"},"authorization":{"functional_reason":"Atomic authenticated QA publication reuses the canonical media, safety and publish-first authority.","controls":["authenticated_session","atomic_transaction","negative_authorization_tests","owner_binding"],"negative_test_evidence_sha256":"5b13d971dcdcba94075d7bf8e7715e98cec2daac9c55e324611f27ec71689f66"},"origin":{"migration":"20261029042807_stories_v2_qa_c1_question_answer_authority","migration_blob":"b1f025b12f6d4e9fadf178630ee0e46c283bbd1c","source_sha":"3b7652e9ae7d9c66ce3f06286f738a724f3a9cd5"},"technical_approval":"verified"},{"advisor_fingerprint":"3428d19b7577fa13fcae7ea23166d7053b98ce34804fcc5ac6f66d2339c80c64","advisor_type":"table","advisor_severity":"INFO","object":{"schema":"private","name":"story_question_answer_links"},"attestation":{"owner":"postgres","rls_enabled":true,"force_rls":true,"acl":[{"grantee":"postgres","privilege_type":"DELETE","is_grantable":false},{"grantee":"postgres","privilege_type":"INSERT","is_grantable":false},{"grantee":"postgres","privilege_type":"MAINTAIN","is_grantable":false},{"grantee":"postgres","privilege_type":"REFERENCES","is_grantable":false},{"grantee":"postgres","privilege_type":"SELECT","is_grantable":false},{"grantee":"postgres","privilege_type":"TRIGGER","is_grantable":false},{"grantee":"postgres","privilege_type":"TRUNCATE","is_grantable":false},{"grantee":"postgres","privilege_type":"UPDATE","is_grantable":false}]},"authorization":{"functional_reason":"Private forced-RLS provenance is owner-only and mediated by bounded server RPCs.","controls":["force_rls","negative_authorization_tests","owner_only_acl","private_schema"],"negative_test_evidence_sha256":"5b13d971dcdcba94075d7bf8e7715e98cec2daac9c55e324611f27ec71689f66"},"origin":{"migration":"20261029042807_stories_v2_qa_c1_question_answer_authority","migration_blob":"b1f025b12f6d4e9fadf178630ee0e46c283bbd1c","source_sha":"3b7652e9ae7d9c66ce3f06286f738a724f3a9cd5"},"technical_approval":"verified"}]},"safety":{"activation":true,"owner_approved_operating_model":true,"owner_approved_policy":false,"mode":"PUBLISH_FIRST_ASYNC_REVIEW","automatic_allow_authorized":false,"automatic_block_authorized":false,"numeric_thresholds":null,"historical_backfill":false},"finance_policy":{"platform_fee_bps":2000,"purchase_enabled":true,"refunds_enabled":true,"subscription_enabled":true},"requires_separate_baseline_promotion":true});

const CONTROL_CENTER_AUTHENTICATED_ACL = Object.freeze([
  { grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false },
  { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
]);
const controlCenterFunction = (identity, definitionSha256, searchPath) => ({
  identity, definition_sha256: definitionSha256, owner: 'postgres', volatility: 's',
  security_definer: true, search_path: searchPath,
  execute: { anon: false, authenticated: true, public: false, service_role: false },
  acl: CONTROL_CENTER_AUTHENTICATED_ACL,
});

export const SUPERUSER_CONTROL_CENTER_RELEASE_TRANSITION = Object.freeze({
  id: 'superuser-control-center-desktop-v1',
  from_phase: 'stories_v2_qa_c1_question_answer',
  to_phase: 'superuser_control_center_desktop',
  baseline_sha: '3246a502f8d350f43edbd78314b3be9e1609935d',
  reviewed_source_sha: '045ebbc81013d520e7f0730580f8d7eaec97414d',
  integration_base_sha: '409dd334c050eed7f5624964ef9b16ad2eb6e76c',
  approved_sha_ancestry: 'verified_integration_base',
  migrations: [
    { version: '20261031020113', path: 'supabase/migrations/20261031020113_superuser_control_center_mfa_aal2.sql',
      blob: '5452895cfd473513e99e15e35bff948a74080f44', sha256: '6cc83d43fdb2a8bc22990a04fd237342c92967b83318d6fa6addba8d270ce3c2', byte_length: 6839 },
    { version: '20261031025722', path: 'supabase/migrations/20261031025722_superuser_control_center_cursor_terminal_truth.sql',
      blob: '91e75126f636ac8f83d9e73798c66dac58d72608', sha256: 'd26c790a5ddc9aea14b72cd3c64810d49298f67c41db12ba6418ae00b141d3f9', byte_length: 15456 },
    { version: '20261031032022', path: 'supabase/migrations/20261031032022_superuser_control_center_overview.sql',
      blob: '9a2c821a314d7c6039ec31f534712784a94089e3', sha256: 'dbef7f15d6caefa536fd81391154107503b01b16b93fbd69a5fb5e54d30c1bd6', byte_length: 20968 },
  ],
  productive_paths: [
    'supabase/migrations/20261031020113_superuser_control_center_mfa_aal2.sql',
    'supabase/migrations/20261031025722_superuser_control_center_cursor_terminal_truth.sql',
    'supabase/migrations/20261031032022_superuser_control_center_overview.sql',
  ],
  functions: [], config_changed: false,
  required_aal_catalog: {
    capability_count: 54,
    aal2_codes: ['admin.roles.assign','admin.roles.revoke','advertising.rates.manage',
      'advertising.rollout.manage','battles.sessions.moderate','chat.abuse_reports.moderate',
      'content.items.hide','content.items.moderate','content.items.restore',
      'creator_premium.refunds.write','creator_premium.review.moderate','live.sessions.moderate',
      'live.sessions.terminate','marketplace.disputes.resolve','marketplace.products.moderate',
      'marketplace.sellers.moderate','media.assets.moderate','reports.cases.resolve',
      'reports.cases.review','stories.items.moderate','users.accounts.moderate',
      'users.accounts.restore','users.accounts.suspend'],
    refund_roles: ['SUPER_ADMIN'],
    root_role: { role_code: 'SUPER_ADMIN', is_root: true, is_exclusive: true, is_assignable: false },
    root_grant_rule_count: 0,
  },
  function_definitions: [
    controlCenterFunction('public.admin_actor_has_capability(text)', '17b76f7b04e0446d40c823b38151114068dc9433d3ab7d4119582b7a691162ef', ['search_path=pg_catalog, private, public']),
    controlCenterFunction('public.admin_require_capability(text)', '317d4e2f7947babb9711ce37bc081dfc00aff46b7757ac983536e54830c5722a', ['search_path=pg_catalog, private, public']),
    controlCenterFunction('public.get_my_admin_access()', '6e422c6af4d7bcd7a765ebba343dd26f3f2422148904b368effb73bb34d65a89', ['search_path=pg_catalog, private, public']),
    controlCenterFunction('public.search_admin_finance_audit(text,uuid,text,uuid,text,timestampwithtimezone,timestampwithtimezone,timestampwithtimezone,uuid,integer)', '7e03bc7e7ed0207e330c99d5b579dda474196b7308efe6cc191162bed6133668', ['search_path=""']),
    controlCenterFunction('public.search_admin_financial_transactions(text,text,text,text,timestampwithtimezone,timestampwithtimezone,timestampwithtimezone,uuid,integer)', 'f76cf682b23b9dcc91c62595dd6b52b5eca208e9d8049be72d872412323fd0d8', ['search_path=""']),
    controlCenterFunction('public.search_admin_global_audit(text,text,uuid,text,uuid,text,boolean,timestampwithtimezone,timestampwithtimezone,timestampwithtimezone,uuid,integer)', 'a671384901cc2d58248d891ecb23395fb47fcf75da4a5800dbf70935bbaa24cd', ['search_path=""']),
    controlCenterFunction('public.search_admin_ledger_accounts(text,text,boolean,uuid,timestampwithtimezone,uuid,integer)', '8c9791439d96a4ba864900c94e3ac1ff151550c99219c33ea8a51efc4c110169', ['search_path=""']),
    controlCenterFunction('public.search_admin_system_audit(text,text,timestampwithtimezone,uuid,integer)', 'ce81f276e0453867cf9b08f12de978f323b56ccca8b0a398672e2f4e8f23b59d', ['search_path=""']),
    controlCenterFunction('public.get_admin_control_center_overview_v1(text,date,date)', 'e1775b76cdb41f46a48a99015029e979897503d00e1ef34023062dec1ea93814', ['search_path=""']),
    controlCenterFunction('public.search_admin_advertising_ads(text,integer,timestampwithtimezone,uuid,uuid)', '306538cfcddf24a259249614e57e8fef723127f366b62d6624bbe6b3686d745f', ['search_path=""']),
  ],
  removed_functions: ['public.search_admin_advertising_ads(text,integer)'],
  index_attestation: {
    schema: 'private', table: 'advertising_ads', name: 'advertising_ads_submitted_cursor_idx',
    owner: 'postgres', definition: 'CREATE INDEX advertising_ads_submitted_cursor_idx ON private.advertising_ads USING btree (submitted_at, id)',
    valid: true, ready: true, unique: false, primary: false,
    lock_risk: 'bounded_reviewed_nonconcurrent_btree_create',
    plan: { access_method: 'btree', key_columns: ['submitted_at','id'],
      probe_order: ['submitted_at','id'], probe_limit: 1001,
      create_mode: 'nonconcurrent', lock_mode: 'SHARE' },
  },
  bounded_postcheck: {
    probe_limit: 1001,
    resources: ['auth.mfa_factors','private.admin_action_audit','private.advertising_ads'],
    admin_audit_release_attribution_required_zero: true,
    advertising_ads_probe_must_not_saturate: true,
    concurrent_activity: 'allowed_without_row_equality',
    finance_authority: 'canonical_finance_snapshot_and_reconciliation',
    premium_authority: 'canonical_finance_facts_and_premium_state',
  },
  security_advisor: {
    provider: { source: 'supabase/splinter', commit: 'fccca4b1c4d8b48b8ccd69bd6b30e84adcb92975',
      sql_sha256: 'd8d558baad3e03832e521c527907fa50a9a172fabd899dd0f5c2504a5a0e9349' },
    transition: { before_count: 597, before_sha256: 'd0e52c1a329d52b48f9926d4355e2cf2247e8463e6fcf683b63150fb251c2eee',
      after_count: 598, after_sha256: '21e73c054d9e2ba1de93ebda2b4c423f3d1b9c7f97a857478ab175d1a5de8dae' },
    predecessor_exception: {
      advisor_fingerprint: 'b1b08a6ee6057c6e739057eb823c034e95b6be56a2a6ed33ce73d11969b76713',
      advisor_type: 'authenticated_security_definer_function_executable', advisor_severity: 'WARN',
      object: { schema: 'public', name: 'search_admin_advertising_ads', argument_types: ['text','integer'],
        identity_arguments: 'p_review_status text, p_limit integer' },
      attestation: { security_definer: true, owner: 'postgres', search_path: ['search_path=""'],
        acl: CONTROL_CENTER_AUTHENTICATED_ACL,
        execute: { anon: false, authenticated: true, public: false, service_role: false },
        definition_sha256: '99583f9ce0778c15a304bf55206810693f5d12b320fd8787a8f5cee97650c4d1' },
      authorization: { functional_reason: 'Capability-gated bounded Ads review read authority.',
        controls: ['authenticated_session','capability_guard','bounded_result','read_only'],
        negative_test_evidence_sha256: '8aacf715fff647902687149955343148c5016fafa6a93d204c4d221336da11a1' },
      origin: { migration: '20260923190702_ads_v2_j_admin_analytics_production_closure',
        migration_blob: 'cb5164d4b5a1fe3620e739fbdf2aa85139b94165', source_sha: '6b0313a1954af82ba27b0aa9a946fb5729c6878b' },
      technical_approval: 'verified',
    },
    introduced_exceptions: [
      { advisor_fingerprint: '71d58bfc1f9846818b995f013a16afc233ebfca99a3aa9485bd3d7e8686b45f1',
        advisor_type: 'authenticated_security_definer_function_executable', advisor_severity: 'WARN',
        object: { schema: 'public', name: 'search_admin_advertising_ads',
          argument_types: ['text','integer','timestamp with time zone','uuid','uuid'],
          identity_arguments: 'p_review_status text, p_limit integer, p_cursor_submitted_at timestamp with time zone, p_cursor_id uuid, p_ad_id uuid' },
        attestation: { security_definer: true, owner: 'postgres', search_path: ['search_path=""'],
          acl: CONTROL_CENTER_AUTHENTICATED_ACL,
          execute: { anon: false, authenticated: true, public: false, service_role: false },
          definition_sha256: '306538cfcddf24a259249614e57e8fef723127f366b62d6624bbe6b3686d745f' },
        authorization: { functional_reason: 'Capability-gated bounded Ads review read authority with exact cursor and ad lookup.',
          controls: ['authenticated_session','capability_guard','bounded_result','read_only'],
          negative_test_evidence_sha256: '8aacf715fff647902687149955343148c5016fafa6a93d204c4d221336da11a1' },
        origin: { migration: '20261031032022_superuser_control_center_overview',
          migration_blob: '9a2c821a314d7c6039ec31f534712784a94089e3', source_sha: '045ebbc81013d520e7f0730580f8d7eaec97414d' },
        technical_approval: 'verified' },
      { advisor_fingerprint: 'aafdbe9029cad2382befedf5f1233d98088d6f5c3d4bf42ec2cf371a3d85b477',
        advisor_type: 'authenticated_security_definer_function_executable', advisor_severity: 'WARN',
        object: { schema: 'public', name: 'get_admin_control_center_overview_v1',
          argument_types: ['text','date','date'], identity_arguments: 'p_module text, p_from date, p_to date' },
        attestation: { security_definer: true, owner: 'postgres', search_path: ['search_path=""'],
          acl: CONTROL_CENTER_AUTHENTICATED_ACL,
          execute: { anon: false, authenticated: true, public: false, service_role: false },
          definition_sha256: 'e1775b76cdb41f46a48a99015029e979897503d00e1ef34023062dec1ea93814' },
        authorization: { functional_reason: 'Capability-gated bounded aggregate dashboard projection without identity exports.',
          controls: ['authenticated_session','capability_guard','bounded_date_range','aggregate_only','read_only'],
          negative_test_evidence_sha256: '8aacf715fff647902687149955343148c5016fafa6a93d204c4d221336da11a1' },
        origin: { migration: '20261031032022_superuser_control_center_overview',
          migration_blob: '9a2c821a314d7c6039ec31f534712784a94089e3', source_sha: '045ebbc81013d520e7f0730580f8d7eaec97414d' },
        technical_approval: 'verified' },
    ],
  },
  finance_policy: { platform_fee_bps: 2000, purchase_enabled: true, refunds_enabled: true, subscription_enabled: true },
  requires_separate_baseline_promotion: true,
});

export const SUPERUSER_QA_PERF_C1_RELEASE_TRANSITION = Object.freeze({
  id: 'superuser-qa-perf-c1-v1',
  from_phase: 'superuser_control_center_desktop',
  to_phase: 'superuser_qa_perf_c1',
  baseline_sha: '94ac244197e5c0ab0753747532f4e0969ece1901',
  integration_base_sha: 'a028a397e1c3c3455be0145a575cb9eda8cd4bef',
  approved_sha_ancestry: 'verified_integration_base',
  migrations: [
    { version: '20261101181907', path: 'supabase/migrations/20261101181907_superuser_qa_perf_c1.sql',
      blob: '005c6cbbf1539611ecb0b8f2255bdf3be44f32a6', sha256: '70c7d77bb0a2cb11287b4d0f0feba3f158e3ae3f749e7fa7ec15fb071a7fff07', byte_length: 10759 },
  ],
  productive_paths: [
    'supabase/migrations/20261101181907_superuser_qa_perf_c1.sql',
  ],
  functions: [], config_changed: false,
  predecessor_functions: [
    controlCenterFunction('public.get_admin_system_health()', '9f0c387018d7a984118e42ff953a68fb1d26a4e9f288ec7ecec877adcf120676', ['search_path=""']),
    controlCenterFunction('public.get_marketplace_admin_health()', 'f0222d0af1d6b5f3317174f8b05fb91ea14f9786e87a17d0535baa70829102ab', ['search_path=pg_catalog, private, public']),
  ],
  function_definitions: [
    controlCenterFunction('public.get_admin_system_health()', '59810b955f97c8d9538a8833f4aec5da994de2ff302d5706aceeb80a35f51c72', ['search_path=""']),
    controlCenterFunction('public.get_marketplace_admin_health()', 'be6d8747efe5066ecf514e1b38b7d4b28444e1bc53484208430f9a2b7884e233',
      ['search_path=pg_catalog, private, public','join_collapse_limit=1','from_collapse_limit=1']),
  ],
  cron_history_attestation: {
    schema: 'cron', table: 'job_run_details', relation_kind: 'r',
    schema_owner: 'supabase_admin', table_owner: 'supabase_admin', extension: 'pg_cron',
    primary_index: { name: 'job_run_details_pkey', key_columns: ['runid'], included_columns: [],
      primary: true, unique: true, valid: true, ready: true,
      predicate: false, expressions: false },
    release_index_name: 'cron_job_run_details_start_job_cover_idx', release_index_expected: false,
    release_mutation: 'forbidden',
    metrics_contract: { probe_order: ['runid'], probe_direction: 'desc', probe_limit: 50000,
      complete_only_when_unsaturated: true, exact_only_when_complete: true,
      unavailable_reason: 'history_probe_limit_reached', unavailable_value: null },
  },
  pre_snapshot_recovery: {
    migration_inventory: 'baseline_without_c1',
    accepted_states: [
      { functions: 'predecessor', cron_history: 'exact_extension_owned', release_index: 'absent' },
    ],
    finance_policy_exact: true,
    mixed_function_catalog_rejected: true,
  },
  finance_policy: { platform_fee_bps: 2000, purchase_enabled: true, refunds_enabled: true, subscription_enabled: true },
  requires_separate_baseline_promotion: true,
});

const WEB_CONTROL_CENTERS_B1_REVIEWED_SOURCE_SHA = '94006f2e87edb960cbf457ab4313198aadf05c8c';
const WEB_CONTROL_CENTERS_B1_MIGRATION = Object.freeze({
  version: '20261102065812',
  path: 'supabase/migrations/20261102065812_web_control_centers_b1_publication_drafts.sql',
  blob: 'd12f7b10a64d7eeb55d9347dff30c7d4cb3303d3',
  sha256: '99717e6ff7902e3bff2ed242237d28313b2c822b1a63975756ba9bbd6e60bc99',
  byte_length: 37397,
});
const b1Execute = authenticated => ({
  anon: false, authenticated, public: false, service_role: false,
});
const b1Acl = authenticated => [
  ...(authenticated ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }] : []),
  { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
];
const b1Function = (identity, definition_sha256, volatility, security_definer, authenticated = false) => ({
  identity, definition_sha256, owner: 'postgres', volatility, security_definer,
  search_path: ['search_path=""'], execute: b1Execute(authenticated), acl: b1Acl(authenticated),
});
const WEB_CONTROL_CENTERS_B1_HELPERS = Object.freeze([
  b1Function('private.guard_publication_draft_command_immutable_v1()',
    '499daaa13a47457c43b82d077c64be5d6827e5e0d958912423a3c049cd83d4da', 'v', false),
  b1Function('private.guard_publication_draft_media_v1()',
    'a8a5d194bc100d7cc28b4c7c081751b78eb577ce1dcfd9cc17fc8eb7b037b5f8', 'v', true),
  b1Function('private.guard_publication_draft_mutation_v1()',
    '5dd40a6f050cf4b187ce36c95c6bd171e6dacad61c65bafea7253819db353988', 'v', false),
  b1Function('private.guard_publication_receipt_immutable_v1()',
    '78dcd496d53985a34f98683fa3f9ccf56f0e3f288dc71c6c7188aab46abf3305', 'v', false),
  b1Function('private.publication_draft_composition_safe_v1(jsonb)',
    'c115d174247d5fff687449c482de336c56e9368f99768633ca3fa2e4576479b0', 'i', false),
  b1Function('private.publication_draft_json_v1(private.publication_drafts)',
    '1be7b4597dfeae9741ae309aeb138c7caa5390dc91500a70bf0a7283e9f4e85a', 's', true),
  b1Function('private.publication_draft_payload_fingerprint_v1(text,text,text,text,jsonb,uuid[],bigint,uuid)',
    '80af2c42d14c381c207c8abd51422ded4dc465f38f6bd1a12fc182b28ec67aee', 'i', false),
  b1Function('private.require_publication_asset_set_v1(uuid,text,uuid[],text)',
    'aded1ef320f4bbc7237f253c8158b92903502927359004f365448a3f4800aa24', 'v', true),
]);
const WEB_CONTROL_CENTERS_B1_RPCS = Object.freeze([
  ['public.create_my_publication_draft_v1(uuid,text,text,text,jsonb,uuid[])',
    '2d48fd7299c8f9ce98f6d7dff3c72cd99fcf8c3a790ad65688cf8dc2ae005b88', 'v',
    'p_client_request_id uuid, p_kind text, p_caption text, p_music text, p_composition jsonb, p_asset_ids uuid[]',
    ['uuid','text','text','text','jsonb','uuid[]'], '0a1ab69763e5bd7c53e24688c152086c7b1fb704d87425b7c3fc68627c93b76c'],
  ['public.delete_my_publication_draft_v1(uuid,bigint,uuid)',
    'f420e32b58d5f797653d7083bf69d687950f290c719b6db6e4032c2efb08a100', 'v',
    'p_draft_id uuid, p_expected_revision bigint, p_client_mutation_id uuid',
    ['uuid','bigint','uuid'], 'efd6ee5a2807e75e93eb533f858021f0f4bf27b96dbd2ba6e1fd805c0ad2409f'],
  ['public.get_my_publication_draft_v1(uuid)',
    'e9000082b39327886e56d6d84d5725c4735248ca313ca5a1d8fa64d5b3772f17', 's',
    'p_draft_id uuid', ['uuid'], '373f1f947894cf0096cb297f5882451fdf7b02fb61009298ee689b4b172aac4f'],
  ['public.list_my_publication_drafts_v1(integer,timestampwithtimezone,uuid)',
    '4a826e0ac92c77dfe7e10f725f1278152bbd7e544763c809f34007c1d1b53ff1', 's',
    'p_limit integer, p_cursor_updated_at timestamp with time zone, p_cursor_id uuid',
    ['integer','timestamp with time zone','uuid'], '32370dc3b431acac6f74e8d9e3f99d0bf6050b128dc5ff7bd797306310352d16'],
  ['public.publish_my_media_post_v1(uuid,text,text,text,uuid[])',
    '54b53bb1c99cf6ffd63b19d2125368b06d944b3fb1f0761ec575a3cfd48c641d', 'v',
    'p_client_command_id uuid, p_kind text, p_caption text, p_music text, p_asset_ids uuid[]',
    ['uuid','text','text','text','uuid[]'], 'aede65cb0c2218d113c3583ff2c9dd47154bb71a06a07031092b8eb1f0598361'],
  ['public.publish_my_publication_draft_v1(uuid,bigint,uuid,uuid[])',
    '97a23af064fb62450c3885c28be1a7da76d3d0de3786b7ed792066fdc159e708', 'v',
    'p_draft_id uuid, p_expected_revision bigint, p_client_command_id uuid, p_public_asset_ids uuid[]',
    ['uuid','bigint','uuid','uuid[]'], '4fc7c5ae6e14a99c537d0857b2c257e86a3d5267ec1c49cfcfed5f0dd0276181'],
  ['public.update_my_publication_draft_v1(uuid,bigint,uuid,text,text,text,jsonb,uuid[])',
    '86f1c7276f4f94e34c82e6a33c183a1aae8f1cb5decc189f97757ffbf3fd5a88', 'v',
    'p_draft_id uuid, p_expected_revision bigint, p_client_mutation_id uuid, p_kind text, p_caption text, p_music text, p_composition jsonb, p_asset_ids uuid[]',
    ['uuid','bigint','uuid','text','text','text','jsonb','uuid[]'],
    'b2391c6357cac8e3bbbeee5228fea05c92ee5a6378c2b14d12b1d3d9ceb267ab'],
].map(([identity, hash, volatility, identityArguments, argumentTypes, fingerprint]) => ({
  ...b1Function(identity, hash, volatility, true, true),
  identity_arguments: identityArguments,
  argument_types: argumentTypes,
  advisor_fingerprint: fingerprint,
})));
const WEB_CONTROL_CENTERS_B1_TABLE_ACL = Object.freeze({
  anon: false, authenticated: false, public: false, service_role: false,
});
const WEB_CONTROL_CENTERS_B1_RELATIONS = Object.freeze([
  'publication_draft_commands','publication_drafts','publication_receipts',
].map(name => ({ schema: 'private', name, owner: 'postgres', relation_kind: 'r',
  rls_enabled: true, force_rls: true, acl: WEB_CONTROL_CENTERS_B1_TABLE_ACL })));
const WEB_CONTROL_CENTERS_B1_MEDIA = Object.freeze({
  entity_type_constraint: "CHECK (entity_type = ANY (ARRAY['user_profile'::text, 'video_post'::text, 'story'::text, 'chat_message'::text, 'shop_product'::text, 'exclusive_content'::text, 'marketplace_store'::text, 'marketplace_dispute'::text, 'marketplace_return_shipment'::text, 'creator_premium_content'::text, 'publication_draft'::text]))",
  policies: [
    { schema: 'public', table: 'media_asset_links', name: 'media_asset_links_owner_read',
      permissive: 'PERMISSIVE', roles: ['authenticated'], command: 'SELECT',
      qual: "((entity_type <> ALL (ARRAY['story'::text, 'creator_premium_content'::text, 'publication_draft'::text])) AND (EXISTS ( SELECT 1\n   FROM media_assets asset\n  WHERE ((asset.id = media_asset_links.asset_id) AND (asset.owner_id = ( SELECT auth.uid() AS uid))))))",
      with_check: null },
    { schema: 'public', table: 'media_asset_links', name: 'media_asset_links_public_read',
      permissive: 'PERMISSIVE', roles: ['anon','authenticated'], command: 'SELECT',
      qual: "((entity_type <> ALL (ARRAY['story'::text, 'creator_premium_content'::text, 'publication_draft'::text])) AND (EXISTS ( SELECT 1\n   FROM media_assets asset\n  WHERE ((asset.id = media_asset_links.asset_id) AND (asset.visibility = 'public'::text) AND (asset.status = 'ready'::text)))))",
      with_check: null },
  ],
  indexes: [
    { schema: 'public', table: 'media_asset_links', name: 'publication_draft_media_asset_uidx',
      owner: 'postgres', definition: "CREATE UNIQUE INDEX publication_draft_media_asset_uidx ON public.media_asset_links USING btree (asset_id) WHERE (entity_type = 'publication_draft'::text)",
      valid: true, ready: true, unique: true, primary: false },
    { schema: 'public', table: 'media_asset_links', name: 'publication_draft_media_position_uidx',
      owner: 'postgres', definition: "CREATE UNIQUE INDEX publication_draft_media_position_uidx ON public.media_asset_links USING btree (entity_id, \"position\") WHERE (entity_type = 'publication_draft'::text)",
      valid: true, ready: true, unique: true, primary: false },
  ],
  triggers: [{ schema: 'public', table: 'media_asset_links', name: 'media_asset_links_guard_publication_draft',
    enabled: 'O', function_identity: 'private.guard_publication_draft_media_v1()',
    definition_sha256: '96b9b7dbdecf578ae8f5e544f5893e002764b3e4400747ed45e49a53826710ff' }],
});
const WEB_CONTROL_CENTERS_B1_PRE_MEDIA = Object.freeze({
  entity_type_constraint: "CHECK (entity_type = ANY (ARRAY['user_profile'::text, 'video_post'::text, 'story'::text, 'chat_message'::text, 'shop_product'::text, 'exclusive_content'::text, 'marketplace_store'::text, 'marketplace_dispute'::text, 'marketplace_return_shipment'::text, 'creator_premium_content'::text]))",
  policies: WEB_CONTROL_CENTERS_B1_MEDIA.policies.map(policy => ({ ...policy,
    qual: policy.qual.replace(", 'publication_draft'::text", '') })),
  indexes: [], triggers: [],
});
const WEB_CONTROL_CENTERS_B1_ORIGIN = Object.freeze({
  migration: '20261102065812_web_control_centers_b1_publication_drafts',
  migration_blob: WEB_CONTROL_CENTERS_B1_MIGRATION.blob,
  source_sha: WEB_CONTROL_CENTERS_B1_REVIEWED_SOURCE_SHA,
});
const WEB_CONTROL_CENTERS_B1_ADVISOR_EXCEPTIONS = Object.freeze([
  ...WEB_CONTROL_CENTERS_B1_RPCS.map(item => ({
    advisor_fingerprint: item.advisor_fingerprint,
    advisor_type: 'authenticated_security_definer_function_executable', advisor_severity: 'WARN',
    object: { schema: 'public', name: item.identity.slice(7, item.identity.indexOf('(')),
      argument_types: item.argument_types, identity_arguments: item.identity_arguments },
    attestation: { security_definer: item.security_definer, owner: item.owner,
      search_path: item.search_path, acl: item.acl, execute: item.execute,
      definition_sha256: item.definition_sha256 },
    origin: WEB_CONTROL_CENTERS_B1_ORIGIN,
  })),
  ...[
    ['publication_draft_commands','3918834b4c171d60b18574d673ec4e5dbac6138cf2a9997c2440162c5c1be481'],
    ['publication_drafts','8bb642f9b8e5376546330fc03937409376c206b08d5ed321e8cf5053eec1eefb'],
    ['publication_receipts','677403a7d99487e3e4db6eec38b550ef8405eb620170959c96d9bc64e0148df6'],
  ].map(([name, advisor_fingerprint]) => ({ advisor_fingerprint, advisor_type: 'table',
    advisor_severity: 'INFO', object: { schema: 'private', name }, origin: WEB_CONTROL_CENTERS_B1_ORIGIN })),
]);

export const WEB_CONTROL_CENTERS_B1_RELEASE_TRANSITION = Object.freeze({
  id: 'web-control-centers-b1-publication-drafts-v1',
  from_phase: 'superuser_qa_perf_c1', to_phase: 'web_control_centers_b1',
  baseline_sha: '9010894cb37cd10df4ab0eae5b849143fd2222fd',
  integration_base_sha: 'a7d93778f94c677440fdfe172dc679b5dd5f1c91',
  reviewed_source_sha: WEB_CONTROL_CENTERS_B1_REVIEWED_SOURCE_SHA,
  approved_sha_ancestry: 'verified_integration_base',
  migrations: [WEB_CONTROL_CENTERS_B1_MIGRATION],
  productive_paths: [WEB_CONTROL_CENTERS_B1_MIGRATION.path],
  functions: [], config_changed: false,
  rpc_attestations: WEB_CONTROL_CENTERS_B1_RPCS.map(item => {
    const { argument_types, advisor_fingerprint, identity_arguments, ...attestation } = item;
    return { ...attestation, argument_types, identity_arguments, advisor_fingerprint };
  }),
  catalog: { relations: WEB_CONTROL_CENTERS_B1_RELATIONS, helpers: WEB_CONTROL_CENTERS_B1_HELPERS,
    media_asset_links: WEB_CONTROL_CENTERS_B1_MEDIA },
  predecessor_media_asset_links: WEB_CONTROL_CENTERS_B1_PRE_MEDIA,
  security_advisor: { introduced_exceptions: WEB_CONTROL_CENTERS_B1_ADVISOR_EXCEPTIONS },
  finance_policy: { platform_fee_bps: 2000, purchase_enabled: true,
    refunds_enabled: true, subscription_enabled: true },
  requires_separate_baseline_promotion: true,
});

const WEB_CONTROL_CENTERS_B1_QA_C3_REVIEWED_SOURCE_SHA =
  '44d2f9a8e827a83dcab2a63f7f82c386dcbd05b6';
const WEB_CONTROL_CENTERS_B1_QA_C3_MIGRATION = Object.freeze({
  version: '20261107053930',
  path: 'supabase/migrations/20261107053930_web_control_centers_b1_qa_c3_draft_list_recovery.sql',
  blob: '94344ab595e4a648211a5adeca92be80e265edc9',
  sha256: 'b43f61a88f32325f71d5d8d13ef1455834c494eb2402277f29c224c6c440b378',
  byte_length: 1271,
});
const WEB_CONTROL_CENTERS_B1_QA_C3_PREDECESSOR = Object.freeze(
  WEB_CONTROL_CENTERS_B1_RPCS.find(item => (
    item.identity === 'public.list_my_publication_drafts_v1(integer,timestampwithtimezone,uuid)'
  )),
);
const WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR = Object.freeze({
  ...WEB_CONTROL_CENTERS_B1_QA_C3_PREDECESSOR,
  definition_sha256: 'adc7f6e9126e1abc7a3c1dd741ae5e13428ab6252b3a1f4243d88fc7a88720c7',
});
const WEB_CONTROL_CENTERS_B1_QA_C3_ADVISOR_EXCEPTION = Object.freeze({
  advisor_fingerprint: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR.advisor_fingerprint,
  advisor_type: 'authenticated_security_definer_function_executable',
  advisor_severity: 'WARN',
  object: {
    schema: 'public', name: 'list_my_publication_drafts_v1',
    argument_types: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR.argument_types,
    identity_arguments: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR.identity_arguments,
  },
  attestation: {
    security_definer: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR.security_definer,
    owner: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR.owner,
    search_path: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR.search_path,
    acl: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR.acl,
    execute: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR.execute,
    definition_sha256: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR.definition_sha256,
  },
  origin: {
    migration: '20261107053930_web_control_centers_b1_qa_c3_draft_list_recovery',
    migration_blob: WEB_CONTROL_CENTERS_B1_QA_C3_MIGRATION.blob,
    source_sha: WEB_CONTROL_CENTERS_B1_QA_C3_REVIEWED_SOURCE_SHA,
  },
});

export const WEB_CONTROL_CENTERS_B1_QA_C3_RELEASE_TRANSITION = Object.freeze({
  id: 'web-control-centers-b1-qa-c3-draft-list-recovery-v1',
  from_phase: 'web_control_centers_b1',
  to_phase: 'web_control_centers_b1_qa_c3',
  baseline_sha: '6966c8af714cf7d5763cccfccbc0802f6c2ffdc3',
  integration_base_sha: 'd2409094ac131e1455c70a4b1905ea51358751e5',
  reviewed_source_sha: WEB_CONTROL_CENTERS_B1_QA_C3_REVIEWED_SOURCE_SHA,
  approved_sha_ancestry: 'verified_integration_base',
  migrations: [WEB_CONTROL_CENTERS_B1_QA_C3_MIGRATION],
  productive_paths: [WEB_CONTROL_CENTERS_B1_QA_C3_MIGRATION.path],
  functions: [], config_changed: false,
  rpc_replacement: {
    predecessor: WEB_CONTROL_CENTERS_B1_QA_C3_PREDECESSOR,
    successor: WEB_CONTROL_CENTERS_B1_QA_C3_SUCCESSOR,
  },
  security_advisor: {
    replacement_exception: WEB_CONTROL_CENTERS_B1_QA_C3_ADVISOR_EXCEPTION,
  },
  finance_policy: { platform_fee_bps: 2000, purchase_enabled: true,
    refunds_enabled: true, subscription_enabled: true },
  requires_separate_baseline_promotion: true,
});

export const STORIES_SAFETY_C1_RELEASE_TRANSITION = Object.freeze({
  id: 'stories-v2-safety-c1-technical-policy-prep-v1',
  from_phase: 'stories_v2_interactive_b1_fail_closed',
  to_phase: 'stories_v2_safety_c1_technical_prep_fail_closed',
  baseline_sha: '01dd6467484d11ad11aeb611374437e212fb7401',
  reviewed_source_sha: '5ba49a3b118d6fde4eea6d97ec4c193f6f48a64a',
  integration_base_sha: '69ba61b04a1329231dcc9f22363f1c273e5b524c',
  approved_sha_ancestry: 'verified_integration_base',
  migration_path: 'supabase/migrations/20261027120000_stories_v2_safety_c1_technical_policy_prep.sql',
  migration_blob: 'c6c10913db7bb71411436835c923c14c129f51b7',
  migration_sha256: '92c956af294888d5011eda07d14c84ccb0c1ba8acac4e5c8e7887d947f3d92a0',
  productive_paths: [
    'supabase/migrations/20261027120000_stories_v2_safety_c1_technical_policy_prep.sql',
  ],
  functions: [],
  config_changed: false,
  policy_artifact: {
    path: 'docs/stories-v2-content-safety-policy-candidate-v1.json',
    blob: '2c419b551ee344107657a3a8da1fe05d44244e1f',
    sha256: 'c294071c22de46ad66fb73b578b190912b3f21a1e1dfa5e0b15387896a34e9f1',
    policy_id: 'nelyon.stories.general.safety.candidate.v1',
  },
  helper_attestations: [
    { identity: 'private.content_safety_target_snapshot(text,uuid)', definition_sha256: '28a12d9cf823eeebe68017a687f038a68e926bcc9dbb63101f3a0405f8b1a04b', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.content_safety_visual_source(text,uuid)', definition_sha256: '7006dbf8f506852b9a251a891d0329f64f22383a54a5b7e89d4873e152f5666d', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.enqueue_content_safety_scan(text,uuid,text)', definition_sha256: '76020c7fd4cd68169f2e9fc9596a7fcca0e9f6468547d3dd62ed4b24e0d775bb', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.story_author_text_bundle_c1_v1(uuid)', definition_sha256: 'cb4e87cd6da0de3d3aa67c66a30b561ccdb68fbec24e0a9264779400ec840a73', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.story_can_access(uuid,boolean)', definition_sha256: 'dbe04e1de005c3a4b5428866c4a750c7abc6c8df4dd9272b10b0b9fd0aa00aa7', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: true, public: false, service_role: false } },
    { identity: 'private.story_content_safety_candidate_c1_v1(uuid)', definition_sha256: '6eb36a146908d378eeebdb0ca7a24f33ac1cb3876213bafb74f79ccfb2b0be9d', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.story_content_safety_control_c1_v1()', definition_sha256: 'eeb34ea22b46c7373915083212e6f82bcb34afdf1921db956d9221529156d379', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.story_content_safety_policy_c1_v1()', definition_sha256: '2e7881a96094970ef987c41dd6166e55c027757a3dacd7d3035cec0b192a5b5a', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.story_current_fingerprint(uuid)', definition_sha256: 'c2b07454cd20c94c9b669fc1b662daede4a89b0a64fd1954eae651e1e2c30014', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.story_enqueue_media_safety_v1(uuid)', definition_sha256: '9be19b0ae8f8232f68d47202fc5e2a33a2548c5c68ed59b5021221e8cd0f2ca9', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.story_refresh_safety_from_transcript_c1_v1()', definition_sha256: '56dd495f6fe8197f234c2d5ca55134f0f529b9a949ce7c61dae73c42d6910dcb', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
    { identity: 'private.story_sync_safety_from_scan_v1()', definition_sha256: '5d07e049fbbe595239f09f39561d820d267d176ca8f3d2834613e7d44e96fb26', owner: 'postgres', security_definer: true, search_path: ['search_path=""'], execute: { anon: false, authenticated: false, public: false, service_role: false } },
  ],
  trigger_attestation: {
    name: 'content_safety_story_transcript_refresh_c1',
    table: 'private.content_safety_audio_transcripts',
    enabled: 'O',
    function_identity: 'private.story_refresh_safety_from_transcript_c1_v1()',
    definition_sha256: '5af6160fc3312ff676295ec876b7b5d1d75fef56e9b81a70aa99028626252de5',
  },
  safety: {
    activation: false,
    automatic_allow_authorized: false,
    automatic_block_authorized: false,
    auto_publish_enabled: false,
    decisions: ['pending', 'review'],
    mode: 'fail_closed_review',
    owner_approved_policy: false,
  },
  finance_policy: {
    platform_fee_bps: 2000,
    purchase_enabled: true,
    refunds_enabled: true,
    subscription_enabled: true,
  },
  requires_separate_baseline_promotion: true,
});
export const F3_C2_ADMIN_FINANCE_NEGATIVE_AUTHORIZATION_EVIDENCE = Object.freeze({
  version: 'creator-premium-f3-c2-admin-finance-negative-authorization-v1',
  migration_path: F3_C2_FINANCE_AUTHORITY_TRANSITION.migration_path,
  test_path: 'tests/nelyonProductionSnapshotAdapter.test.mjs',
  rpc: 'public.search_admin_creator_premium_finance_v1(text,text,text,timestamp with time zone,uuid,integer)',
  cases: Object.freeze([
    Object.freeze({ actor: 'anon', expected: 'acl_denied' }),
    Object.freeze({ actor: 'service_role', expected: 'acl_denied' }),
    Object.freeze({ actor: 'authenticated_without_admin_role', expected: 'admin_capability_forbidden' }),
    Object.freeze({ actor: 'authenticated_moderator_without_finance_ledger_read', expected: 'admin_capability_forbidden' }),
    Object.freeze({ actor: 'authenticated_super_admin_with_finance_ledger_read', expected: 'allowed' }),
  ]),
});
export const F3_C2_ADMIN_FINANCE_NEGATIVE_AUTHORIZATION_EVIDENCE_SHA256 = sha256Hex(
  canonicalJson(F3_C2_ADMIN_FINANCE_NEGATIVE_AUTHORIZATION_EVIDENCE),
);
export const F3_FINAL_WALLET_MIGRATION =
  '20261025231500_creator_premium_f3_final_wallet_integration';
export const F3_FINAL_WALLET_MIGRATION_BLOB =
  'cdcb1e2bd4db2e2e61c7e5815d62daf27cf15fba';
export const F3_FINAL_WALLET_SOURCE_SHA =
  '584c29978bd903e44b436db4417d458946bc2119';
export const F3_FINAL_LEDGER_PROVISIONING_NEGATIVE_AUTHORIZATION_EVIDENCE = Object.freeze({
  version: 'creator-premium-f3-final-ledger-provisioning-negative-authorization-v1',
  migration_path: `supabase/migrations/${F3_FINAL_WALLET_MIGRATION}.sql`,
  test_path: 'tests/creatorPremiumF3C2Local.integration.mjs',
  rpc: 'public.ensure_my_ledger_account()',
  cases: Object.freeze([
    Object.freeze({ actor: 'anon', expected: 'acl_denied' }),
    Object.freeze({ actor: 'service_role', expected: 'acl_denied' }),
    Object.freeze({ actor: 'authenticated_without_jwt_sub', expected: 'ledger_account_auth_required' }),
    Object.freeze({ actor: 'authenticated_without_profile', expected: 'ledger_account_profile_required' }),
    Object.freeze({ actor: 'authenticated_attempting_other_owner', expected: 'parameterized_authority_acl_denied' }),
    Object.freeze({ actor: 'authenticated_profile_owner', expected: 'own_zero_balance_account_only' }),
    Object.freeze({ actor: 'authenticated_profile_owner_concurrent_replay', expected: 'single_account_same_id' }),
    Object.freeze({ actor: 'authenticated_existing_account', expected: 'identity_balance_and_frozen_state_preserved' }),
    Object.freeze({ actor: 'authenticated_profile_owner_no_finance_side_effects', expected: 'transactions_entries_journal_velocity_authorizations_policy_unchanged' }),
  ]),
});
export const F3_FINAL_LEDGER_PROVISIONING_NEGATIVE_AUTHORIZATION_EVIDENCE_SHA256 = sha256Hex(
  canonicalJson(F3_FINAL_LEDGER_PROVISIONING_NEGATIVE_AUTHORIZATION_EVIDENCE),
);
export const F3_REMOTE_BDAG_LEDGER_EZBR_SHA256 =
  'd039819170e2c347ac8a6c88f77fa4461dfae4091a9e937ed47897b2c115e56c';
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const EXACT_MODES = ['plan_only', 'gate_proof', 'release', 'admin_recovery', 'postcheck_recovery'];
const ADMIN_RECOVERY_POLICY = Object.freeze({
  source_event: 'workflow_dispatch',
  source_ref: 'refs/heads/main',
  source_mode: 'release',
  source_conclusion: 'failure',
  same_approved_sha_required: true,
  supabase_post_snapshot_status: 'success',
  supabase_postcheck_status: 'success',
  admin_enabled_required: true,
  admin_finalize_status: 'not_success',
  rollback_required_after_candidate_or_promote: true,
  productive_resources: [],
  supabase_mutation_allowed: false,
});

function isReadOnlyRecoveryMode(mode) {
  return mode === 'postcheck_recovery' || mode === 'admin_recovery';
}
const A2_NEGATIVE_TEST_EVIDENCE_SHA256 = '47f15e3fa7f5b377738a171f56632d72ed2d1fe8924d42417cca38371f17798e';
const B7_MIGRATION = '20261010053524_creator_premium_b7_full_functional_commercial_completion';
const B7_MIGRATION_BLOB = '43f014260e0ecfa6f0634e61e1646594bcf13e1d';
const B7_SOURCE_SHA = '0560b9e1fdc0869dfcd4d04f081de03ba31b66cb';
const C1_NEGATIVE_TEST_EVIDENCE_SHA256 = 'ca8588f28303eb27e251207a72a85a35b7c75c794664ebe6132ddb3a6cdf984c';
const C1_MIGRATION = '20261017193000_creator_premium_c1_submission_cancellation';
const C1_MIGRATION_BLOB = '4605ac94221a52d47190b1575ab1a71e23c82fac';
const C1_SOURCE_SHA = 'aa722ea6f1bb9aef6fc49da64c4c6dc8303b4e95';
const F1_C4_NEGATIVE_TEST_EVIDENCE_SHA256 = '88f4dd9874b57cc9235b2f86b391fa6b9a5884ebe722297d81fbffa289bdaf0f';
const F1_C4_MIGRATION = '20261019023431_creator_premium_f1_c4_final_recovery';
const F1_C4_MIGRATION_BLOB = '185fdfb7c0216776fa540fe5009afdee4f2b57bb';
const F1_C4_SOURCE_SHA = '506f7b669d6d1dce42b273ae51e456b90ca2e6a5';
const F1_C6_NEGATIVE_TEST_EVIDENCE_SHA256 = '805d91901ca2a82715fa9e647705fef78a00b30e505aa624fdb3ac568f4c29df';
const F1_C6_MIGRATION = '20261019170853_creator_premium_f1_c6_submit_unavailable_mapping_recovery';
const F1_C6_MIGRATION_BLOB = 'af810d8dc1940f08907408305e2373a838d4db60';
const F1_C6_SOURCE_SHA = '01bd67f914b151129d9d3659e1ec79581ea76227';
const P3_C2_NEGATIVE_TEST_EVIDENCE_SHA256 = 'ae0206b79e90c6af6cacb6f11444437211467c7323c7667078c05c9d6b9446cb';
const P3_C2_MIGRATION = '20261020030515_creator_premium_p3_c2_admin_restriction_recovery';
const P3_C2_MIGRATION_BLOB = '3cb930ae07e72e8a49c862556057822128a1087a';
const P3_C2_SOURCE_SHA = 'd8fc23a8d823494df68af7aaf93314c30631b5aa';
const F2_NEGATIVE_TEST_EVIDENCE_SHA256 = '222539db2b37c976322690504e9d7574d59343adf7aef9ab83262a88c665c2d8';
const F2_MIGRATION = '20261024173500_creator_premium_f2_complete_monetization';
const F2_MIGRATION_BLOB = 'fce8789a0c79251afbe962bd39f6bd81ae248296';
const F2_SOURCE_SHA = '97f6638acaa5be2af336b427184c11185e3d0fe1';
const F2_MANAGED_SCOPE_TRANSITION = Object.freeze({
  id: 'creator-premium-f2-bdag-ledger-enrollment-v1',
  state: 'attested_one_time',
  resource: 'bdag-ledger',
  from_classification: 'unmanaged',
  to_classification: 'managed',
  baseline_sha: '9b4a5d15a6746e11a27bc1d9edafeab10e7d421d',
  attested_source_sha: F2_SOURCE_SHA,
  migration: F2_MIGRATION,
  migration_blob: F2_MIGRATION_BLOB,
  function_source_sha256: '06a7f77242df926411f7aae44eb808f8bb1ce1e88b8a342376911f1e6519e8fa',
  finance_off_required: true,
  requires_postcheck: true,
  requires_separate_baseline_promotion: true,
});
const SECURITY_ADVISOR_RPC_EXCEPTIONS = [
  ['f9c25bdf8e5c7f7ff7385410370dac9fe2ded1a0468f76d8bd2d265186718f32', 'get_creator_premium_commerce_v1', ['uuid'], 'p_content_id uuid', 'e96caaab2c8ad2cd24e508849c0a7fff15d0257ac7a55a035aaa59b8632ed5c0', F2_NEGATIVE_TEST_EVIDENCE_SHA256, F2_MIGRATION, F2_MIGRATION_BLOB, F2_SOURCE_SHA],
  ['b5ca8be9cf9433a21ee7f19906d8a23340ef629d6cedd414c196b431ab5dfaf1', 'get_admin_creator_premium_content_v1', ['uuid'], 'p_content_id uuid', 'da4ae0e4416fc032f0b0cb3dfad00b6e1c5b95592bfa6b7ae926964b696f79bc', P3_C2_NEGATIVE_TEST_EVIDENCE_SHA256, P3_C2_MIGRATION, P3_C2_MIGRATION_BLOB, P3_C2_SOURCE_SHA],
  ['16793ac45491560ceb15eed84a53c946830aca9f3c1dad338a98e42c539aad18', 'admin_refund_creator_premium_subscription_period_v1', ['uuid', 'uuid', 'text'], 'p_period_id uuid, p_idempotency_key uuid, p_reason_code text', '592df071aa52e846d7034e79c61f114f00eaf49d24dccd3682536e83377439ca', A2_NEGATIVE_TEST_EVIDENCE_SHA256, B7_MIGRATION, B7_MIGRATION_BLOB, B7_SOURCE_SHA],
  ['ed55682047d682b69c66430b68fc819fb781b7289539fa398fadf09ec0c064fc', 'get_my_creator_premium_commercial_summary_v1', ['timestamp with time zone', 'timestamp with time zone'], 'p_from timestamp with time zone, p_to timestamp with time zone', 'e4f4cb3d311ba740bd9827b821c28ba2069be49adfad954b29ba790a6bd3dadb', F2_NEGATIVE_TEST_EVIDENCE_SHA256, F2_MIGRATION, F2_MIGRATION_BLOB, F2_SOURCE_SHA],
  ['b835139bebe4b813b730fca29d6eeec2a3e7d70a187e0c36b9169d7e84faba1d', 'get_my_creator_premium_financial_history_v1', ['text', 'text', 'timestamp with time zone', 'uuid', 'integer'], 'p_perspective text, p_source text, p_cursor_event_at timestamp with time zone, p_cursor_event_id uuid, p_limit integer', '564fe988b3f6078c559bfd9aa8243b1705c43ec7aa8824248110722fb507f1f2', F2_NEGATIVE_TEST_EVIDENCE_SHA256, F2_MIGRATION, F2_MIGRATION_BLOB, F2_SOURCE_SHA],
  ['95f426ce02f0b60b9ac06e78d26d4171ec2d74aef205a06a6bc111142d1a923d', 'search_admin_creator_premium_content_v1', ['text', 'text', 'timestamp with time zone', 'uuid', 'integer'], 'p_status text, p_query text, p_cursor_submitted_at timestamp with time zone, p_cursor_id uuid, p_limit integer', '0379d81bef4b106861b9b59962f52e480b7b48cc1205eae938f238d1fd04ece6', A2_NEGATIVE_TEST_EVIDENCE_SHA256, B7_MIGRATION, B7_MIGRATION_BLOB, B7_SOURCE_SHA],
  ['cf4b6520e9c96170ea5a5125f287b991d15c377e80cf3394f879dc1cbad0e6ae', 'get_my_creator_premium_subscriptions_v1', ['timestamp with time zone', 'uuid', 'integer'], 'p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_limit integer', '8cf06818806f7b82dc9773ef87821897c6c861f3921e0bfc2cd804855545dfb3', F2_NEGATIVE_TEST_EVIDENCE_SHA256, F2_MIGRATION, F2_MIGRATION_BLOB, F2_SOURCE_SHA],
  ['32e1071c786f8cd3afe8867b7dd583e26420bb55845639a6458f724779e389b0', 'admin_review_creator_premium_content_v1', ['uuid', 'text', 'text', 'uuid'], 'p_content_id uuid, p_action text, p_reason text, p_idempotency_key uuid', '9d2a0fdc8982eb44b9e6e2603938649305446aaf512f4bea9f930ee192d8377f', A2_NEGATIVE_TEST_EVIDENCE_SHA256, B7_MIGRATION, B7_MIGRATION_BLOB, B7_SOURCE_SHA],
  ['81ffb44830028e3a76316686c2bd2d8f38b4f4b26b7d4f93a3c0c94a168e4852', 'report_creator_premium_content_v1', ['uuid', 'text', 'text'], 'p_content_id uuid, p_reason text, p_details text', '923bce96a9cc00e71174c1aa811b791ba11710c9b370295f7474729d928d992c', A2_NEGATIVE_TEST_EVIDENCE_SHA256, B7_MIGRATION, B7_MIGRATION_BLOB, B7_SOURCE_SHA],
  ['64e0ec779a8bd54824caf58605677e58ef589a62b2a53e4beb216907d3e002ee', 'reopen_my_creator_premium_rejected_v1', ['uuid'], 'p_content_id uuid', '091cb8b2f35c9e76f515295e45310bbee9af8e6a1567d26ddfa0be34b5ceba5d', A2_NEGATIVE_TEST_EVIDENCE_SHA256, B7_MIGRATION, B7_MIGRATION_BLOB, B7_SOURCE_SHA],
  ['b55221bf7e4ec14f761ca29bc13589854080dccb3049e7dbcd996c37eb7223cf', 'get_admin_creator_premium_refund_candidates_v1', ['uuid'], 'p_content_id uuid', '9f35908f01a3ff9100f0fc2d562d4c2471a33bb15a54d1dbbcf754bacde9ea00', A2_NEGATIVE_TEST_EVIDENCE_SHA256, B7_MIGRATION, B7_MIGRATION_BLOB, B7_SOURCE_SHA],
  ['38f8cee50f0713a548ea30ea5d3d7cb5d9151bd97b4885da47cc2726b83706ca', 'admin_refund_creator_premium_purchase_v1', ['uuid', 'uuid', 'text'], 'p_receipt_id uuid, p_idempotency_key uuid, p_reason_code text', '13a0a7da560d681b0b04a8505bc09eb1fe12e31cf04779be984872f926ee6d45', A2_NEGATIVE_TEST_EVIDENCE_SHA256, B7_MIGRATION, B7_MIGRATION_BLOB, B7_SOURCE_SHA],
  ['053c9a441c11dc657382c6448b017d8fcf73c16fb5a3e4baf6275e24e2216129', 'cancel_my_creator_premium_submission_v1', ['uuid'], 'p_content_id uuid', '5be58f4d190e19a04ed32c7de88d1ace55778ac68c5c39d21cac5ad979f27a57', C1_NEGATIVE_TEST_EVIDENCE_SHA256, C1_MIGRATION, C1_MIGRATION_BLOB, C1_SOURCE_SHA],
  ['1c20753b55dcdb2d0a8e6a3365fcf45453495a74a49d76b9b51af4e51d7b923f', 'submit_my_creator_premium_content_with_plans_v1', ['uuid', 'uuid[]', 'uuid'], 'p_content_id uuid, p_plan_ids uuid[], p_client_request_id uuid', '00e9195a045185a65ca260a9abacc6916b289f7b1a2cf094cdaf9d4d86f55eff', F1_C6_NEGATIVE_TEST_EVIDENCE_SHA256, F1_C6_MIGRATION, F1_C6_MIGRATION_BLOB, F1_C6_SOURCE_SHA],
  ['b0cdd5e8a440096ebc6bbd35fee9b785180d71ae6d06209ade7feaa6c0877c4d', 'retire_my_creator_premium_content_v1', ['uuid'], 'p_content_id uuid', 'ac6cd5a65b129c471184ffb080a5a80dcfb2c3283daf5fb2c2100a945e340580', F2_NEGATIVE_TEST_EVIDENCE_SHA256, F2_MIGRATION, F2_MIGRATION_BLOB, F2_SOURCE_SHA],
  ['5ceb93fa71004f64ba75a7bd251fadaf66d7ebdce81fb48904fd988ed9023fef', 'delete_my_creator_premium_plan_draft_v1', ['uuid', 'uuid'], 'p_plan_id uuid, p_client_request_id uuid', 'a7bab775b77a5230658cea58c7bcb9f139b4b6102c89c1095a5e3f5d8548d520', F1_C4_NEGATIVE_TEST_EVIDENCE_SHA256, F1_C4_MIGRATION, F1_C4_MIGRATION_BLOB, F1_C4_SOURCE_SHA],
  ['f6c527ed886225b79c3412747e8f8375e7552634febc03b37917123f02649109', 'search_admin_creator_premium_finance_v1', ['text', 'text', 'text', 'timestamp with time zone', 'uuid', 'integer'], 'p_source text, p_state text, p_query text, p_cursor_created_at timestamp with time zone, p_cursor_reference_id uuid, p_limit integer', '90d68ed26584e9994b1ff64fbf6e44eaa6b443368bfabe83eb1c0a73fce84cf7', F2_NEGATIVE_TEST_EVIDENCE_SHA256, F2_MIGRATION, F2_MIGRATION_BLOB, F2_SOURCE_SHA],
  ['acc6db2023e39518a9407ac3dada47063023550ae9f275eb058b6f6aff32753e', 'ensure_my_ledger_account', [], '', '6c0980c34a5e058b1ebda227fb64c87ff74fc69f874c9144742c9197fd6a9190', F3_FINAL_LEDGER_PROVISIONING_NEGATIVE_AUTHORIZATION_EVIDENCE_SHA256, F3_FINAL_WALLET_MIGRATION, F3_FINAL_WALLET_MIGRATION_BLOB, F3_FINAL_WALLET_SOURCE_SHA],
];
const B7_EDGE_ATTESTATIONS = [
  ['ads-v2-delivery', 10, true, '4510ecc897a50a2f9e23d0b326f9bdfc630ce88e5f7bcea0c59e9476233d0536'],
  ['cleanup-stale-media-uploads', 51, false, 'f12df4ce69b11715faee6cb81a3afe7a8b6b275798c0a47e1442ea884dffce8d'],
  ['content-safety-scan', 37, true, '5679bcb30867773fd1c31fde36b9f151405db58da76c92261d8a05b908213031'],
  ['create-media-upload', 69, true, 'd8f337b1cbb2c2689bfe8b58c7a1287a3ae060cfafef3845d113b523d4a1d6f8'],
  ['create-stream-upload', 35, true, '0f9c5d5e8075c016441eb3c3f6fd2c388f72218c5af98a7cc899aa021d28a595'],
  ['delete-media-asset', 51, true, 'a3d441e5534c912df4dd7f6ea99ad513e77c834f50a400b3bab04d8862e02b04'],
  ['delete-stream-video', 31, true, 'afdc14dd7f6180cbc9f5be8652850b0a51ea996d076c157e494ff1d963aafd23'],
  ['finalize-media-upload', 55, true, 'ed7061239a3b23c0580a7ba7246b78f873de24f5492f823167709a427bdc74ce'],
  ['get-media-url', 62, true, '033f50f797c7d696a538a12018b653ccdbe4499642be29000a0b33109db8f3da'],
  ['get-stream-playback', 32, true, '122db3b68c4b86959d3a26721dfd2901b3d2a255b5b1b57363db7c90a577c333'],
  ['stream-webhook', 33, false, 'c123e8a35d729c9909bdd690dcf620d0259da5c4aac553aeeb1874fa60bf6475'],
  ['video-semantic-index', 10, true, '81a0d1119016d1e4c56958f4d9a51afc5bf99552a9cd56cf8079c9adfafcaae5'],
];
const P2_RELATION_ADVISOR_EXCEPTION = {
  advisor_fingerprint: '8088d6be7ca6bd32b041ed429091a56f26d26ac0d7148eb5bf15f9e3c5e70bd6',
  advisor_type: 'table',
  advisor_severity: 'INFO',
  object: { schema: 'private', name: 'creator_premium_content_safety_context_evaluations' },
  attestation: {
    owner: 'postgres',
    rls_enabled: true,
    force_rls: true,
    acl: ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
      .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })),
  },
  authorization: {
    functional_reason: 'Stores private service-only P2 contextual evidence; the absence of permissive RLS policies is intentional fail-closed isolation.',
    controls: ['force_rls', 'negative_authorization_tests', 'owner_only_acl', 'private_schema', 'service_rpc_only'],
    negative_test_evidence_sha256: '3d84738f44200f1198ab7e61aff788e4fc847f7ced6139f5fa73632e993a1d0e',
  },
  origin: {
    migration: '20261018170000_creator_premium_content_safety_p2_evidence_runtime',
    migration_blob: '8cb2e43095a733c60c5753f7a80f4e1ed2e1c4cd',
    source_sha: 'b2e20b64fad627fc732db66e6b3c3088f5371fbc',
  },
  technical_approval: 'verified',
};
const EXPECTED_RECOVERY_SOURCES = [{
  run_id: '39066492485',
  run_attempt: 1,
  release_id: 'nelyon-b7-autonomous-20261017T202315Z',
  source_sha: B7_SOURCE_SHA,
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'success',
  postcheck_status: 'failure',
  gate_artifact: { id: '12113681896', name: 'nelyon-gate-evidence-39066492485-1', digest: 'sha256:6413dc245e07f96266501b784313c26d241868bcefe420ae13db9aad0b16960f' },
  release_artifact: { id: '12113447451', name: 'nelyon-release-39066492485-1', digest: 'sha256:c468111c29831e708a6f9545e3276604bc84b879a0a2a01994f1178da3b87099' },
  manifest_sha256: '95700e7ad2221bf113b58da0719f41feed40f76389caeba59e3457d603998045',
  pre_snapshot_evidence_sha256: '5866d0a628eb390ed47b21b17c0910387274a213a0d70702fd8253cc143aee38',
  post_snapshot_evidence_sha256: '0625cc7c5509b1c48b442fca8cab715bbbcd759ea1dc154044cc574a76cf6ad6',
  expected_migrations: [{ blob: B7_MIGRATION_BLOB, name: B7_MIGRATION }],
  expected_migration_count: 337,
  expected_latest_migration: B7_MIGRATION,
  edge_functions: B7_EDGE_ATTESTATIONS.map(([name, version, verify_jwt, source_sha256]) => ({
    name, source_sha256, status: 'ACTIVE', verify_jwt, version,
  })),
  productive_resources: [
    `migration:${B7_MIGRATION}`,
    ...B7_EDGE_ATTESTATIONS.map(([name]) => `function:${name}`),
  ],
  premium_relation_security_sha256: 'c0a6af305569c7cafa7c2bd84d8c4a715ede9409a984be709ffdfd0ffe935b3c',
  premium_legacy: { content_count: 2, pending_review_count: 1, deleted_count: 1 },
}, {
  run_id: '39157300357',
  run_attempt: 1,
  release_id: 'nelyon-p2-technical-release-20261018T190718Z',
  source_sha: 'b2e20b64fad627fc732db66e6b3c3088f5371fbc',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'success',
  postcheck_status: 'failure',
  gate_artifact: { id: '12147615800', name: 'nelyon-gate-evidence-39157300357-1', digest: 'sha256:3a6369bcb8a3b69ef5a3b804a47dc245bd06ad9de2033b0f7afa84b9f48f0cfe' },
  release_artifact: { id: '12147188981', name: 'nelyon-release-39157300357-1', digest: 'sha256:53caa1369fc09b3a5f1d81db25565f6e8bf1a8b99f457cea0ea709b7b39c5bbc' },
  manifest_sha256: '11eb4044e5e0f4900b8e2f68be050b2eb95b8e59aac60f5cf82d2ccda64673b0',
  pre_snapshot_evidence_sha256: '942690271875e7ab055138cafc9b2b087c61a9151c357354488169913ac9b589',
  post_snapshot_evidence_sha256: '253b9eb6b2a8c42a3a2627b14da3f4a569cc8c3481658048fbc2df4e11a1a5bb',
  expected_migrations: [{
    blob: '8cb2e43095a733c60c5753f7a80f4e1ed2e1c4cd',
    name: '20261018170000_creator_premium_content_safety_p2_evidence_runtime',
  }],
  expected_migration_count: 341,
  expected_latest_migration: '20261018170000_creator_premium_content_safety_p2_evidence_runtime',
  edge_functions: [{
    name: 'content-safety-scan',
    source_sha256: '74777e11d9df4b14c079131dc514233d2f3932424512cb740c15c497849d35ad',
    status: 'ACTIVE',
    verify_jwt: true,
    version: 42,
  }],
  productive_resources: [
    'migration:20261018170000_creator_premium_content_safety_p2_evidence_runtime',
    'function:content-safety-scan',
  ],
  premium_relation_security_sha256: '055e1a5d6b3d452951a4843a99eb4b6a1bc144f387baa559c3a32c9e0fe674b6',
  premium_legacy: { content_count: 4, pending_review_count: 2, deleted_count: 2 },
}, {
  run_id: '39195966131',
  run_attempt: 1,
  release_id: 'nelyon-f1-c4-release-20261019T034232Z',
  source_sha: '6cde9b5566c0753b10a1588e8f58568030d37a61',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'success',
  postcheck_status: 'failure',
  gate_artifact: { id: '12162171385', name: 'nelyon-gate-evidence-39195966131-1', digest: 'sha256:194cf8aeffa3fb6564cdf97d7de0caee9c26802cf3384d689aacf7e3438e988c' },
  release_artifact: { id: '12162096718', name: 'nelyon-release-39195966131-1', digest: 'sha256:8a1f4a917c1424b1f10d534db105e198ed28fdfc448fe4c8a8f5ccf296a33990' },
  manifest_sha256: '321fa5a3f1fb94b2d1fc72201dbb99d4e5590f76888d4a8c015a6b69825dba9b',
  pre_snapshot_evidence_sha256: 'db71ba150ae31ad27374f7fa040ec7290bde317a5dd32de8d5c8896896baed7e',
  post_snapshot_evidence_sha256: '644613ef0381bff84681621136a66e6f2be1e8c11ca28f0c32e109c052f764ec',
  expected_migrations: [{ blob: F1_C4_MIGRATION_BLOB, name: F1_C4_MIGRATION }],
  expected_migration_count: 344,
  expected_latest_migration: F1_C4_MIGRATION,
  edge_functions: [
    {
      name: 'content-safety-scan',
      source_sha256: '129672deb1a9efdbad313d4336833267d617213e0d8c1ea2513252236d0e2cd5',
      status: 'ACTIVE',
      verify_jwt: true,
      version: 44,
    },
    {
      name: 'create-stream-upload',
      source_sha256: '7307fc35234ef56bb626555da0a4cec2110e8cf0774984c55ece1db56c7136f9',
      status: 'ACTIVE',
      verify_jwt: true,
      version: 38,
    },
    {
      name: 'video-semantic-index',
      source_sha256: '1eb68be8fe9add87f4c7059d2beb9c06af2b915e6b84374464a7a41f3232e151',
      status: 'ACTIVE',
      verify_jwt: true,
      version: 15,
    },
  ],
  productive_resources: [
    `migration:${F1_C4_MIGRATION}`,
    'function:content-safety-scan',
    'function:create-stream-upload',
    'function:video-semantic-index',
  ],
  premium_relation_security_sha256: '055e1a5d6b3d452951a4843a99eb4b6a1bc144f387baa559c3a32c9e0fe674b6',
  premium_legacy: { content_count: 7, pending_review_count: 1, deleted_count: 2 },
}, {
  run_id: '40139736749',
  run_attempt: 1,
  release_id: 'nelyon-creator-premium-f2-r1-release-20261024T224205Z',
  source_sha: '238e987933c7198400534121e61fb3d2750ba5ba',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'success',
  postcheck_status: 'failure',
  gate_artifact: { id: '12577384242', name: 'nelyon-gate-evidence-40139736749-1', digest: 'sha256:3d42fb5d672e5d36012238ac4c46740f019c278977e8dd9c2b3085d5593775c7' },
  release_artifact: { id: '12576994701', name: 'nelyon-release-40139736749-1', digest: 'sha256:8f0db1f147d42e6aed6fe1a0978c16fa0ebef37a7a53dbc8f7ac6600c0189e08' },
  manifest_sha256: '4e798ee48a8d83d26c8608803b26099a6d22521d43a585d7735754969fe45a12',
  pre_snapshot_evidence_sha256: '7d67a623ff91a8b583095950c402a111819690a7b028765eb4e1c85d6047b138',
  post_snapshot_evidence_sha256: 'f2b3196e54f6ff9534c268afbfcc21c586182c883e929b3d6e4e8b32399c8c5a',
  expected_migrations: [{ blob: F2_MIGRATION_BLOB, name: F2_MIGRATION }],
  expected_migration_count: 351,
  expected_latest_migration: F2_MIGRATION,
  edge_functions: [{
    name: 'bdag-ledger',
    source_sha256: '0b0db8c46041127dac341dfaa9673a7da4b15747ac71639bdeed00e8097be002',
    status: 'ACTIVE',
    verify_jwt: true,
    version: 45,
  }],
  productive_resources: [
    `migration:${F2_MIGRATION}`,
    'function:bdag-ledger',
  ],
  premium_relation_security_sha256: '055e1a5d6b3d452951a4843a99eb4b6a1bc144f387baa559c3a32c9e0fe674b6',
  premium_legacy: { content_count: 9, pending_review_count: 0, deleted_count: 5 },
}, {
  run_id: '40166468648',
  run_attempt: 1,
  release_id: 'nelyon-creator-premium-f3-release-20261025T054152Z',
  source_sha: '8908c4f9e6b5d48614301e51b16793ed7ae6f895',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'failure',
  postcheck_status: 'skipped',
  gate_artifact: { id: '12588777217', name: 'nelyon-gate-evidence-40166468648-1', digest: 'sha256:f7326c1aca51583a4666d21b66f1a722bed8a758fd8043a8948041cbc35c6aa5' },
  release_artifact: { id: '12587718942', name: 'nelyon-release-40166468648-1', digest: 'sha256:4a5928c1505e63f24d6873cb70dab02361627c7115cdfd5a301790846cd671a7' },
  manifest_sha256: '7f329703901fbe8d6d3a38803b710e68780cb05c17c229ea091f01b5cff67a21',
  pre_snapshot_evidence_sha256: 'e89dcb035fcc61493c9f0703beb666a9eea62a12297142a3675b05479cb983ea',
  post_snapshot_evidence_sha256: null,
  expected_migrations: [{
    blob: F3_FINANCE_AUTHORITY_TRANSITION.migration_blob,
    name: '20261025011000_creator_premium_f3_bounded_financial_activation',
  }],
  expected_migration_count: 352,
  expected_latest_migration: '20261025011000_creator_premium_f3_bounded_financial_activation',
  edge_functions: [{
    name: 'bdag-ledger',
    source_sha256: F3_REMOTE_BDAG_LEDGER_EZBR_SHA256,
    status: 'ACTIVE',
    verify_jwt: true,
    version: 46,
  }],
  productive_resources: [
    'migration:20261025011000_creator_premium_f3_bounded_financial_activation',
    'function:bdag-ledger',
  ],
  premium_relation_security_sha256: '34e13339d4627b7684699288f789780267d7340afbd1c3de33029624e60a2f6a',
  premium_legacy: { content_count: 9, pending_review_count: 0, deleted_count: 5 },
}, {
  run_id: '40268500711',
  run_attempt: 1,
  release_id: 'nelyon-f4-general-activation-release-20261026T041943Z',
  source_sha: '02c238618b05cd01c7388cc592ba7ac426973ce5',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'failure',
  postcheck_status: 'skipped',
  gate_artifact: { id: '12627287792', name: 'nelyon-gate-evidence-40268500711-1', digest: 'sha256:f7fa77ea17764ed291d249e4c97978ca2547696595675f5a54cdfcebc5bd5d9f' },
  release_artifact: { id: '12627322556', name: 'nelyon-release-40268500711-1', digest: 'sha256:85eef5c82a1812db5491a21a3eb3c0e60565906cf7f214fc5cbb54e48e95d122' },
  manifest_sha256: '96d731beeef25b2de5077f525e406727e249a073008653def91b923d4e2e6c17',
  pre_snapshot_evidence_sha256: '3053119dc99ee41e4019222468dd9ec43a393c49b94c4eff1c6e1dc80568f302',
  post_snapshot_evidence_sha256: null,
  expected_migrations: [{
    blob: F4_GENERAL_FINANCE_AUTHORITY_TRANSITION.migration_blob,
    name: '20261026030000_creator_premium_f4_general_bdag_activation',
  }],
  expected_migration_count: 355,
  expected_latest_migration: '20261026030000_creator_premium_f4_general_bdag_activation',
  edge_functions: [],
  productive_resources: [
    'migration:20261026030000_creator_premium_f4_general_bdag_activation',
  ],
  premium_relation_security_sha256: 'ce78623224db34251b55ae8500eaea982d80912378cb3347ad9bf99ee24193a8',
  premium_legacy: { content_count: 9, pending_review_count: 0, deleted_count: 5 },
}, {
  run_id: '40324910390',
  run_attempt: 1,
  release_id: 'nelyon-f5-autonomous-releasefix-20261026T124453Z',
  source_sha: 'ec9e08227801c3ce59f7c01f8db3ed846831160e',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'failure',
  postcheck_status: 'skipped',
  gate_artifact: { id: '12650367997', name: 'nelyon-gate-evidence-40324910390-1', digest: 'sha256:eb70e20802eb55698b20b759ae39f64f063d394f9957cdb24c79cc06a538a06b' },
  release_artifact: { id: '12649504845', name: 'nelyon-release-40324910390-1', digest: 'sha256:012bd9b546fd508410423ed4b94667e981e949904e3606e22505715241b286c6' },
  manifest_sha256: '7f184407b0e5d06da1e28dda45870958736dbd972587fc487b029569dc4f1a9e',
  pre_snapshot_evidence_sha256: '02fbf2d5bb640823197bd79eaec4ae1d92db8bfd7424682a48382cc9da1c323a',
  post_snapshot_evidence_sha256: null,
  expected_migrations: [{
    blob: 'ca08f3a5224cea2ef6b4390bc625d55f378b2ca6',
    name: '20261026072512_creator_premium_f5_autonomous_subscriptions',
  }],
  expected_migration_count: 356,
  expected_latest_migration: '20261026072512_creator_premium_f5_autonomous_subscriptions',
  edge_functions: [{
    name: 'bdag-ledger',
    source_sha256: '0255ad56d7b56792dea46c333cb207dc0680bcdf25a1784d2925b7f85bf0bd8e',
    status: 'ACTIVE',
    verify_jwt: true,
    version: 47,
  }],
  productive_resources: [
    'migration:20261026072512_creator_premium_f5_autonomous_subscriptions',
    'function:bdag-ledger',
  ],
  premium_relation_security_sha256: 'a342b0c22f952cc09160b231e96a109fd096750ffa8a883844f581c5238703b0',
  premium_legacy: { content_count: 9, pending_review_count: 0, deleted_count: 5 },
}, {
  run_id: '40473092474',
  run_attempt: 1,
  release_id: 'nelyon-stories-b1-recovery-release-20261027T082425Z',
  source_sha: '8e2fc6b896e3f409e11087d4f9f423581126b617',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'success',
  postcheck_status: 'failure',
  gate_artifact: { id: '12718644745', name: 'nelyon-gate-evidence-40473092474-1', digest: 'sha256:3c7424e6e3460802bb7ce82685e0d64ff143f905191ecac0e54255582892f14d' },
  release_artifact: { id: '12719247669', name: 'nelyon-release-40473092474-1', digest: 'sha256:47277ff7ea10644227b2e6a983ff5b0d3bd3b1cddf720587defbb9c8afb65e57' },
  manifest_sha256: '4c3435b1cd87ffd416c02b9f720cf4d3e3dd193fa8982e613dafa48fd036bcdf',
  pre_snapshot_evidence_sha256: 'e4afa5e63dd90a12f0a36705c2cb95d5bf4bb1d9301803e47f5647aa932e9dfb',
  post_snapshot_evidence_sha256: '02b5cac2604b282293367a6d2f224c2e4316b0f6d371a9bd92bb9c89e62025ee',
  expected_migrations: [{
    blob: '9b7d8ce8b1e375d1f4b4a1dfde8c1ec032d23ae4',
    name: '20261027042552_stories_v2_interactive_b1',
  }],
  expected_migration_count: 358,
  expected_latest_migration: '20261027042552_stories_v2_interactive_b1',
  edge_functions: [
    { name: 'cleanup-stale-media-uploads', source_sha256: '62558bb99e36094e33a431d84ee1edb48ea8d22d07dce0c00f9c8cb6ad4eee80', status: 'ACTIVE', verify_jwt: false, version: 53 },
    { name: 'content-safety-scan', source_sha256: '3c8a861fbfa37b2d9ee0f8452938a072498645929ae22175ac5f319bbc54ef43', status: 'ACTIVE', verify_jwt: true, version: 48 },
    { name: 'create-media-upload', source_sha256: '189b25cfc8172ea1561a3e5ac1e3b03c654943cd7ee4147a7017ed17d966e297', status: 'ACTIVE', verify_jwt: true, version: 71 },
    { name: 'create-stream-upload', source_sha256: '67c78125ad77c07d942cc91e5dc757f0461aee6ab7e68f3f9af87ce6623794b3', status: 'ACTIVE', verify_jwt: true, version: 40 },
    { name: 'get-stream-playback', source_sha256: 'a47954442c6c90effb3d1e0bb53f18687bfdb8e1c7557d63a2fddc379034ca65', status: 'ACTIVE', verify_jwt: true, version: 34 },
    { name: 'stream-webhook', source_sha256: '2b16c3e5a7fff1795fa324d6dcbf0648ca5432b9e53b65597cd8d53ec154ee58', status: 'ACTIVE', verify_jwt: false, version: 35 },
  ],
  edge_transitions: [
    { name: 'cleanup-stale-media-uploads', from: { source_sha256: '49534a2cdc109302045430ced2d93c6b93672320b06b422a0cece0b1064f782a', status: 'ACTIVE', verify_jwt: false, version: 52 }, to: { source_sha256: '62558bb99e36094e33a431d84ee1edb48ea8d22d07dce0c00f9c8cb6ad4eee80', status: 'ACTIVE', verify_jwt: false, version: 53 } },
    { name: 'content-safety-scan', from: { source_sha256: 'ffc17f3c8f753e1bebc3adca0f75acba840342657594a0b344a52c96ff8610a2', status: 'ACTIVE', verify_jwt: true, version: 47 }, to: { source_sha256: '3c8a861fbfa37b2d9ee0f8452938a072498645929ae22175ac5f319bbc54ef43', status: 'ACTIVE', verify_jwt: true, version: 48 } },
    { name: 'create-media-upload', from: { source_sha256: '6fffd4b5d83704194f8e6440063d0d9a2c08aa98c56f6c65387c35f0d7ae06a4', status: 'ACTIVE', verify_jwt: true, version: 70 }, to: { source_sha256: '189b25cfc8172ea1561a3e5ac1e3b03c654943cd7ee4147a7017ed17d966e297', status: 'ACTIVE', verify_jwt: true, version: 71 } },
    { name: 'create-stream-upload', from: { source_sha256: '72518a020d99282d4ec3b9e0f3535d6a09ed74f3ab350cbf42efc93b7bf2bf2e', status: 'ACTIVE', verify_jwt: true, version: 39 }, to: { source_sha256: '67c78125ad77c07d942cc91e5dc757f0461aee6ab7e68f3f9af87ce6623794b3', status: 'ACTIVE', verify_jwt: true, version: 40 } },
    { name: 'get-stream-playback', from: { source_sha256: '10098f5c77d0e5d9458e8f6a807d376e36bcf4d2f75583c149084c7b10a39565', status: 'ACTIVE', verify_jwt: true, version: 33 }, to: { source_sha256: 'a47954442c6c90effb3d1e0bb53f18687bfdb8e1c7557d63a2fddc379034ca65', status: 'ACTIVE', verify_jwt: true, version: 34 } },
    { name: 'stream-webhook', from: { source_sha256: 'd587007d84e967d3cfa17d34d44087afd9fe51950fb76ad057ecfd3ffa206799', status: 'ACTIVE', verify_jwt: false, version: 34 }, to: { source_sha256: '2b16c3e5a7fff1795fa324d6dcbf0648ca5432b9e53b65597cd8d53ec154ee58', status: 'ACTIVE', verify_jwt: false, version: 35 } },
  ],
  productive_resources: [
    'migration:20261027042552_stories_v2_interactive_b1',
    'function:cleanup-stale-media-uploads',
    'function:content-safety-scan',
    'function:create-media-upload',
    'function:create-stream-upload',
    'function:get-stream-playback',
    'function:stream-webhook',
  ],
  premium_relation_security_sha256: 'a342b0c22f952cc09160b231e96a109fd096750ffa8a883844f581c5238703b0',
  premium_legacy: { content_count: 9, pending_review_count: 0, deleted_count: 5 },
}, {
  run_id: '41243646356',
  run_attempt: 1,
  release_id: 'SUPERUSER-CC-R1-RELEASE-20261031T212706Z',
  source_sha: '58a71b66f07899d16b780f6f967279677dcc2ed4',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'success',
  postcheck_status: 'success',
  gate_artifact: {
    id: '13058825109',
    name: 'nelyon-gate-evidence-41243646356-1',
    digest: 'sha256:a24a2f576a0ac9cc0758185f3b0a6af9d3a4951cb8e8d69cf293728bd1b42d61',
  },
  release_artifact: {
    id: '13058620158',
    name: 'nelyon-release-41243646356-1',
    digest: 'sha256:405dbdf54a561f119fbf15d379219d2214dfe2e3ec72bd53dbe8ee750e50fce3',
  },
  manifest_sha256: 'f0cedb82c8b756eb847d4175ae6378a8fc6f7a13c21a0fc8b0992b2826069030',
  pre_snapshot_evidence_sha256: 'e63a14dc49f18c081958b0f12999870dd2402d925fcc1dfd9615c87cbf932605',
  post_snapshot_evidence_sha256: '465a51991e3494cd9280129ca59cc736b3c7a5e2b627f5d2ae7d2f8bc48bb420',
  expected_migrations: [
    { blob: '5452895cfd473513e99e15e35bff948a74080f44',
      name: '20261031020113_superuser_control_center_mfa_aal2' },
    { blob: '91e75126f636ac8f83d9e73798c66dac58d72608',
      name: '20261031025722_superuser_control_center_cursor_terminal_truth' },
    { blob: '9a2c821a314d7c6039ec31f534712784a94089e3',
      name: '20261031032022_superuser_control_center_overview' },
  ],
  expected_migration_count: 364,
  expected_latest_migration: '20261031032022_superuser_control_center_overview',
  edge_functions: [],
  productive_resources: [
    'migration:20261031020113_superuser_control_center_mfa_aal2',
    'migration:20261031025722_superuser_control_center_cursor_terminal_truth',
    'migration:20261031032022_superuser_control_center_overview',
  ],
  premium_relation_security_sha256: 'a342b0c22f952cc09160b231e96a109fd096750ffa8a883844f581c5238703b0',
  premium_legacy: { content_count: 9, pending_review_count: 0, deleted_count: 5 },
}, {
  run_id: '41351597413',
  run_attempt: 1,
  release_id: 'superuser-qa-perf-c1-r2-release-20261101-2122',
  source_sha: '9010894cb37cd10df4ab0eae5b849143fd2222fd',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'success',
  postcheck_status: 'success',
  gate_artifact: {
    id: '13101483501',
    name: 'nelyon-gate-evidence-41351597413-1',
    digest: 'sha256:5d0a5c353a30f17d45f7ca11deb42961a48303be8173b5f19bf7bfb9963e033d',
  },
  release_artifact: {
    id: '13101463169',
    name: 'nelyon-release-41351597413-1',
    digest: 'sha256:898e179a58ce8dbc90e8e27daefaac60cdf769f3636a2e51bf384d94e79473d8',
  },
  manifest_sha256: '5abd64634d3ee98f4ef8334c0e120549d6139df3e2914e40286ad8e1703cef07',
  pre_snapshot_evidence_sha256: 'b5cf7da854ade78cf7305fd0b8be019fae8b5076dd68b964acde45dc5a0467be',
  post_snapshot_evidence_sha256: '9196cd32e0b3a283fde389ab717cfd05f7b1c8c5e35b32fba18e7bb90334d136',
  expected_migrations: [{
    blob: '005c6cbbf1539611ecb0b8f2255bdf3be44f32a6',
    name: '20261101181907_superuser_qa_perf_c1',
  }],
  expected_migration_count: 365,
  expected_latest_migration: '20261101181907_superuser_qa_perf_c1',
  edge_functions: [],
  productive_resources: ['migration:20261101181907_superuser_qa_perf_c1'],
  premium_relation_security_sha256: 'a342b0c22f952cc09160b231e96a109fd096750ffa8a883844f581c5238703b0',
  premium_legacy: { content_count: 9, pending_review_count: 0, deleted_count: 5 },
}, {
  run_id: '41416609819',
  run_attempt: 1,
  release_id: 'web-control-centers-b1-release-20261102-r5',
  source_sha: '2ac206d77f1f4fbebeccfea92171d75d762825a2',
  repository: 'andressan101989/ClipDAG-9bh0w4-26004-20260525',
  mutation_status: 'completed',
  post_snapshot_status: 'success',
  postcheck_status: 'failure',
  gate_artifact: {
    id: '13128086254',
    name: 'nelyon-gate-evidence-41416609819-1',
    digest: 'sha256:25304100c19cb4e6471d0ea4ab675037843633d458c9e4f3b3e03f92fba7db20',
  },
  release_artifact: {
    id: '13128101062',
    name: 'nelyon-release-41416609819-1',
    digest: 'sha256:25e644f232d45769ee30f5ba59e60fba3824508d2a79933d6c3eaa8de03672e2',
  },
  manifest_sha256: '347f323272ba7fe6454ed9c6b1b0fcd7c651e8738bd3053bbb2d66263837b295',
  pre_snapshot_evidence_sha256: '9eea8156338ecd11a92c8ac09ad8dd30ab16152820788417a3bb39f7c7b0c66d',
  post_snapshot_evidence_sha256: 'f1f765a344aae446ac15a13160db4b1aa8c89969cce09c6aa7824d99218960f0',
  expected_migrations: [{
    blob: 'd12f7b10a64d7eeb55d9347dff30c7d4cb3303d3',
    name: '20261102065812_web_control_centers_b1_publication_drafts',
  }],
  expected_migration_count: 366,
  expected_latest_migration: '20261102065812_web_control_centers_b1_publication_drafts',
  edge_functions: [],
  productive_resources: ['migration:20261102065812_web_control_centers_b1_publication_drafts'],
  premium_relation_security_sha256: 'a342b0c22f952cc09160b231e96a109fd096750ffa8a883844f581c5238703b0',
  premium_legacy: { content_count: 9, pending_review_count: 0, deleted_count: 5 },
}];
const REQUIRED_FINANCE_RECONCILIATIONS = [
  'account_balance_ledger_mismatch',
  'completed_credit_account_mismatch',
  'completed_credit_total_mismatch',
  'completed_debit_account_mismatch',
  'completed_debit_total_mismatch',
  'completed_without_credit',
  'completed_without_debit',
  'noncanonical_entry_type',
  'orphan_ledger_entries',
  'premium_finance_policy_row_count_mismatch',
];
const BASELINE_DIGEST_KEYS = [
  'config_verify_jwt',
  'cron_security',
  'finance',
  'function_source_parity',
  'managed_functions',
  'migrations',
  'unmanaged_functions',
];

export class GateDeniedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GateDeniedError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new GateDeniedError(code, message, details);
}

function assertExactArray(actual, expected, code, label) {
  if (!Array.isArray(actual)
    || actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])) {
    deny(code, `${label} does not match the controlled policy`);
  }
}

function assertExactKeys(value, expected, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    deny(code, `${label} keys do not match the controlled policy`);
  }
}

function assertSha256(value, code, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) deny(code, `${label} is not a full SHA-256`);
}

export function validateSecurityAdvisorPolicy(securityAdvisor) {
  const code = 'INVALID_SECURITY_ADVISOR_POLICY';
  assertExactKeys(securityAdvisor, ['baseline', 'exceptions'], code, 'Security Advisor policy');
  assertExactKeys(securityAdvisor.baseline, ['count', 'cron_security_sha256'], code, 'Security Advisor baseline');
  if (securityAdvisor.baseline.count !== 554
    || securityAdvisor.baseline.cron_security_sha256 !== '2dd76dccc8b348eb932fee5c8ada572f57243287f3ca96bf851a75a2e9244846') {
    deny(code, 'historical Security Advisor baseline authority changed');
  }
  const exceptions = securityAdvisor.exceptions;
  if (!Array.isArray(exceptions) || exceptions.length !== SECURITY_ADVISOR_RPC_EXCEPTIONS.length + 1) {
    deny(code, 'the exact audited Security Advisor exception set is required');
  }
  const expectedByFingerprint = new Map(SECURITY_ADVISOR_RPC_EXCEPTIONS.map(item => [item[0], item]));
  expectedByFingerprint.set(P2_RELATION_ADVISOR_EXCEPTION.advisor_fingerprint, P2_RELATION_ADVISOR_EXCEPTION);
  const fingerprints = new Set();
  const identities = new Set();
  for (const exception of exceptions) {
    assertExactKeys(exception, ['advisor_fingerprint', 'advisor_type', 'advisor_severity', 'object', 'attestation', 'authorization', 'origin', 'technical_approval'], code, 'Security Advisor exception');
    assertSha256(exception.advisor_fingerprint, code, 'advisor fingerprint');
    const expected = expectedByFingerprint.get(exception.advisor_fingerprint);
    if (!expected || fingerprints.has(exception.advisor_fingerprint)) deny(code, 'unknown or duplicate advisor fingerprint');
    fingerprints.add(exception.advisor_fingerprint);
    if (exception.advisor_fingerprint === P2_RELATION_ADVISOR_EXCEPTION.advisor_fingerprint) {
      if (canonicalJson(exception) !== canonicalJson(P2_RELATION_ADVISOR_EXCEPTION)) {
        deny(code, 'P2 relation exception does not match its exact audited evidence');
      }
      continue;
    }
    if (exception.advisor_type !== 'authenticated_security_definer_function_executable'
      || exception.advisor_severity !== 'WARN'
      || exception.technical_approval !== 'verified') {
      deny(code, 'advisor type, severity, or technical approval is invalid');
    }
    assertExactKeys(exception.object, ['schema', 'name', 'argument_types', 'identity_arguments'], code, 'exception object');
    const [,
      name, argumentTypes, identityArguments, definitionSha256,
      negativeTestEvidenceSha256, migration, migrationBlob, sourceSha,
    ] = expected;
    if (exception.object.schema !== 'public'
      || exception.object.name !== name
      || canonicalJson(exception.object.argument_types) !== canonicalJson(argumentTypes)
      || exception.object.identity_arguments !== identityArguments) {
      deny(code, 'exception RPC identity does not match audited evidence');
    }
    const identity = `${exception.object.schema}.${name}(${argumentTypes.join(',')})`;
    if (identities.has(identity)) deny(code, 'duplicate exception RPC identity');
    identities.add(identity);
    assertExactKeys(exception.attestation, ['security_definer', 'owner', 'search_path', 'acl', 'execute', 'definition_sha256'], code, 'exception attestation');
    const expectedAcl = [
      { grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false },
      { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
    ];
    const expectedExecute = { anon: false, authenticated: true, public: false, service_role: false };
    if (exception.attestation.security_definer !== true
      || exception.attestation.owner !== 'postgres'
      || canonicalJson(exception.attestation.search_path) !== canonicalJson(['search_path=""'])
      || canonicalJson(exception.attestation.acl) !== canonicalJson(expectedAcl)
      || canonicalJson(exception.attestation.execute) !== canonicalJson(expectedExecute)
      || exception.attestation.definition_sha256 !== definitionSha256) {
      deny(code, 'exception catalog attestation does not match audited evidence');
    }
    assertExactKeys(exception.authorization, ['functional_reason', 'controls', 'negative_test_evidence_sha256'], code, 'exception authorization');
    if (typeof exception.authorization.functional_reason !== 'string'
      || exception.authorization.functional_reason.trim().length < 12
      || !Array.isArray(exception.authorization.controls)
      || exception.authorization.controls.length === 0
      || new Set(exception.authorization.controls).size !== exception.authorization.controls.length
      || canonicalJson(exception.authorization.controls) !== canonicalJson([...exception.authorization.controls].sort())
      || exception.authorization.controls.some(control => typeof control !== 'string' || control.trim().length === 0)
      || exception.authorization.negative_test_evidence_sha256 !== negativeTestEvidenceSha256) {
      deny(code, 'exception authorization evidence is incomplete');
    }
    assertExactKeys(exception.origin, ['migration', 'migration_blob', 'source_sha'], code, 'exception origin');
    if (exception.origin.migration !== migration
      || exception.origin.migration_blob !== migrationBlob
      || exception.origin.source_sha !== sourceSha) {
      deny(code, 'exception origin is not the exact approved source');
    }
  }
  if (fingerprints.size !== expectedByFingerprint.size) deny(code, 'audited advisor fingerprints are incomplete');
  return true;
}

export function validateRecoverySource(source) {
  const code = 'INVALID_RECOVERY_SOURCE';
  const expectedKeys = [
    'run_id', 'run_attempt', 'release_id', 'source_sha', 'repository', 'mutation_status',
    'post_snapshot_status', 'postcheck_status', 'gate_artifact', 'release_artifact',
    'manifest_sha256', 'pre_snapshot_evidence_sha256', 'post_snapshot_evidence_sha256',
    'expected_migrations', 'expected_migration_count', 'expected_latest_migration',
    'edge_functions', 'productive_resources', 'premium_relation_security_sha256', 'premium_legacy',
    ...(source?.run_id === '40473092474' ? ['edge_transitions'] : []),
  ];
  assertExactKeys(source, expectedKeys, code, 'recovery source');
  const expected = EXPECTED_RECOVERY_SOURCES.find(item => item.run_id === source.run_id);
  if (!expected || canonicalJson(source) !== canonicalJson(expected)) {
    deny(code, 'recovery source differs from the exact approved immutable authority');
  }
  return true;
}

const AUTO_DEPLOY_POLICY = Object.freeze({
  declaration_variable: 'SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED',
  evidence_kind: 'OWNER_PERSISTENT_DECLARATION',
  expected_state: 'OFF',
  independently_verified: false,
  observed_state: 'UNAVAILABLE',
  risk_treatment: 'owner_accepted_unobserved_state',
});

export function validateAutoDeployPolicy(policy) {
  if (canonicalJson(policy) !== canonicalJson(AUTO_DEPLOY_POLICY)) {
    deny('INVALID_AUTO_DEPLOY_POLICY', 'auto-deploy policy must preserve the exact owner declaration and unobserved-state risk contract');
  }
  return true;
}

export function verifyAutoDeployExpectation({ declaration, policy }) {
  validateAutoDeployPolicy(policy);
  if (declaration !== policy.expected_state) {
    deny('AUTO_DEPLOY_DECLARATION_MISMATCH', 'protected auto-deploy declaration must be exactly OFF');
  }
  return {
    declaration_variable: policy.declaration_variable,
    expected_state: policy.expected_state,
    declared_state: declaration,
    evidence_kind: policy.evidence_kind,
    observed_state: policy.observed_state,
    independently_verified: policy.independently_verified,
    risk_treatment: policy.risk_treatment,
  };
}

export function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    deny('INVALID_POLICY', 'policy must be an object');
  }
  if (policy.schema_version !== 2) deny('INVALID_POLICY_SCHEMA', 'unsupported policy schema');
  if (canonicalJson(policy.stories_b1_transition ?? null)
    !== canonicalJson(STORIES_B1_RELEASE_TRANSITION)) {
    deny(
      'INVALID_STORIES_B1_TRANSITION',
      'Stories B1 release authority must match the exact reviewed fail-closed contract',
    );
  }
  if (canonicalJson(policy.stories_safety_c1_transition ?? null)
    !== canonicalJson(STORIES_SAFETY_C1_RELEASE_TRANSITION)) {
    deny(
      'INVALID_STORIES_SAFETY_C1_TRANSITION',
      'Stories Safety C1 authority must match the exact reviewed technical-preparation contract',
    );
  }
  if (canonicalJson(policy.stories_safety_c2_transition ?? null)
    !== canonicalJson(STORIES_SAFETY_C2_RELEASE_TRANSITION)) {
    deny('INVALID_STORIES_SAFETY_C2_TRANSITION',
      'Stories Safety C2 authority must match the exact reviewed publish-first operating model');
  }
  if (canonicalJson(policy.stories_qa_c1_transition ?? null)
    !== canonicalJson(STORIES_QA_C1_RELEASE_TRANSITION)) {
    deny('INVALID_STORIES_QA_C1_TRANSITION',
      'Stories QA C1 authority must match the exact reviewed question-answer contract');
  }
  if (canonicalJson(policy.superuser_control_center_transition ?? null)
    !== canonicalJson(SUPERUSER_CONTROL_CENTER_RELEASE_TRANSITION)) {
    deny('INVALID_SUPERUSER_CONTROL_CENTER_TRANSITION',
      'Superuser Control Center authority must match the exact reviewed migration-only contract');
  }
  if (canonicalJson(policy.superuser_qa_perf_c1_transition ?? null)
    !== canonicalJson(SUPERUSER_QA_PERF_C1_RELEASE_TRANSITION)) {
    deny('INVALID_SUPERUSER_QA_PERF_C1_TRANSITION',
      'Superuser QA PERF C1 authority must match the exact reviewed bounded managed-cron and RPC contract');
  }
  if (canonicalJson(policy.web_control_centers_b1_transition ?? null)
    !== canonicalJson(WEB_CONTROL_CENTERS_B1_RELEASE_TRANSITION)) {
    deny('INVALID_WEB_CONTROL_CENTERS_B1_TRANSITION',
      'Web Control Centers B1 authority must match the exact reviewed one-migration contract');
  }
  if (canonicalJson(policy.web_control_centers_b1_qa_c3_transition ?? null)
    !== canonicalJson(WEB_CONTROL_CENTERS_B1_QA_C3_RELEASE_TRANSITION)) {
    deny('INVALID_WEB_CONTROL_CENTERS_B1_QA_C3_TRANSITION',
      'Web Control Centers B1 QA-C3 authority must match the exact reviewed RPC repair contract');
  }
  const c2AdminFinanceRpc = policy.finance_security_advisor?.c2_rpc_replacements?.find(exception =>
    exception?.object?.schema === 'public'
      && exception?.object?.name === 'search_admin_creator_premium_finance_v1');
  if (policy.finance_security_advisor?.c2_rpc_replacements?.length !== 1
    || c2AdminFinanceRpc?.authorization?.negative_test_evidence_sha256
      !== F3_C2_ADMIN_FINANCE_NEGATIVE_AUTHORIZATION_EVIDENCE_SHA256) {
    deny('INVALID_FINANCE_AUTHORITY_TRANSITION',
      'C2 Admin Finance authorization evidence must match the reproducible negative-test contract');
  }
  const f4AdminFinanceRpc = policy.finance_security_advisor?.f4_rpc_replacements?.find(exception =>
    exception?.object?.schema === 'public'
      && exception?.object?.name === 'get_admin_creator_premium_finance_activation_v1');
  if (policy.finance_security_advisor?.f4_rpc_replacements?.length !== 1
    || f4AdminFinanceRpc?.advisor_fingerprint
      !== '2818544a84b6844679779d5b23a03199e75c18d5d36d6d160aca9c8191c41097'
    || f4AdminFinanceRpc?.attestation?.definition_sha256
      !== '8b5ab66edb413295e289df69f25f6ede7c128ee5cad2aaefade28ff4c235adee'
    || f4AdminFinanceRpc?.origin?.migration
      !== '20261026030000_creator_premium_f4_general_bdag_activation'
    || f4AdminFinanceRpc?.origin?.migration_blob
      !== F4_GENERAL_FINANCE_AUTHORITY_TRANSITION.migration_blob
    || f4AdminFinanceRpc?.origin?.source_sha
      !== F4_GENERAL_FINANCE_AUTHORITY_TRANSITION.reviewed_source_sha) {
    deny('INVALID_FINANCE_AUTHORITY_TRANSITION',
      'F4 Admin Finance replacement must match the exact phase-bound catalog evidence');
  }
  const f5SubscriptionProjection = policy.finance_security_advisor?.f5_rpc_additions?.find(exception =>
    exception?.object?.schema === 'public'
      && exception?.object?.name === 'get_my_creator_premium_subscriptions_v3');
  if (policy.finance_security_advisor?.f5_rpc_additions?.length !== 1
    || f5SubscriptionProjection?.advisor_fingerprint
      !== 'e14d79e47e9db72a50028805bf1a1f321e5c7df19dd2d23b6128e78d1bfa4a16'
    || f5SubscriptionProjection?.attestation?.definition_sha256
      !== '246ab182de52bedd431e12a54ddf48923ecbd85e296ad6e138e54017f5ed7489'
    || f5SubscriptionProjection?.origin?.migration
      !== '20261026072512_creator_premium_f5_autonomous_subscriptions'
    || f5SubscriptionProjection?.origin?.migration_blob
      !== F5_AUTONOMOUS_FINANCE_AUTHORITY_TRANSITION.migration_blob
    || f5SubscriptionProjection?.origin?.source_sha
      !== F5_AUTONOMOUS_FINANCE_AUTHORITY_TRANSITION.reviewed_source_sha) {
    deny('INVALID_FINANCE_AUTHORITY_TRANSITION',
      'F5 subscription projection must match the exact phase-bound catalog evidence');
  }
  if (canonicalJson(policy.finance_security_advisor?.f5_relation_additions ?? null)
    !== canonicalJson(F5_SECURITY_ADVISOR_RELATION_ADDITIONS)) {
    deny('INVALID_FINANCE_AUTHORITY_TRANSITION',
      'F5 relation exceptions must match the exact phase-bound private-table catalog');
  }
  const f5Cron = policy.finance_authority_f5_transition?.cron_job;
  if (normalizeCronCommand(f5Cron?.command ?? '') !== f5Cron?.command
    || normalizedCronCommandSha256(f5Cron.command) !== f5Cron.normalized_command_sha256) {
    deny('INVALID_FINANCE_AUTHORITY_TRANSITION', 'F5 cron command must match the exact normalized digest');
  }
  if (canonicalJson(policy.finance_authority_transition) !== canonicalJson(F3_FINANCE_AUTHORITY_TRANSITION)
    || canonicalJson(policy.finance_authority_c2_transition) !== canonicalJson(F3_C2_FINANCE_AUTHORITY_TRANSITION)
    || canonicalJson(policy.finance_authority_f4_transition) !== canonicalJson(F4_GENERAL_FINANCE_AUTHORITY_TRANSITION)
    || canonicalJson(policy.finance_authority_f5_transition) !== canonicalJson(F5_AUTONOMOUS_FINANCE_AUTHORITY_TRANSITION)
    || sha256Hex(canonicalJson(policy.finance_authority_transition)) !== FINANCE_POLICY_DIGESTS.historical_transition
    || sha256Hex(canonicalJson(policy.finance_authority_c2_transition)) !== FINANCE_POLICY_DIGESTS.c2_transition
    || sha256Hex(canonicalJson(policy.finance_authority_f4_transition)) !== FINANCE_POLICY_DIGESTS.f4_transition
    || sha256Hex(canonicalJson(policy.finance_authority_f5_transition)) !== FINANCE_POLICY_DIGESTS.f5_transition
    || sha256Hex(canonicalJson(policy.finance_authority)) !== FINANCE_POLICY_DIGESTS.authority
    || sha256Hex(canonicalJson(policy.finance_security_advisor)) !== FINANCE_POLICY_DIGESTS.security_advisor) {
    deny('INVALID_FINANCE_AUTHORITY_TRANSITION', 'F3, C2, F4, and F5 finance authority must match the exact audited contracts');
  }
  if (policy.owner !== 'andressan101989') deny('INVALID_POLICY_OWNER', 'unexpected policy owner');
  if (policy.repository !== 'andressan101989/ClipDAG-9bh0w4-26004-20260525') {
    deny('INVALID_POLICY_REPOSITORY', 'unexpected repository authority');
  }
  if (policy.default_branch !== 'main') deny('INVALID_POLICY_BRANCH', 'default branch must be main');
  if (policy.workflow_path !== '.github/workflows/nelyon-production-release.yml') {
    deny('INVALID_POLICY_WORKFLOW', 'unexpected workflow path');
  }
  assertExactArray(policy.modes, EXACT_MODES, 'INVALID_POLICY_MODES', 'modes');
  assertExactArray(
    policy.secrets,
    ['SUPABASE_ACCESS_TOKEN'],
    'INVALID_POLICY_SECRETS',
    'Environment secrets',
  );
  const confirmations = policy.scope_confirmations ?? {};
  const expectedConfirmations = {
    admin_recovery: 'ADMIN_RECOVERY_EXACT_SOURCE',
    plan_only: 'PLAN_ONLY',
    gate_proof: 'GATE_PROOF_NO_MUTATION',
    release_standard: 'RELEASE_STANDARD',
    release_high_risk: 'RELEASE_HIGH_RISK',
    postcheck_recovery: 'POSTCHECK_RECOVERY_READ_ONLY',
  };
  if (canonicalJson(confirmations) !== canonicalJson(expectedConfirmations)) {
    deny('INVALID_POLICY_CONFIRMATIONS', 'scope confirmations do not match');
  }
  if (canonicalJson(policy.admin_recovery ?? null) !== canonicalJson(ADMIN_RECOVERY_POLICY)) {
    deny('INVALID_ADMIN_RECOVERY_POLICY', 'Admin recovery policy must remain exact and forward-only');
  }
  const expectedEnvironment = {
    allow_admin_bypass: false,
    authorization_mode: 'automatic',
    id: 23906772073,
    name: 'production',
    prevent_self_review: false,
    protected_branch: 'main',
    required_reviewer: null,
  };
  if (canonicalJson(policy.environment) !== canonicalJson(expectedEnvironment)) {
    deny('INVALID_ENVIRONMENT_POLICY', 'production Environment policy is invalid');
  }
  if (!SHA_PATTERN.test(policy.baseline?.sha ?? '')) deny('INVALID_BASELINE_SHA', 'baseline SHA is invalid');
  if (!['candidate', 'verified'].includes(policy.baseline?.state)) {
    deny('INVALID_BASELINE_STATE', 'baseline state is invalid');
  }
  if (!['pending', 'verified'].includes(policy.cutover?.state)) {
    deny('INVALID_CUTOVER_STATE', 'cutover state is invalid');
  }
  if (policy.cutover.state === 'verified') {
    const evidence = policy.cutover.initial_evidence;
    if (policy.cutover.control !== 'supabase-github-integration-off'
      || !evidence
      || !RELEASE_ID_PATTERN.test(evidence.id ?? '')
      || !/^[0-9a-f]{64}$/.test(evidence.sha256 ?? '')
      || policy.cutover.verified_by !== policy.owner
      || !Number.isFinite(Date.parse(policy.cutover.verified_at))) {
      deny('INVALID_VERIFIED_CUTOVER', 'verified cutover authority evidence is incomplete');
    }
  } else if (policy.cutover.control !== null
    || policy.cutover.initial_evidence !== null
    || policy.cutover.verified_by !== null
    || policy.cutover.verified_at !== null) {
    deny('INVALID_PENDING_CUTOVER', 'pending cutover must not claim verified authority evidence');
  }
  validateAutoDeployPolicy(policy.auto_deploy);
  if (policy.supabase?.project_ref !== 'aewwdlvbwpczqyvkwvvj') {
    deny('INVALID_PROJECT_REF', 'unexpected Supabase project');
  }
  if (canonicalJson(policy.supabase?.backup) !== canonicalJson({
    max_age_seconds: 86400,
    require_physical: true,
    required_status: 'COMPLETED',
  })) {
    deny('INVALID_BACKUP_POLICY', 'production backup policy is invalid');
  }
  if (!Array.isArray(policy.supabase?.managed_functions) || policy.supabase.managed_functions.length !== 19) {
    deny('INVALID_MANAGED_FUNCTIONS', 'managed function allowlist must contain exactly 19 functions');
  }
  if (new Set(policy.supabase.managed_functions).size !== policy.supabase.managed_functions.length) {
    deny('INVALID_MANAGED_FUNCTIONS', 'managed function allowlist contains duplicates');
  }
  const financeOff = {
    platform_fee_bps: 0,
    purchase_enabled: false,
    refunds_enabled: false,
    subscription_enabled: false,
  };
  const financeGeneral = {
    platform_fee_bps: 2000,
    purchase_enabled: true,
    refunds_enabled: true,
    subscription_enabled: true,
  };
  const expectedFinancePolicy = policy.baseline?.latest_migration
    >= '20261026030000_creator_premium_f4_general_bdag_activation'
    ? financeGeneral
    : financeOff;
  if (canonicalJson(policy.managed_scope_transitions) !== canonicalJson([F2_MANAGED_SCOPE_TRANSITION])
    || !policy.supabase.managed_functions.includes(F2_MANAGED_SCOPE_TRANSITION.resource)
    || canonicalJson(policy.supabase.finance_policy) !== canonicalJson(expectedFinancePolicy)) {
    deny(
      'INVALID_MANAGED_SCOPE_TRANSITION',
      'managed scope transition or phase-bound Premium Finance policy differs',
    );
  }
  if (policy.baseline.state === 'verified') {
    const digests = policy.baseline.evidence_digests;
    const digestKeys = digests && typeof digests === 'object' && !Array.isArray(digests)
      ? Object.keys(digests).sort()
      : [];
    const blocked = policy.baseline.blocked_resources;
    const prior = policy.baseline.prior_release;
    if (!/^[0-9a-f]{64}$/.test(policy.baseline.evidence ?? '')
      || !/^[0-9a-f]{64}$/.test(policy.baseline.reviewed_policy_sha256 ?? '')
      || canonicalJson(digestKeys) !== canonicalJson(BASELINE_DIGEST_KEYS)
      || digestKeys.some(key => !/^[0-9a-f]{64}$/.test(digests[key] ?? ''))
      || !Array.isArray(blocked)
      || new Set(blocked).size !== blocked.length
      || blocked.some(name => !policy.supabase.managed_functions.includes(name))
      || policy.baseline.verified_by !== policy.owner
      || !Number.isFinite(Date.parse(policy.baseline.verified_at))
      || policy.baseline.authority_source !== 'owner-control-plane'
      || policy.baseline.requires_separate_policy_commit !== true
      || !prior
      || !['bootstrap', 'post-release'].includes(prior.kind)
      || !/^[0-9a-f]{64}$/.test(prior.postcheck_evidence_sha256 ?? '')) {
      deny('INVALID_VERIFIED_BASELINE', 'verified baseline authority evidence is incomplete');
    }
  }
  assertExactArray(policy.supabase?.forbidden_functions, ['bdag-economy'], 'INVALID_FORBIDDEN_FUNCTIONS', 'forbidden functions');
  validateSecurityAdvisorPolicy(policy.security_advisor);
  assertExactKeys(policy.postcheck_recovery, ['approved_sources'], 'INVALID_RECOVERY_POLICY', 'postcheck recovery policy');
  if (!Array.isArray(policy.postcheck_recovery.approved_sources)
    || policy.postcheck_recovery.approved_sources.length !== EXPECTED_RECOVERY_SOURCES.length) {
    deny('INVALID_RECOVERY_POLICY', 'the exact approved recovery source set is required');
  }
  for (const source of policy.postcheck_recovery.approved_sources) validateRecoverySource(source);
  if (canonicalJson(policy.postcheck_recovery.approved_sources.map(item => item.run_id))
    !== canonicalJson(EXPECTED_RECOVERY_SOURCES.map(item => item.run_id))) {
    deny('INVALID_RECOVERY_POLICY', 'approved recovery source ordering or identity changed');
  }
  return true;
}

export function loadPolicy(filePath) {
  const policy = JSON.parse(readFileSync(filePath, 'utf8'));
  validatePolicy(policy);
  return policy;
}

const B2_PRODUCTIVE_PATHS = Object.freeze([
  'supabase/config.toml',
  'supabase/functions/_shared/r2.ts',
  'supabase/functions/process-scheduled-publications/index.ts',
  'supabase/functions/process-scheduled-publications/worker.ts',
  'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql',
]);
const B2_FUNCTION_NAMES = Object.freeze(['ai-handoff', 'cleanup-stale-media-uploads', 'content-safety-scan',
  'create-media-upload', 'finalize-media-upload', 'get-media-url',
  'process-scheduled-publications', 'video-semantic-index']);
const B2_HEX64 = /^[0-9a-f]{64}$/;
const b2Matches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const B2_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const b2TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const b2ByteAccessor = key => Object.getOwnPropertyDescriptor(b2TypedArrayPrototype, key).get;
const b2Buffer = b2ByteAccessor('buffer');
const b2Offset = b2ByteAccessor('byteOffset');
const b2Length = b2ByteAccessor('byteLength');

function b2Reject() {
  const error = new Error('B2 descriptor rejected');
  error.code = 'B2_DESCRIPTOR_INVALID';
  error.stack = 'Error: B2 descriptor rejected';
  throw Object.freeze(error);
}

function b2Exact(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) b2Reject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !keys.includes(key)
      || B2_UNSAFE_KEYS.has(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) b2Reject();
}

function b2Bytes(value, maxBytes) {
  let bytes;
  if (typeof value === 'string') {
    if (value.length > maxBytes) b2Reject();
    bytes = Buffer.from(value, 'utf8');
  } else {
    if (types.isProxy(value) || !types.isUint8Array(value)) b2Reject();
    const length = Reflect.apply(b2Length, value, []);
    if (length > maxBytes) b2Reject();
    bytes = Buffer.from(new Uint8Array(Reflect.apply(b2Buffer, value, []), Reflect.apply(b2Offset, value, []), length));
  }
  if (bytes.length === 0 || bytes.length > maxBytes) b2Reject();
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes) || (typeof value === 'string' && text !== value)) b2Reject();
  return bytes;
}

function b2Json(text) {
  const value = JSON.parse(text);
  const stack = [];
  for (const match of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],]/gu)) {
    const token = match[0];
    if (token === '{') stack.push({ keys: new Set(), keyNext: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',') { if (stack.at(-1)) stack.at(-1).keyNext = true; }
    else if (stack.at(-1)?.keyNext) {
      const object = stack.at(-1);
      const key = JSON.parse(token);
      if (object.keys.has(key) || B2_UNSAFE_KEYS.has(key)) b2Reject();
      object.keys.add(key); object.keyNext = false;
    }
  }
  let nodes = 0;
  function freeze(item, depth = 0) {
    if (++nodes > 4096 || depth > 16) b2Reject();
    if (typeof item === 'string' && (item.normalize('NFC') !== item || /[\u0000-\u001f\u007f-\u009f]/u.test(item))) b2Reject();
    if (typeof item === 'number' && !Number.isSafeInteger(item)) b2Reject();
    if (item && typeof item === 'object') {
      for (const key of Object.keys(item)) freeze(item[key], depth + 1);
      Object.freeze(item);
    }
  }
  freeze(value);
  return value;
}

/** Pure exact-byte public boundary. An approved descriptor alone grants no authority. */
export function parseB2ReleaseDescriptor(descriptorBytes, expectedDescriptorSha256) {
  try {
    const bytes = b2Bytes(descriptorBytes, 128 * 1024);
    if (typeof expectedDescriptorSha256 !== 'string' || !B2_HEX64.test(expectedDescriptorSha256)
      || sha256Hex(bytes) !== expectedDescriptorSha256) b2Reject();
    const descriptor = b2Json(bytes.toString('utf8'));
    b2Exact(descriptor, ['schema_version', 'contract', 'public_contract_sha256', 'private_authority']);
    const c = descriptor.contract;
    b2Exact(c, ['id', 'state', 'release_ready', 'from_phase', 'to_phase', 'baseline_sha', 'reviewed_source_sha',
      'integration_base_sha', 'approved_sha_ancestry', 'productive_changes', 'functions', 'function_inventory',
      'managed_scope_transition', 'cron_activation', 'finance_invariants', 'private_authority_max_bytes',
      'requires_separate_baseline_promotion']);
    const approved = c.state === 'approved';
    if (descriptor.schema_version !== 1 || !['candidate', 'approved'].includes(c.state)
      || c.release_ready !== approved || c.id !== 'web-control-centers-b2-scheduled-publishing-v1'
      || c.from_phase !== 'web_control_centers_b1_qa_c3' || c.to_phase !== 'web-control-centers-b2'
      || !b2Matches(c.baseline_sha, SHA_PATTERN)
      || c.approved_sha_ancestry !== 'verified_integration_base'
      || typeof c.cron_activation !== 'boolean' || (approved && c.cron_activation !== true)
      || c.requires_separate_baseline_promotion !== true
      || c.private_authority_max_bytes !== 2 * 1024 * 1024
      || !b2Matches(descriptor.public_contract_sha256, B2_HEX64)
      || sha256Hex(canonicalJson(c)) !== descriptor.public_contract_sha256) b2Reject();
    for (const key of ['reviewed_source_sha', 'integration_base_sha']) {
      if (approved ? !b2Matches(c[key], SHA_PATTERN) : c[key] !== null) b2Reject();
    }
    if (!Array.isArray(c.productive_changes) || c.productive_changes.length !== B2_PRODUCTIVE_PATHS.length) b2Reject();
    c.productive_changes.forEach((item, index) => {
      b2Exact(item, ['path', 'status', 'blob', 'sha256', 'byte_length']);
      if (item.path !== B2_PRODUCTIVE_PATHS[index] || item.status !== (index < 2 ? 'M' : 'A')
        || !b2Matches(item.blob, SHA_PATTERN) || !b2Matches(item.sha256, B2_HEX64)
        || !Number.isSafeInteger(item.byte_length) || item.byte_length < 1 || item.byte_length > 2 * 1024 * 1024) b2Reject();
    });
    if (!Array.isArray(c.functions) || c.functions.length !== B2_FUNCTION_NAMES.length) b2Reject();
    c.functions.forEach((item, index) => {
      b2Exact(item, ['name', 'verify_jwt', 'source_sha256', 'config_sha256']);
      if (item.name !== B2_FUNCTION_NAMES[index] || item.verify_jwt !== ![0, 1, 6].includes(index)) b2Reject();
      for (const key of ['source_sha256', 'config_sha256']) {
        if (approved ? !b2Matches(item[key], B2_HEX64) : item[key] !== null) b2Reject();
      }
    });
    b2Exact(c.function_inventory, ['before', 'after']);
    if (approved ? (!Number.isSafeInteger(c.function_inventory.before) || c.function_inventory.before < 8
      || c.function_inventory.after !== c.function_inventory.before + 1)
      : (c.function_inventory.before !== null || c.function_inventory.after !== null)) b2Reject();
    b2Exact(c.managed_scope_transition, ['add', 'remove']);
    if (canonicalJson(c.managed_scope_transition) !== canonicalJson({ add: ['process-scheduled-publications'], remove: [] })) b2Reject();
    b2Exact(c.finance_invariants, ['platform_fee_bps', 'purchase_enabled', 'refunds_enabled', 'subscription_enabled', 'require_no_movement']);
    if (canonicalJson(c.finance_invariants) !== canonicalJson({ platform_fee_bps: 2000, purchase_enabled: true,
      refunds_enabled: true, subscription_enabled: true, require_no_movement: true })) b2Reject();
    b2Exact(descriptor.private_authority, ['required', 'schema_version', 'authority_id', 'sha256']);
    const authority = descriptor.private_authority;
    if (authority.required !== true || authority.schema_version !== 1
      || authority.authority_id !== 'web-control-centers-b2-release-authority-v1'
      || (approved ? !b2Matches(authority.sha256, B2_HEX64) : authority.sha256 !== null)) b2Reject();
    return descriptor;
  } catch { b2Reject(); }
}

/** Validate caller-supplied Git-LF ordinary-file bytes, without checkout or filesystem access. */
export function validateB2ReleaseDescriptorSources(options) {
  try {
    b2Exact(options, ['descriptorBytes', 'expectedDescriptorSha256', 'productiveFiles', 'affectedFunctions']);
    const descriptor = parseB2ReleaseDescriptor(options.descriptorBytes, options.expectedDescriptorSha256);
    const entries = options.productiveFiles;
    if (types.isProxy(entries) || !Array.isArray(entries) || entries.length !== 5
      || types.isProxy(options.affectedFunctions) || !Array.isArray(options.affectedFunctions)) b2Reject();
    // Copy arrays through data descriptors only, so supplied accessors cannot execute.
    function dataArray(value) {
      const properties = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(properties).length !== value.length + 1) b2Reject();
      return Array.from({ length: value.length }, (_, i) => {
        if (!Object.hasOwn(properties, i) || !Object.hasOwn(properties[i], 'value')) b2Reject();
        return properties[i].value;
      });
    }
    const actualNames = dataArray(options.affectedFunctions);
    if (actualNames.some(name => typeof name !== 'string')
      || canonicalJson([...actualNames].sort()) !== canonicalJson(B2_FUNCTION_NAMES)) b2Reject();
    const files = dataArray(entries);
    const seen = new Set();
    for (const entry of files) {
      b2Exact(entry, ['path', 'status', 'type', 'bytes']);
      const expected = descriptor.contract.productive_changes.find(item => item.path === entry.path);
      if (!expected || seen.has(entry.path) || entry.type !== 'file' || entry.status !== expected.status) b2Reject();
      seen.add(entry.path);
      const bytes = b2Bytes(entry.bytes, 2 * 1024 * 1024);
      if (bytes.includes(13) || bytes.length !== expected.byte_length || sha256Hex(bytes) !== expected.sha256
        || createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex') !== expected.blob) b2Reject();
      if (entry.path === 'supabase/config.toml') {
        const config = parseFunctionConfig(bytes.toString('utf8'));
        for (const fn of descriptor.contract.functions) {
          if (config[fn.name]?.verify_jwt !== fn.verify_jwt) b2Reject();
        }
      }
    }
    return descriptor;
  } catch { b2Reject(); }
}

const B2_DESCRIPTOR_PATH = '.github/nelyon-web-control-centers-b2-release-descriptor.json';
const isB2Delta = changes => changes?.some(item => item.path === B2_PRODUCTIVE_PATHS[4]
  || item.path?.startsWith('supabase/functions/process-scheduled-publications/'));

function b2PublicBinding(descriptor, descriptorSha256) {
  return { contract: descriptor.contract, descriptorSha256,
    publicContractSha256: descriptor.public_contract_sha256,
    expectedPrivateAuthoritySha256: descriptor.private_authority.sha256,
    privateAuthorityRequired: true };
}

// Retained B2 data is built field-by-field. Unknown fields, executable object
// properties and object-valued scalar fields are rejected at every depth.
function b2Projection(value, schema) {
  if (typeof schema === 'function') return schema(value);
  if (Array.isArray(schema)) {
    if (types.isProxy(value) || !Array.isArray(value) || value.length > 50_000) b2Reject();
    const properties = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(properties).length !== value.length + 1) b2Reject();
    return Array.from({ length: value.length }, (_, i) => {
      if (!Object.hasOwn(properties, i) || !Object.hasOwn(properties[i], 'value')) b2Reject();
      return b2Projection(properties[i].value, schema[0]);
    });
  }
  const keys = Object.keys(schema).map(key => key.replace(/\?$/, ''));
  const required = Object.keys(schema).filter(key => !key.endsWith('?'));
  if (!value || typeof value !== 'object' || types.isProxy(value)) b2Reject();
  const present = Reflect.ownKeys(value);
  b2Exact(value, present);
  if (required.some(key => !present.includes(key)) || present.some(key => !keys.includes(key))) b2Reject();
  return Object.fromEntries(Object.entries(schema).filter(([key]) => Object.hasOwn(value, key.replace(/\?$/, '')))
    .map(([key, child]) => { const name = key.replace(/\?$/, ''); return [name, b2Projection(value[name], child)]; }));
}
const b2String = value => {
  if (typeof value !== 'string' || value.length > 128 * 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) b2Reject();
  return value;
};
const b2Boolean = value => { if (typeof value !== 'boolean') b2Reject(); return value; };
const b2Integer = value => { if (!Number.isSafeInteger(value)) b2Reject(); return value; };
const b2NullableString = value => value === null ? null : b2String(value);
const b2FunctionName = value => { if (!B2_FUNCTION_NAMES.includes(value)) b2Reject(); return value; };
const B2_CHANGE_SCHEMA = { path: b2String, status: b2String, 'fileType?': b2String };
const B2_MIGRATION_SCHEMA = { path: b2String, version: b2String, blob: b2String, sha256: b2String, byte_length: b2Integer };
const B2_COMPILER_SCHEMA = { path: b2String, sha256: b2String, snapshot_adapter_path: b2String, snapshot_adapter_sha256: b2String };
const B2_RUNTIME_CLOSURE_PATHS = Object.freeze([
  '.github/workflows/nelyon-production-release.yml',
  'package-lock.json',
  'package.json',
  'scripts/nelyon-admin-production-release.mjs',
  'scripts/nelyon-b2-explicit-connection.mjs',
  'scripts/nelyon-b2-hermetic-workspace.mjs',
  'scripts/nelyon-b2-recovery-provenance.mjs',
  'scripts/nelyon-b2-source-parity.mjs',
  'scripts/nelyon-private-authority-cli.mjs',
  'scripts/nelyon-private-authority-provider.mjs',
  'scripts/nelyon-private-authority-runtime.mjs',
  'scripts/nelyon-private-authority.mjs',
  'scripts/nelyon-private-runtime-closure.mjs',
  'scripts/nelyon-production-release.mjs',
  'scripts/nelyon-production-snapshot-adapter.mjs',
  'scripts/nelyon-release-authority-context.mjs',
  'shared/web-deployment/publicSupabaseBuildEnv.mjs',
]);
const b2ClosureCanonical = value => {
  if (Array.isArray(value)) return `[${value.map(b2ClosureCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${b2ClosureCanonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
function b2RuntimeClosure(value) {
  const projected = b2Projection(value, {
    schema_version: b2Integer,
    identity: b2String,
    algorithm: b2String,
    files: [{ path: b2String, sha256: b2String }],
    runtime: { node: b2String, setup_node_action: b2String },
    dependencies: [{ name: b2String, version: b2String, integrity: b2String, lock_path: b2String }],
    operation_tools: { wrangler: b2String, supabase_setup_action: b2String },
    closure_sha256: b2String,
  });
  const { closure_sha256: closureSha256, ...withoutDigest } = projected;
  if (projected.schema_version !== 1 || projected.identity !== 'nelyon-b2-private-release-runtime-v1'
    || projected.algorithm !== 'sha256' || !b2Matches(closureSha256, B2_HEX64)
    || canonicalJson(projected.files.map(item => item.path)) !== canonicalJson(B2_RUNTIME_CLOSURE_PATHS)
    || projected.files.some(item => !b2Matches(item.sha256, B2_HEX64))
    || projected.runtime.node !== '24.21.0'
    || projected.runtime.setup_node_action !== '949feb2413d6458794dcd2491c4babbbce0c15c1'
    || canonicalJson(projected.dependencies) !== canonicalJson([{
      name: 'aws4fetch', version: '1.0.20',
      integrity: 'sha512-/djoAN709iY65ETD6LKCtyyEI04XIBP5xVvfmNxsEP0uJB5tyaGBztSryRr4HqMStr9R06PisQE7m9zDTXKu6g==',
      lock_path: 'node_modules/aws4fetch',
    }])
    || projected.operation_tools.wrangler !== '4.135.0'
    || projected.operation_tools.supabase_setup_action !== '45a513f8c64c0bc8e0e3dfe572b5c95be85f6359'
    || sha256Hex(Buffer.from(b2ClosureCanonical(withoutDigest), 'utf8')) !== closureSha256) b2Reject();
  return projected;
}
function b2AssertCompilerClosure(compiler, runtimeClosure) {
  const files = new Map(runtimeClosure.files.map(item => [item.path, item.sha256]));
  if (compiler.path !== 'scripts/nelyon-production-release.mjs'
    || compiler.snapshot_adapter_path !== 'scripts/nelyon-production-snapshot-adapter.mjs'
    || compiler.sha256 !== files.get(compiler.path)
    || compiler.snapshot_adapter_sha256 !== files.get(compiler.snapshot_adapter_path)) b2Reject();
}
const B2_CONTRACT_SCHEMA = { name: b2String, entrypoint: b2String, import_map: b2NullableString,
  verify_jwt: b2Boolean, source_changed: b2Boolean, source_sha256: b2String,
  source_files: [{ path: b2String, sha256: b2String }] };
const B2_FINDING_MESSAGES = Object.freeze({
  FINANCE_RESOURCE: 'financial or Stripe resource', WEBHOOK_RESOURCE: 'webhook resource', BDAG_RESOURCE: 'BDAG resource',
  PRIVATE_MEDIA_RESOURCE: 'private media resource', MODERATION_RESOURCE: 'moderation resource', AUTH_RESOURCE: 'authentication or token resource',
  VERIFY_JWT_CHANGED: 'verify_jwt changed', VERIFY_JWT_DISABLED: 'verify_jwt is disabled', DATABASE_MIGRATION: 'production database migration',
  ADMIN_WEB_PRODUCTION_RESOURCE: 'Admin Web production bundle or deployment authority changed', GATE_AUTHORITY_CHANGE: 'release authority changed',
  FUNCTION_SOURCE_MISSING: 'managed function source is missing', UNRESOLVED_IMPORT: 'resolved dependency is absent from graph',
  FLOATING_DEPENDENCY: 'dependency is not immutably pinned', BASELINE_RESOURCE_UNREPRODUCIBLE: 'verified baseline marks this resource unreproducible',
});
function b2Finding(value) {
  const item = b2Projection(value, { severity: b2String, code: b2String, path: b2NullableString,
    resource: b2NullableString, message: b2String, 'specifier?': b2String });
  if (!Object.hasOwn(B2_FINDING_MESSAGES, item.code) || !['HIGH', 'BLOCKING'].includes(item.severity)
    || ![null, ...B2_FUNCTION_NAMES, 'database', 'admin-web', 'release-gate'].includes(item.resource)
    || (item.path !== null && (!/^(?:supabase|scripts|apps|shared|assets|\.github)\/[A-Za-z0-9_./()[\]@-]+\.[A-Za-z0-9]+$/.test(item.path)
      || item.path.split('/').includes('..')))) b2Reject();
  // Diagnostic paths are untrusted locator text even when syntactically valid.
  // Keep exact paths only in the independently bound public resource contracts.
  // Never retain diagnostic path/specifier values or free-form message text.
  return { severity: item.severity, code: item.code, path: null, resource: item.resource,
    message: B2_FINDING_MESSAGES[item.code] };
}
const B2_RISK_SCHEMA = { level: b2String, findings: [b2Finding] };
function projectB2EvidenceParts(value) {
  const projected = b2Projection(value, {
    gitState: { baselineSha: b2String, approvedSha: b2String, originMainSha: b2String, 'remote?': b2String, changes: [B2_CHANGE_SCHEMA] },
    classified: Object.fromEntries(['all', 'config', 'functions', 'governance', 'migrations', 'other', 'productive', 'shared'].map(key => [key, [B2_CHANGE_SCHEMA]])),
    migrations: [B2_MIGRATION_SCHEMA], functionContracts: [B2_CONTRACT_SCHEMA], affectedFunctions: [b2String],
    risk: B2_RISK_SCHEMA, reproducibility: { 'allowed?': b2Boolean, 'blockedFunctions?': [b2FunctionName], findings: [b2Finding] },
    runtimeClosure: b2RuntimeClosure, compiler: B2_COMPILER_SCHEMA, generatedAt: b2String,
  });
  // Repository identity is already public in the request. A raw Git remote URL
  // is not needed in retained evidence and may carry credentials or locators.
  delete projected.gitState.remote;
  return projected;
}
function projectB2ReleaseEvidence(value, policy) {
  const names = [...policy.supabase.managed_functions, 'process-scheduled-publications'];
  return b2Projection(value, { descriptorBytes: b2String, descriptorSha256: b2String, configBytes: b2String,
    configAfter: Object.fromEntries(names.map(name => [name, { verify_jwt: b2Boolean, 'entrypoint?': b2String, 'import_map?': b2String }])),
    ancestry: { baseline: b2Boolean, reviewedSource: b2Boolean, integrationBase: b2Boolean } });
}
function projectB2Manifest(manifest) {
  const projected = b2Projection(manifest, {
    schema_version: b2Integer, generated_at: b2String,
    identity: { actor: b2String, triggering_actor: b2String, repository: b2String, workflow_ref: b2String, ref: b2String,
      run_id: b2String, run_attempt: b2Integer, release_id: b2String, approved_sha: b2String, mode: b2String, scope_confirmation: b2String },
    baseline: { state: b2String, sha: b2String, origin_main_sha: b2String },
    delta: { files: [{ file_type: b2NullableString, path: b2String, status: b2String }], productive_change_count: b2Integer },
    resources: { functions: [b2String], function_contracts: [B2_CONTRACT_SCHEMA], migrations: [B2_MIGRATION_SCHEMA], config_changed: b2Boolean,
      web_control_centers_b2_transition: binding => {
        b2Exact(binding, ['contract', 'descriptorSha256', 'publicContractSha256', 'expectedPrivateAuthoritySha256', 'privateAuthorityRequired']);
        const descriptor = { schema_version: 1, contract: binding.contract, public_contract_sha256: binding.publicContractSha256,
          private_authority: { required: true, schema_version: 1, authority_id: 'web-control-centers-b2-release-authority-v1', sha256: binding.expectedPrivateAuthoritySha256 } };
        const bytes = canonicalJson(descriptor);
        const parsed = parseB2ReleaseDescriptor(bytes, sha256Hex(bytes));
        if (!b2Matches(binding.descriptorSha256, B2_HEX64) || binding.privateAuthorityRequired !== true) b2Reject();
        return b2PublicBinding(parsed, binding.descriptorSha256);
      } },
    risk: B2_RISK_SCHEMA, blockers: [b2Finding], compiler: B2_COMPILER_SCHEMA,
    runtime_closure: b2RuntimeClosure, result: b2String,
  });
  b2AssertCompilerClosure(projected.compiler, projected.runtime_closure);
  return projected;
}

function validateB2FunctionContracts(contracts, expectedFunctions) {
  if (contracts.length !== expectedFunctions.length) b2Reject();
  for (const [index, actual] of contracts.entries()) {
    b2Exact(actual, ['name', 'entrypoint', 'import_map', 'verify_jwt', 'source_changed', 'source_files', 'source_sha256']);
    const expected = expectedFunctions[index];
    if (actual.name !== expected.name || actual.verify_jwt !== expected.verify_jwt || actual.source_changed !== true
      || actual.source_sha256 !== expected.source_sha256) b2Reject();
    for (const file of actual.source_files) b2Exact(file, ['path', 'sha256']);
    if (sha256Hex(canonicalJson({ entrypoint: actual.entrypoint, import_map: actual.import_map,
      source_files: actual.source_files })) !== actual.source_sha256) b2Reject();
  }
}

function validateB2CompiledPublic({ b2Release, policy, gitState, classified, functionContracts, migrations }) {
  try {
    b2Exact(b2Release, ['descriptorBytes', 'descriptorSha256', 'configBytes', 'configAfter', 'ancestry']);
    const descriptor = parseB2ReleaseDescriptor(b2Release.descriptorBytes, b2Release.descriptorSha256);
    const c = descriptor.contract;
    const configBytes = b2Bytes(b2Release.configBytes, 128 * 1024);
    if (sha256Hex(configBytes) !== c.productive_changes[0].sha256
      || configBytes.length !== c.productive_changes[0].byte_length
      || canonicalJson(parseFunctionConfig(configBytes.toString('utf8'))) !== canonicalJson(b2Release.configAfter)) b2Reject();
    b2Exact(b2Release.ancestry, ['baseline', 'reviewedSource', 'integrationBase']);
    if (c.state !== 'approved' || c.release_ready !== true
      || Object.values(b2Release.ancestry).some(value => value !== true)
      || policy.baseline.sha !== c.baseline_sha || gitState.baselineSha !== c.baseline_sha
      || gitState.approvedSha !== gitState.originMainSha
      || canonicalJson(classified.productive.map(({ path, status, fileType }) => ({ path, status, type: fileType })).sort((a, b) => a.path.localeCompare(b.path)))
        !== canonicalJson(c.productive_changes.map(({ path, status }) => ({ path, status, type: 'file' })))) b2Reject();
    const migration = c.productive_changes.at(-1);
    if (migrations.length !== 1 || ['path', 'blob', 'sha256', 'byte_length'].some(key => migrations[0][key] !== migration[key])
      || migrations[0].version !== '20261108061946') b2Reject();
    const finance = { ...c.finance_invariants }; delete finance.require_no_movement;
    if (canonicalJson(policy.supabase.finance_policy) !== canonicalJson(finance)) b2Reject();
    if (canonicalJson(Object.keys(b2Release.configAfter).sort())
      !== canonicalJson([...policy.supabase.managed_functions, 'process-scheduled-publications'].sort())) b2Reject();
    validateB2FunctionContracts(functionContracts, c.functions);
    for (const expected of c.functions) {
      if (sha256Hex(canonicalJson(b2Release.configAfter[expected.name])) !== expected.config_sha256
        || b2Release.configAfter[expected.name].verify_jwt !== expected.verify_jwt) b2Reject();
    }
    return b2PublicBinding(descriptor, b2Release.descriptorSha256);
  } catch { b2Reject(); }
}

/** Public compiler boundary: no authority, provider, environment or callback input. */
export function compileB2PublicEvidence({ descriptorBytes, expectedDescriptorSha256, productiveFiles,
  graph, configBefore, configAfter, changes, gitState, policy, ancestry, runtimeClosure }) {
  try {
    runtimeClosure = b2RuntimeClosure(runtimeClosure);
    const descriptor = parseB2ReleaseDescriptor(descriptorBytes, expectedDescriptorSha256);
    if (descriptor.contract.state !== 'approved') b2Reject();
    const affectedFunctions = resolveAffectedFunctions({ changes, graph, configBefore, configAfter,
      managedFunctions: [...policy.supabase.managed_functions, 'process-scheduled-publications'],
      forbiddenFunctions: policy.supabase.forbidden_functions });
    validateB2ReleaseDescriptorSources({ descriptorBytes, expectedDescriptorSha256, productiveFiles, affectedFunctions });
    const boundConfig = productiveFiles.find(file => file.path === 'supabase/config.toml');
    if (canonicalJson(configAfter) !== canonicalJson(parseFunctionConfig(b2Bytes(boundConfig.bytes, 2 * 1024 * 1024).toString('utf8')))) b2Reject();
    const functionContracts = buildFunctionContracts({ affectedFunctions, graph, configBefore, configAfter, changes });
    const migration = descriptor.contract.productive_changes.at(-1);
    const { status: _status, ...identity } = migration;
    const migrations = [{ ...identity, version: '20261108061946' }];
    const b2Release = projectB2ReleaseEvidence({ descriptorBytes: b2Bytes(descriptorBytes, 128 * 1024).toString('utf8'),
      descriptorSha256: expectedDescriptorSha256, configBytes: b2Bytes(boundConfig.bytes, 128 * 1024).toString('utf8'), configAfter, ancestry }, policy);
    validateB2CompiledPublic({ b2Release, policy, gitState, classified: classifyChangedPaths(changes), functionContracts, migrations });
    return { b2Release, affectedFunctions, functionContracts, migrations, runtimeClosure };
  } catch { b2Reject(); }
}

function b2AuthorityReject() {
  const error = new Error('B2 protected authority required');
  error.code = 'B2_AUTHORITY_REQUIRED';
  error.stack = 'Error: B2 protected authority required';
  throw Object.freeze(error);
}

/** Protected callers supply a Task 2 minted context, never a candidate receipt. */
export function verifyB2PreflightAuthority({ manifest, authorityContext, requestedAt }) {
  try {
    const binding = manifest?.resources?.web_control_centers_b2_transition;
    if (!binding) {
      if (isB2Delta(manifest?.delta?.files) || authorityContext !== undefined) b2AuthorityReject();
      return {};
    }
    b2Exact(binding, ['contract', 'descriptorSha256', 'publicContractSha256', 'expectedPrivateAuthoritySha256', 'privateAuthorityRequired']);
    // WeakSet membership is tested before inspecting any caller context fields.
    const receipt = publicAuthorityReceipt(authorityContext);
    assertB2CatalogSecurityCoverage(authorityContext);
    manifest = projectB2Manifest(manifest);
    if (typeof requestedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(requestedAt)) b2AuthorityReject();
    const operationTime = Date.parse(requestedAt);
    if (!Number.isFinite(operationTime) || new Date(operationTime).toISOString() !== requestedAt) b2AuthorityReject();
    // Only after WeakSet authentication may the non-enumerable private plane be
    // inspected. These values are compared in memory and never projected.
    const { backup, approval } = authorityContext.privateAuthority;
    if (operationTime < Date.parse(backup.completedObservedAt) || operationTime < Date.parse(approval.approvedAt)
      || operationTime >= Date.parse(backup.expiresAt) || operationTime >= Date.parse(approval.expiresAt)) b2AuthorityReject();
    const descriptor = parseB2ReleaseDescriptor(canonicalJson(authorityContext.descriptor), sha256Hex(canonicalJson(authorityContext.descriptor)));
    if (descriptor.contract.state !== 'approved'
      || canonicalJson(binding) !== canonicalJson(b2PublicBinding(descriptor, receipt.descriptorSha256))
      || manifest.baseline.sha !== descriptor.contract.baseline_sha
      || !b2Matches(manifest.identity.approved_sha, SHA_PATTERN)) b2AuthorityReject();
    validateB2FunctionContracts(manifest.resources.function_contracts, descriptor.contract.functions);
    if (canonicalJson(manifest.resources.functions) !== canonicalJson(B2_FUNCTION_NAMES)
      || manifest.delta.productive_change_count !== 5
      || canonicalJson(manifest.delta.files.filter(item => item.path.startsWith('supabase/'))
        .map(({ path, status, file_type }) => ({ path, status, type: file_type })))
        !== canonicalJson(descriptor.contract.productive_changes.map(({ path, status }) => ({ path, status, type: 'file' })))
      || manifest.resources.migrations.length !== 1
      || ['path', 'blob', 'sha256', 'byte_length'].some(key => manifest.resources.migrations[0][key]
        !== descriptor.contract.productive_changes.at(-1)[key])) b2AuthorityReject();
    const expectedBinding = sha256Hex(canonicalJson({ schemaVersion: 1,
      authorityId: descriptor.private_authority.authority_id, transitionId: descriptor.contract.id,
      baselineSha: descriptor.contract.baseline_sha, reviewedSourceSha: descriptor.contract.reviewed_source_sha,
      publicContractSha256: binding.publicContractSha256, descriptorSha256: binding.descriptorSha256,
      privateAuthoritySha256: binding.expectedPrivateAuthoritySha256 }));
    assertAuthorityReceiptMatch(receipt, { ...receipt, bindingSha256: expectedBinding,
      descriptorSha256: binding.descriptorSha256, publicContractSha256: binding.publicContractSha256,
      privateAuthoritySha256: binding.expectedPrivateAuthoritySha256 });
    return { authorityReceipt: receipt };
  } catch { b2AuthorityReject(); }
}

// Full production authority retains mandatory live inventory validation.
export function verifyB2ProtectedAuthority({ manifest, authorityContext, inventory, requestedAt }) {
  try {
    const proof = verifyB2PreflightAuthority({ manifest, authorityContext, requestedAt });
    if (!manifest?.resources?.web_control_centers_b2_transition) return proof;
    const descriptor = authorityContext.descriptor;
    b2Exact(inventory, ['schemaVersion', 'complete', 'capturedAt', 'names']);
    const age = Date.parse(requestedAt) - Date.parse(inventory.capturedAt);
    if (inventory.schemaVersion !== 1 || inventory.complete !== true || !Number.isFinite(age) || age < 0 || age > 300_000
      || !Array.isArray(inventory.names) || inventory.names.some(name => typeof name !== 'string')
      || new Set(inventory.names).size !== inventory.names.length
      || inventory.names.length !== descriptor.contract.function_inventory.before
      || inventory.names.includes('process-scheduled-publications')
      || B2_FUNCTION_NAMES.filter(name => name !== 'process-scheduled-publications').some(name => !inventory.names.includes(name))) b2AuthorityReject();

    return proof;
  } catch { b2AuthorityReject(); }
}
function expectedConfirmation(request, policy) {
  if (request.mode === 'plan_only') return policy.scope_confirmations.plan_only;
  if (request.mode === 'gate_proof') return policy.scope_confirmations.gate_proof;
  if (request.mode === 'release') {
    if (request.scopeConfirmation === policy.scope_confirmations.release_high_risk) {
      return policy.scope_confirmations.release_high_risk;
    }
    return policy.scope_confirmations.release_standard;
  }
  if (request.mode === 'postcheck_recovery') return policy.scope_confirmations.postcheck_recovery;
  if (request.mode === 'admin_recovery') return policy.scope_confirmations.admin_recovery;
  return null;
}

function validateRequestStructure(request, policy) {
  validatePolicy(policy);
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    deny('INVALID_REQUEST', 'release request must be an object');
  }
  if (request.actor !== policy.owner) deny('ACTOR_NOT_AUTHORIZED', 'workflow actor is not authorized');
  if (request.triggeringActor !== policy.owner) {
    deny('TRIGGERING_ACTOR_NOT_AUTHORIZED', 'triggering actor is not authorized');
  }
  if (request.repository !== policy.repository) deny('REPOSITORY_MISMATCH', 'repository identity mismatch');
  const expectedWorkflowRef = `${policy.repository}/${policy.workflow_path}@refs/heads/${policy.default_branch}`;
  if (request.workflowRef !== expectedWorkflowRef) deny('WORKFLOW_REF_MISMATCH', 'workflow identity mismatch');
  if (request.ref !== `refs/heads/${policy.default_branch}`) deny('REF_NOT_MAIN', 'workflow must run from main');
  if (!SHA_PATTERN.test(request.approvedSha ?? '') || !SHA_PATTERN.test(request.mainSha ?? '')) {
    deny('INVALID_SHA', 'approved and main SHAs must be lowercase 40-character hexadecimal values');
  }
  if (request.approvedSha !== request.mainSha) deny('MAIN_SHA_MISMATCH', 'approved SHA is not current main');
  if (!policy.modes.includes(request.mode)) deny('MODE_NOT_ALLOWED', 'workflow mode is not allowed');
  const expected = expectedConfirmation(request, policy);
  if (request.scopeConfirmation !== expected) {
    deny('SCOPE_CONFIRMATION_MISMATCH', 'scope confirmation does not match mode and risk class');
  }
  if (!RELEASE_ID_PATTERN.test(request.releaseId ?? '')) deny('INVALID_RELEASE_ID', 'release ID format is invalid');
  if (!/^[1-9][0-9]*$/.test(String(request.runId ?? ''))) deny('INVALID_RUN_ID', 'run ID is invalid');
  if (!Number.isSafeInteger(request.runAttempt) || request.runAttempt < 1) {
    deny('INVALID_RUN_ATTEMPT', 'run attempt is invalid');
  }
  if (request.mode === 'release' && policy.baseline.state !== 'verified') {
    deny('BASELINE_NOT_VERIFIED', 'production baseline is not verified');
  }
  if (request.mode === 'release' && policy.cutover.state !== 'verified') {
    deny('CUTOVER_NOT_VERIFIED', 'production cutover is not verified');
  }
  if (request.mode === 'postcheck_recovery') {
    if (!/^[1-9][0-9]*$/.test(String(request.recoverySourceRunId ?? ''))) {
      deny('INVALID_RECOVERY_SOURCE', 'recovery source run must be an exact numeric selector');
    }
  } else if (request.mode === 'admin_recovery') {
    if (!/^[1-9][0-9]*$/.test(String(request.recoverySourceRunId ?? ''))) {
      deny('INVALID_RECOVERY_SOURCE', 'Admin recovery requires one exact numeric source run');
    }
    if (!Array.isArray(request.productiveResources) || request.productiveResources.length !== 0) {
      deny('ADMIN_RECOVERY_MUTATION_FORBIDDEN', 'Admin recovery cannot carry productive Supabase resources');
    }
  } else if (request.recoverySourceRunId !== undefined && request.recoverySourceRunId !== null) {
    deny('INVALID_RECOVERY_SOURCE', 'recovery source run is valid only for an explicit recovery mode');
  }
  return Object.freeze({ ...request });
}

export function validateRequest(request, policy) {
  const validated = validateRequestStructure(request, policy);
  if (request.mode === 'postcheck_recovery' && !policy.postcheck_recovery.approved_sources.some(item => (
    item.run_id === String(request.recoverySourceRunId ?? '')
  ))) deny('INVALID_RECOVERY_SOURCE', 'recovery source run is not an exact approved authority');
  return validated;
}

const pendingB2RecoveryRequests = new WeakMap();
export function parsePendingB2RecoveryRequest(request, policy) {
  validateRequestStructure(request, policy);
  if (request.mode !== 'postcheck_recovery' || !Array.isArray(request.productiveResources)
    || request.productiveResources.length !== 0 || policy.postcheck_recovery.approved_sources.some(item => (
      item.run_id === String(request.recoverySourceRunId ?? '')
    ))) deny('INVALID_RECOVERY_SOURCE', 'pending B2 source must be an unlisted zero-resource selector');
  const output = Object.freeze({ schemaVersion: 1, result: 'PRIVATE_B2_AUTHORITY_PENDING' });
  pendingB2RecoveryRequests.set(output, { request: canonicalJson(request), policy: sha256Hex(canonicalJson(policy)) });
  return output;
}

export function classifyAdminRecoveryAuthorityPlane({
  policy,
  sourceKind,
  declaredSourceRunId,
  directSource,
  postcheckSource,
}) {
  const reject = () => deny('ADMIN_RECOVERY_AUTHORITY_PLANE_INVALID',
    'Admin recovery source cannot be assigned to an authenticated authority plane');
  if (!policy || !Array.isArray(policy.postcheck_recovery?.approved_sources)
    || !/^[1-9][0-9]*$/.test(String(declaredSourceRunId ?? ''))) reject();
  let sourceManifest; let originalSourceRunId;
  if (sourceKind === 'direct_release') {
    if (!directSource || postcheckSource !== undefined
      || String(directSource.request?.runId ?? '') !== String(declaredSourceRunId)
      || !directSource.manifest || typeof directSource.manifest !== 'object') reject();
    sourceManifest = directSource.manifest;
    originalSourceRunId = String(directSource.request.runId);
  } else if (sourceKind === 'postcheck_recovery') {
    if (directSource !== undefined || postcheckSource?.result !== 'RECOVERY_SOURCE_VERIFIED'
      || !/^[1-9][0-9]*$/.test(String(postcheckSource?.source_run_id ?? ''))
      || !postcheckSource.source_manifest || typeof postcheckSource.source_manifest !== 'object') reject();
    sourceManifest = postcheckSource.source_manifest;
    originalSourceRunId = String(postcheckSource.source_run_id);
  } else reject();
  const resources = sourceManifest?.resources;
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) reject();
  const b2Required = Object.hasOwn(resources, 'web_control_centers_b2_transition');
  const legacyKeys = ['superuser_control_center_transition', 'superuser_qa_perf_c1_transition']
    .filter(key => Object.hasOwn(resources, key));
  const exactLegacySource = policy.postcheck_recovery.approved_sources
    .some(item => item?.run_id === originalSourceRunId);
  if ((b2Required && legacyKeys.length !== 0)
    || (!b2Required && (legacyKeys.length !== 1 || !exactLegacySource))) reject();
  return Object.freeze({ b2Required, originalSourceRunId });
}

function normalizeCanonical(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('unsupported non-finite number in canonical JSON');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`unsupported ${typeof value} in canonical JSON`);
  if (seen.has(value)) throw new TypeError('unsupported cyclic value in canonical JSON');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => normalizeCanonical(item, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('unsupported object type in canonical JSON');
    }
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = normalizeCanonical(value[key], seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value) {
  return `${JSON.stringify(normalizeCanonical(value, new Set()))}\n`;
}

export function sha256Hex(bytes) {
  if (!(typeof bytes === 'string' || bytes instanceof Uint8Array)) {
    throw new TypeError('sha256Hex requires UTF-8 text or bytes');
  }
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyPolicyDigest({ policyBytes, expectedSha256 }) {
  if (!(typeof policyBytes === 'string' || policyBytes instanceof Uint8Array)
    || !/^[0-9a-f]{64}$/.test(expectedSha256 ?? '')
    || sha256Hex(policyBytes) !== expectedSha256) {
    deny('POLICY_DIGEST_MISMATCH', 'policy bytes do not match the protected Environment digest');
  }
  return expectedSha256;
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    deny('INVALID_GIT_OUTPUT', `${label} is not valid UTF-8`, { cause: error.message });
  }
}

export function parseNameStatusZ(buffer) {
  if (!(buffer instanceof Uint8Array)) deny('INVALID_GIT_OUTPUT', 'name-status output must be bytes');
  const text = decodeUtf8(buffer, 'name-status output');
  if (text.length === 0) return [];
  if (!text.endsWith('\0')) deny('INVALID_GIT_OUTPUT', 'name-status output is not NUL terminated');
  const fields = text.split('\0');
  fields.pop();
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[ACDMRTUXB]|R[0-9]{1,3}|C[0-9]{1,3})$/.test(status)) {
      deny('INVALID_GIT_OUTPUT', `unsupported name-status token: ${status}`);
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = fields[index++];
      const path = fields[index++];
      if (!oldPath || !path) deny('INVALID_GIT_OUTPUT', 'rename/copy record is incomplete');
      changes.push({ status, oldPath, path });
    } else {
      const path = fields[index++];
      if (!path) deny('INVALID_GIT_OUTPUT', 'name-status record is incomplete');
      changes.push({ status, path });
    }
  }
  return changes;
}

function gitText(runGit, args, cwd) {
  const result = runGit(args, { cwd });
  if (!(typeof result === 'string' || result instanceof Uint8Array)) {
    deny('INVALID_GIT_OUTPUT', `git ${args[0]} returned an unsupported value`);
  }
  return (typeof result === 'string' ? result : decodeUtf8(result, `git ${args[0]} output`)).trim();
}

function repositoryFromRemote(remote) {
  const normalized = remote.trim().replace(/\\/g, '/').replace(/\.git$/, '');
  const https = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/i);
  if (https) return https[1];
  const ssh = normalized.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
  return ssh?.[1] ?? null;
}

function fileTypeAtCommit(runGit, cwd, sha, path) {
  const record = gitText(runGit, ['ls-tree', '-z', sha, '--', path], cwd);
  if (!record) return 'missing';
  const match = record.match(/^(\d{6})\s+(blob|tree|commit)\s+[0-9a-f]{40}\t/);
  if (!match) return 'unknown';
  if (match[1] === '120000') return 'symlink';
  if (match[1] === '160000' || match[2] === 'commit') return 'submodule';
  if (match[2] === 'tree') return 'directory';
  if (match[1] === '100644' || match[1] === '100755') return 'file';
  return 'unknown';
}

export function resolveGitState({ cwd, baselineSha, approvedSha, expectedRepository, runGit }) {
  if (typeof runGit !== 'function') throw new TypeError('runGit adapter is required');
  if (!SHA_PATTERN.test(baselineSha ?? '') || !SHA_PATTERN.test(approvedSha ?? '')) {
    deny('INVALID_SHA', 'baseline and approved SHA must be full lowercase commit IDs');
  }
  const remote = gitText(runGit, ['remote', 'get-url', 'origin'], cwd);
  if (repositoryFromRemote(remote)?.toLowerCase() !== expectedRepository.toLowerCase()) {
    deny('REPOSITORY_MISMATCH', 'origin does not identify the expected repository');
  }
  try {
    runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
  } catch {
    deny('APPROVED_COMMIT_MISSING', 'approved SHA is not an available commit');
  }
  const originMainSha = gitText(runGit, ['rev-parse', 'refs/remotes/origin/main^{commit}'], cwd);
  if (approvedSha !== originMainSha) deny('MAIN_SHA_MISMATCH', 'approved SHA does not equal fetched origin/main');
  try {
    runGit(['merge-base', '--is-ancestor', baselineSha, approvedSha], { cwd });
  } catch {
    deny('BASELINE_NOT_ANCESTOR', 'verified baseline is not an ancestor of approved main');
  }
  const raw = runGit(['diff', '--name-status', '-z', '--no-renames', baselineSha, approvedSha, '--'], { cwd });
  const changes = parseNameStatusZ(typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw)
    .map(change => ({
      ...change,
      fileType: ['A', 'M', 'T'].includes(change.status)
        ? fileTypeAtCommit(runGit, cwd, approvedSha, change.path)
        : undefined,
    }));
  return Object.freeze({ approvedSha, baselineSha, originMainSha, remote, changes });
}

function validateGitPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
    deny('UNSUPPORTED_GIT_CHANGE', 'Git change contains an invalid path');
  }
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some(part => part === '..' || part === '')) {
    deny('UNSUPPORTED_GIT_CHANGE', `Git path escapes the repository: ${path}`);
  }
  return normalized;
}

export function classifyChangedPaths(changes) {
  if (!Array.isArray(changes)) deny('UNSUPPORTED_GIT_CHANGE', 'Git changes must be an array');
  const result = {
    all: [],
    config: [],
    functions: [],
    governance: [],
    migrations: [],
    other: [],
    productive: [],
    shared: [],
  };
  for (const raw of changes) {
    const path = validateGitPath(raw?.path);
    if (!['A', 'M'].includes(raw.status)) {
      deny('UNSUPPORTED_GIT_CHANGE', `Git status ${raw.status} is not releasable`, { path });
    }
    if (raw.fileType && !['file', 'directory'].includes(raw.fileType)) {
      deny('UNSUPPORTED_GIT_CHANGE', `Git path is not an ordinary file or directory`, { path, fileType: raw.fileType });
    }
    const change = Object.freeze({ ...raw, path });
    result.all.push(change);
    if (/^supabase\/migrations\/[^/]+\.sql$/.test(path)) {
      result.migrations.push(change);
      result.productive.push(change);
    } else if (path === 'supabase/config.toml') {
      result.config.push(change);
      result.productive.push(change);
    } else if (/^supabase\/functions\/_shared\//.test(path)) {
      result.shared.push(change);
      result.productive.push(change);
    } else if (/^supabase\/functions\/[^/]+\//.test(path)) {
      result.functions.push(change);
      result.productive.push(change);
    } else if (path.startsWith('supabase/')) {
      deny('UNSUPPORTED_GIT_CHANGE', `unknown Supabase path: ${path}`, { path });
    } else if (path === '.github/nelyon-production-release-policy.json'
      || path === '.github/workflows/nelyon-production-release.yml'
      || path === 'scripts/nelyon-production-release.mjs'
      || path === 'scripts/nelyon-production-snapshot-adapter.mjs'
      || path === 'tests/nelyonProductionReleaseGate.test.mjs'
      || path === 'tests/nelyonProductionSnapshotAdapter.test.mjs'
      || path === 'docs/runbooks/nelyon-production-release.md'
      || path.startsWith('docs/superpowers/specs/')
      || path.startsWith('docs/superpowers/plans/')) {
      result.governance.push(change);
    } else {
      result.other.push(change);
    }
  }
  return Object.freeze(Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Object.freeze(value)])));
}

function migrationVersion(value) {
  const name = String(value).replace(/\\/g, '/').split('/').at(-1);
  return name?.match(/^(\d{14})(?:_[A-Za-z0-9][A-Za-z0-9_-]*)?(?:\.sql)?$/)?.[1] ?? null;
}

export function validateMigrationDelta({ changes, baselineLatestMigration, remoteMigrations, dryRunPending }) {
  const hasRemoteValidation = remoteMigrations !== undefined || dryRunPending !== undefined;
  if (!Array.isArray(changes)
    || (hasRemoteValidation && (!Array.isArray(remoteMigrations) || !Array.isArray(dryRunPending)))) {
    deny('INVALID_MIGRATION_DELTA', 'migration inputs must be complete arrays');
  }
  const baselineVersion = migrationVersion(baselineLatestMigration);
  if (!baselineVersion) deny('INVALID_MIGRATION_DELTA', 'baseline latest migration is invalid');
  const migrations = [];
  const seen = new Set();
  for (const change of changes) {
    const path = validateGitPath(change?.path);
    if (!path.startsWith('supabase/migrations/')) continue;
    if (change.status !== 'A') deny('INVALID_MIGRATION_DELTA', 'migrations are forward-only additions', { path, status: change.status });
    const version = migrationVersion(path);
    if (!version || version <= baselineVersion || seen.has(version)) {
      deny('INVALID_MIGRATION_DELTA', 'migration timestamp is invalid, duplicate, or not newer than baseline', { path });
    }
    seen.add(version);
    migrations.push({ version, path });
  }
  migrations.sort((left, right) => left.version.localeCompare(right.version));
  if (!hasRemoteValidation) return migrations;
  const remote = new Set(remoteMigrations.map(migrationVersion));
  if (remote.has(null)) deny('INVALID_MIGRATION_DELTA', 'remote migration inventory contains an invalid version');
  for (const migration of migrations) {
    if (remote.has(migration.version)) deny('MIGRATION_ALREADY_APPLIED', 'manifest migration already exists remotely', migration);
  }
  const pending = dryRunPending.map(migrationVersion);
  if (pending.includes(null)) deny('MIGRATION_DRY_RUN_MISMATCH', 'dry-run returned an invalid migration');
  const expected = migrations.map(migration => migration.version);
  if (canonicalJson([...pending].sort()) !== canonicalJson(expected)) {
    deny('MIGRATION_DRY_RUN_MISMATCH', 'remote dry-run does not exactly match the manifest migrations', { expected, pending });
  }
  return migrations;
}

export function attestPhaseBoundMigrationOrigins({ cwd, policy, approvedSha, migrations, runGit }) {
  if (!Array.isArray(migrations) || typeof runGit !== 'function' || !SHA_PATTERN.test(approvedSha ?? '')) {
    deny('INVALID_RPC_PHASE_ATTESTATION', 'phase-bound migration attestation inputs are incomplete');
  }
  const origins = new Map();
  for (const exception of policy?.security_advisor?.exceptions ?? []) {
    const origin = exception?.origin;
    if (typeof origin?.migration !== 'string') continue;
    if (!SHA_PATTERN.test(origin.migration_blob ?? '') || !SHA_PATTERN.test(origin.source_sha ?? '')) {
      deny('INVALID_RPC_PHASE_ATTESTATION', 'phase-bound RPC origin is malformed');
    }
    const previous = origins.get(origin.migration);
    if (previous && (previous.migration_blob !== origin.migration_blob || previous.source_sha !== origin.source_sha)) {
      deny('INVALID_RPC_PHASE_ATTESTATION', 'phase-bound RPC origins disagree for one migration');
    }
    origins.set(origin.migration, origin);
  }
  return migrations.map(migration => {
    const path = validateGitPath(migration?.path);
    const identity = path.split('/').at(-1)?.replace(/\.sql$/u, '');
    const origin = origins.get(identity);
    if (!origin) return migration;
    let blob;
    try {
      runGit(['cat-file', '-e', `${origin.source_sha}^{commit}`], { cwd });
      runGit(['merge-base', '--is-ancestor', origin.source_sha, approvedSha], { cwd });
      const sourceBlob = gitText(runGit, ['rev-parse', `${origin.source_sha}:${path}`], cwd);
      blob = gitText(runGit, ['rev-parse', `${approvedSha}:${path}`], cwd);
      if (sourceBlob !== origin.migration_blob) {
        deny('INVALID_RPC_PHASE_ATTESTATION', 'reviewed RPC source commit does not contain the attested migration blob');
      }
    } catch {
      deny('INVALID_RPC_PHASE_ATTESTATION', 'reviewed RPC source is missing, unrelated, or does not contain the attested migration');
    }
    if (blob !== origin.migration_blob) {
      deny('INVALID_RPC_PHASE_ATTESTATION', 'phase-bound migration bytes differ from the reviewed RPC origin');
    }
    return { ...migration, blob, source_sha: origin.source_sha };
  });
}

export function attestManagedScopeTransition({
  cwd,
  policy,
  mode,
  approvedSha,
  migrations,
  affectedFunctions,
  runGit,
}) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  if (policy?.baseline?.sha !== F2_MANAGED_SCOPE_TRANSITION.baseline_sha) {
    return { migrations, attestation: null };
  }
  const exactMigrationPath = `supabase/migrations/${F2_MANAGED_SCOPE_TRANSITION.migration}.sql`;
  const candidate = migrations?.find(item => item?.path === exactMigrationPath);
  const includesResource = affectedFunctions?.includes(F2_MANAGED_SCOPE_TRANSITION.resource) === true;
  if (!candidate && !includesResource) return { migrations, attestation: null };
  if (!candidate || !includesResource || typeof runGit !== 'function' || !SHA_PATTERN.test(approvedSha ?? '')) {
    deny('INVALID_MANAGED_SCOPE_TRANSITION', 'F2 managed scope transition inputs are incomplete');
  }
  try {
    runGit(['cat-file', '-e', `${F2_MANAGED_SCOPE_TRANSITION.attested_source_sha}^{commit}`], { cwd });
    runGit(['merge-base', '--is-ancestor', F2_MANAGED_SCOPE_TRANSITION.attested_source_sha, approvedSha], { cwd });
  } catch {
    deny('INVALID_MANAGED_SCOPE_TRANSITION', 'approved source is not descended from the attested F2 source');
  }
  const migrationBlob = gitText(runGit, ['rev-parse', `${approvedSha}:${exactMigrationPath}`], cwd);
  if (!SHA_PATTERN.test(migrationBlob) || migrationBlob !== F2_MANAGED_SCOPE_TRANSITION.migration_blob) {
    deny('INVALID_MANAGED_SCOPE_TRANSITION', 'F2 migration blob does not match the owner-attested source');
  }
  return {
    migrations: migrations.map(item => item.path === exactMigrationPath ? { ...item, blob: migrationBlob } : item),
    attestation: {
      id: F2_MANAGED_SCOPE_TRANSITION.id,
      attested_source_sha: F2_MANAGED_SCOPE_TRANSITION.attested_source_sha,
      approved_sha: approvedSha,
      descendant_verified: true,
      migration_blob: migrationBlob,
    },
  };
}

export function attestStoriesB1Transition({
  cwd,
  policy,
  mode,
  approvedSha,
  changes,
  migrations,
  affectedFunctions,
  runGit,
}) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  const transition = STORIES_B1_RELEASE_TRANSITION;
  const expectedFunctions = transition.functions.map(item => item.name).sort();
  const supabaseChanges = (changes ?? [])
    .filter(item => item?.path?.startsWith('supabase/'))
    .map(item => ({ path: item.path, status: item.status }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedChanges = transition.productive_paths
    .map(path => ({ path, status: path === transition.migration_path ? 'A' : 'M' }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const hasExactMigration = migrations?.some(item => item?.path === transition.migration_path);
  const hasCompletePredecessorScope = policy?.baseline?.sha === transition.baseline_sha
    && canonicalJson([...(affectedFunctions ?? [])].sort()) === canonicalJson(expectedFunctions)
    && canonicalJson(supabaseChanges) === canonicalJson(expectedChanges);
  const candidate = hasExactMigration || hasCompletePredecessorScope;
  if (!candidate) return { migrations, attestation: null };
  const code = 'INVALID_STORIES_B1_TRANSITION';
  if (canonicalJson(policy?.stories_b1_transition ?? null) !== canonicalJson(transition)
    || policy?.baseline?.sha !== transition.baseline_sha
    || canonicalJson(policy?.supabase?.finance_policy ?? null) !== canonicalJson(transition.finance_policy)
    || !SHA_PATTERN.test(approvedSha ?? '') || typeof runGit !== 'function'
    || migrations?.length !== 1 || migrations[0]?.path !== transition.migration_path
    || migrations[0]?.version !== '20261027042552'
    || canonicalJson([...(affectedFunctions ?? [])].sort()) !== canonicalJson(expectedFunctions)) {
    deny(code, 'Stories B1 release scope, baseline, Finance, or Edge closure differs');
  }
  if (canonicalJson(supabaseChanges) !== canonicalJson(expectedChanges)) {
    deny(code, 'Stories B1 permits exactly one migration and the six graph-derived Edge changes');
  }
  try {
    runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.baseline_sha, transition.integration_base_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.integration_base_sha, approvedSha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.reviewed_source_sha, approvedSha], { cwd });
    for (const source of transition.path_attestations) {
      for (const ref of [transition.reviewed_source_sha, approvedSha]) {
        if (gitText(runGit, ['rev-parse', `${ref}:${source.path}`], cwd) !== source.blob
          || fileTypeAtCommit(runGit, cwd, ref, source.path) !== 'file'
          || sha256Hex(runGit(['show', `${ref}:${source.path}`], { cwd })) !== source.sha256) {
          deny(code, `Stories B1 Git blob differs from reviewed bytes: ${source.path}`);
        }
      }
    }
    if (gitText(runGit, ['rev-parse', `${approvedSha}:supabase/config.toml`], cwd)
      !== transition.config_blob) {
      deny(code, 'Stories B1 function configuration blob drifted');
    }
    const actualChanges = parseNameStatusZ(runGit([
      'diff', '--name-status', '-z', transition.integration_base_sha, approvedSha, '--', 'supabase/',
    ], { cwd })).map(item => ({ path: item.path, status: item.status }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (canonicalJson(actualChanges) !== canonicalJson(expectedChanges)) {
      deny(code, 'Stories B1 committed Supabase closure differs from reviewed scope');
    }
  } catch (error) {
    if (error?.code === code) throw error;
    deny(code, 'approved commit does not attest the exact Stories B1 ancestry and bytes');
  }
  return {
    migrations: migrations.map(item => ({
      ...item,
      blob: transition.migration_blob,
      sha256: transition.migration_sha256,
    })),
    attestation: {
      ...stableCopy(transition),
      approved_sha: approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true,
    },
  };
}

export function attestStoriesSafetyC1Transition({
  cwd,
  policy,
  mode,
  approvedSha,
  changes,
  migrations,
  affectedFunctions,
  runGit,
}) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  const transition = STORIES_SAFETY_C1_RELEASE_TRANSITION;
  const supabaseChanges = (changes ?? [])
    .filter(item => item?.path?.startsWith('supabase/'))
    .map(item => ({ path: item.path, status: item.status }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedChanges = [{ path: transition.migration_path, status: 'A' }];
  const hasExactMigration = migrations?.some(item => item?.path === transition.migration_path);
  const hasCompletePredecessorScope = policy?.baseline?.sha === transition.baseline_sha
    && (affectedFunctions ?? []).length === 0
    && canonicalJson(supabaseChanges) === canonicalJson(expectedChanges);
  const candidate = hasExactMigration || hasCompletePredecessorScope;
  if (!candidate) return { migrations, attestation: null };
  const code = 'INVALID_STORIES_SAFETY_C1_TRANSITION';
  if (canonicalJson(policy?.stories_safety_c1_transition ?? null) !== canonicalJson(transition)
    || policy?.baseline?.sha !== transition.baseline_sha
    || canonicalJson(policy?.supabase?.finance_policy ?? null) !== canonicalJson(transition.finance_policy)
    || !SHA_PATTERN.test(approvedSha ?? '') || typeof runGit !== 'function'
    || migrations?.length !== 1 || migrations[0]?.path !== transition.migration_path
    || migrations[0]?.version !== '20261027120000'
    || (affectedFunctions ?? []).length !== 0
    || canonicalJson(supabaseChanges) !== canonicalJson(expectedChanges)) {
    deny(code, 'Stories Safety C1 permits exactly one migration, zero Edge Functions, and no config drift');
  }
  try {
    runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.baseline_sha, transition.integration_base_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.integration_base_sha, approvedSha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.reviewed_source_sha, approvedSha], { cwd });
    for (const source of [
      { path: transition.migration_path, blob: transition.migration_blob, sha256: transition.migration_sha256 },
      transition.policy_artifact,
    ]) {
      for (const ref of [transition.reviewed_source_sha, approvedSha]) {
        if (gitText(runGit, ['rev-parse', `${ref}:${source.path}`], cwd) !== source.blob
          || fileTypeAtCommit(runGit, cwd, ref, source.path) !== 'file'
          || sha256Hex(runGit(['show', `${ref}:${source.path}`], { cwd })) !== source.sha256) {
          deny(code, `Stories Safety C1 Git blob differs from reviewed bytes: ${source.path}`);
        }
      }
    }
    const actualChanges = parseNameStatusZ(runGit([
      'diff', '--name-status', '-z', transition.integration_base_sha, approvedSha, '--', 'supabase/',
    ], { cwd })).map(item => ({ path: item.path, status: item.status }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (canonicalJson(actualChanges) !== canonicalJson(expectedChanges)) {
      deny(code, 'Stories Safety C1 committed Supabase closure differs from the one-migration authority');
    }
  } catch (error) {
    if (error?.code === code) throw error;
    deny(code, 'approved commit does not attest the exact Stories Safety C1 ancestry and bytes');
  }
  return {
    migrations: migrations.map(item => ({
      ...item,
      blob: transition.migration_blob,
      sha256: transition.migration_sha256,
    })),
    attestation: {
      ...stableCopy(transition),
      approved_sha: approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true,
    },
  };
}

export function attestStoriesSafetyC2Transition({
  cwd,
  policy,
  mode,
  approvedSha,
  changes,
  migrations,
  affectedFunctions,
  runGit,
}) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  const transition = STORIES_SAFETY_C2_RELEASE_TRANSITION;
  const supabaseChanges = (changes ?? [])
    .filter(item => item?.path?.startsWith('supabase/'))
    .map(item => ({ path: item.path, status: item.status }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedChanges = transition.productive_paths.map(path => ({
    path, status: path === transition.migration_path ? 'A' : 'M',
  })).sort((left, right) => left.path.localeCompare(right.path));
  const expectedFunctions = transition.functions.map(item => item.name).sort();
  const hasExactMigration = migrations?.some(item => item?.path === transition.migration_path);
  const hasCompletePredecessorScope = policy?.baseline?.sha === transition.baseline_sha
    && canonicalJson([...(affectedFunctions ?? [])].sort()) === canonicalJson(expectedFunctions)
    && canonicalJson(supabaseChanges) === canonicalJson(expectedChanges);
  const candidate = hasExactMigration || hasCompletePredecessorScope;
  if (!candidate) return { migrations, attestation: null };
  const code = 'INVALID_STORIES_SAFETY_C2_TRANSITION';
  if (canonicalJson(policy?.stories_safety_c2_transition ?? null) !== canonicalJson(transition)
    || policy?.baseline?.sha !== transition.baseline_sha
    || canonicalJson(policy?.supabase?.finance_policy ?? null) !== canonicalJson(transition.finance_policy)
    || !SHA_PATTERN.test(approvedSha ?? '') || typeof runGit !== 'function'
    || migrations?.length !== 1 || migrations[0]?.path !== transition.migration_path
    || migrations[0]?.version !== '20261027191918'
    || canonicalJson([...(affectedFunctions ?? [])].sort()) !== canonicalJson(expectedFunctions)
    || canonicalJson(supabaseChanges) !== canonicalJson(expectedChanges)) {
    deny(code, 'Stories Safety C2 permits exactly one migration, the sole get-stream-playback Edge closure, and no config drift');
  }
  try {
    runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.baseline_sha, transition.integration_base_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.integration_base_sha, approvedSha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.reviewed_source_sha, approvedSha], { cwd });
    for (const source of [
      ...transition.path_attestations,
      transition.policy_artifact,
      ...transition.preserved_paths,
    ]) {
      for (const ref of [transition.reviewed_source_sha, approvedSha]) {
        if (gitText(runGit, ['rev-parse', `${ref}:${source.path}`], cwd) !== source.blob
          || fileTypeAtCommit(runGit, cwd, ref, source.path) !== 'file'
          || sha256Hex(runGit(['show', `${ref}:${source.path}`], { cwd })) !== source.sha256) {
          deny(code, `Stories Safety C2 Git blob differs from reviewed bytes: ${source.path}`);
        }
      }
    }
    const actualChanges = parseNameStatusZ(runGit([
      'diff', '--name-status', '-z', transition.integration_base_sha, approvedSha, '--', 'supabase/',
    ], { cwd })).map(item => ({ path: item.path, status: item.status }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (canonicalJson(actualChanges) !== canonicalJson(expectedChanges)) {
      deny(code, 'Stories Safety C2 committed Supabase closure differs from the exact migration and Stream Edge authority');
    }
  } catch (error) {
    if (error?.code === code) throw error;
    deny(code, 'approved commit does not attest the exact Stories Safety C2 ancestry and bytes');
  }
  return {
    migrations: migrations.map(item => ({
      ...item,
      blob: transition.migration_blob,
      sha256: transition.migration_sha256,
    })),
    attestation: {
      ...stableCopy(transition),
      approved_sha: approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true,
    },
  };
}

export function attestStoriesQaC1Transition({
  cwd,
  policy,
  mode,
  approvedSha,
  changes,
  migrations,
  affectedFunctions,
  runGit,
}) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  const transition = STORIES_QA_C1_RELEASE_TRANSITION;
  const supabaseChanges = (changes ?? [])
    .filter(item => item?.path?.startsWith('supabase/'))
    .map(item => ({ path: item.path, status: item.status }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedChanges = [{ path: transition.migration_path, status: 'A' }];
  const hasExactMigration = migrations?.some(item => item?.path === transition.migration_path);
  const hasCompletePredecessorScope = policy?.baseline?.sha === transition.baseline_sha
    && (affectedFunctions ?? []).length === 0
    && canonicalJson(supabaseChanges) === canonicalJson(expectedChanges);
  if (!hasExactMigration && !hasCompletePredecessorScope) return { migrations, attestation: null };
  const code = 'INVALID_STORIES_QA_C1_TRANSITION';
  if (canonicalJson(policy?.stories_qa_c1_transition ?? null) !== canonicalJson(transition)
    || policy?.baseline?.sha !== transition.baseline_sha
    || canonicalJson(policy?.supabase?.finance_policy ?? null) !== canonicalJson(transition.finance_policy)
    || !SHA_PATTERN.test(approvedSha ?? '') || typeof runGit !== 'function'
    || migrations?.length !== 1 || migrations[0]?.path !== transition.migration_path
    || migrations[0]?.version !== '20261029042807'
    || (affectedFunctions ?? []).length !== 0
    || canonicalJson(supabaseChanges) !== canonicalJson(expectedChanges)) {
    deny(code, 'Stories QA C1 permits exactly one reviewed migration, zero Edge Functions, and no config drift');
  }
  try {
    runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.baseline_sha, transition.integration_base_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.integration_base_sha, approvedSha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.reviewed_source_sha, approvedSha], { cwd });
    for (const ref of [transition.reviewed_source_sha, approvedSha]) {
      if (gitText(runGit, ['rev-parse', `${ref}:${transition.migration_path}`], cwd) !== transition.migration_blob
        || fileTypeAtCommit(runGit, cwd, ref, transition.migration_path) !== 'file') {
        deny(code, 'Stories QA C1 migration blob/type differs from reviewed Git bytes');
      }
      const bytes = runGit(['show', `${ref}:${transition.migration_path}`], { cwd });
      if (sha256Hex(bytes) !== transition.migration_sha256
        || Buffer.from(bytes).byteLength !== transition.migration_byte_length
        || Buffer.from(bytes).includes(13)) {
        deny(code, 'Stories QA C1 migration bytes are not the exact reviewed Git-LF source');
      }
    }
    const actualChanges = parseNameStatusZ(runGit([
      'diff', '--name-status', '-z', transition.integration_base_sha, approvedSha, '--', 'supabase/',
    ], { cwd })).map(item => ({ path: item.path, status: item.status }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (canonicalJson(actualChanges) !== canonicalJson(expectedChanges)) {
      deny(code, 'Stories QA C1 committed Supabase closure differs from the one-migration authority');
    }
    for (const exception of transition.security_advisor.introduced_exceptions) {
      if (exception?.origin?.migration !== transition.migration_path.split('/').at(-1).replace(/\.sql$/, '')
        || exception?.origin?.migration_blob !== transition.migration_blob
        || exception?.origin?.source_sha !== transition.reviewed_source_sha) {
        deny(code, 'Stories QA C1 Advisor origin differs from the reviewed migration authority');
      }
    }
  } catch (error) {
    if (error?.code === code) throw error;
    deny(code, 'approved commit does not attest the exact Stories QA C1 ancestry and bytes');
  }
  return {
    migrations: migrations.map(item => ({ ...item, blob: transition.migration_blob,
      sha256: transition.migration_sha256 })),
    attestation: {
      ...stableCopy(transition),
      approved_sha: approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true,
    },
  };
}

export function attestSuperuserControlCenterTransition({
  cwd,
  policy,
  mode,
  approvedSha,
  changes,
  migrations,
  affectedFunctions,
  runGit,
}) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  const transition = SUPERUSER_CONTROL_CENTER_RELEASE_TRANSITION;
  const supabaseChanges = (changes ?? [])
    .filter(item => item?.path?.startsWith('supabase/'))
    .map(item => ({ path: item.path, status: item.status }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedChanges = transition.productive_paths
    .map(path => ({ path, status: 'A' }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const migrationPaths = [...(migrations ?? [])].map(item => item?.path).sort();
  const expectedPaths = transition.migrations.map(item => item.path).sort();
  const hasAnyMigration = migrationPaths.some(path => expectedPaths.includes(path));
  const hasCompletePredecessorScope = policy?.baseline?.sha === transition.baseline_sha
    && (affectedFunctions ?? []).length === 0
    && canonicalJson(supabaseChanges) === canonicalJson(expectedChanges);
  if (!hasAnyMigration && !hasCompletePredecessorScope) return { migrations, attestation: null };
  const code = 'INVALID_SUPERUSER_CONTROL_CENTER_TRANSITION';
  if (canonicalJson(policy?.superuser_control_center_transition ?? null) !== canonicalJson(transition)
    || policy?.baseline?.sha !== transition.baseline_sha
    || canonicalJson(policy?.supabase?.finance_policy ?? null) !== canonicalJson(transition.finance_policy)
    || !SHA_PATTERN.test(approvedSha ?? '') || typeof runGit !== 'function'
    || canonicalJson(migrationPaths) !== canonicalJson(expectedPaths)
    || (affectedFunctions ?? []).length !== 0
    || canonicalJson(supabaseChanges) !== canonicalJson(expectedChanges)) {
    deny(code, 'Superuser Control Center permits exactly three reviewed migrations, zero Edge Functions, and no config drift');
  }
  const expectedByPath = new Map(transition.migrations.map(item => [item.path, item]));
  for (const migration of migrations) {
    const expected = expectedByPath.get(migration.path);
    if (!expected || migration.version !== expected.version) {
      deny(code, 'Superuser Control Center migration versions differ from the reviewed authority');
    }
  }
  try {
    runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.baseline_sha, transition.integration_base_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.integration_base_sha, approvedSha], { cwd });
    for (const source of transition.migrations) {
      if (gitText(runGit, ['rev-parse', `${approvedSha}:${source.path}`], cwd) !== source.blob
        || fileTypeAtCommit(runGit, cwd, approvedSha, source.path) !== 'file') {
        deny(code, `Superuser Control Center migration blob/type differs from reviewed Git bytes: ${source.path}`);
      }
      const bytes = runGit(['show', `${approvedSha}:${source.path}`], { cwd });
      if (sha256Hex(bytes) !== source.sha256
        || Buffer.from(bytes).byteLength !== source.byte_length
        || Buffer.from(bytes).includes(13)) {
        deny(code, `Superuser Control Center migration is not the exact reviewed Git-LF source: ${source.path}`);
      }
    }
    const actualChanges = parseNameStatusZ(runGit([
      'diff', '--name-status', '-z', transition.integration_base_sha, approvedSha, '--', 'supabase/',
    ], { cwd })).map(item => ({ path: item.path, status: item.status }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (canonicalJson(actualChanges) !== canonicalJson(expectedChanges)) {
      deny(code, 'Superuser Control Center committed Supabase closure differs from the exact three-migration authority');
    }
    const finalMigration = transition.migrations.at(-1);
    for (const exception of transition.security_advisor.introduced_exceptions) {
      if (exception?.origin?.migration !== finalMigration.path.split('/').at(-1).replace(/\.sql$/, '')
        || exception?.origin?.migration_blob !== finalMigration.blob
        || exception?.origin?.source_sha !== transition.reviewed_source_sha) {
        deny(code, 'Superuser Control Center Advisor origin differs from the reviewed migration authority');
      }
    }
  } catch (error) {
    if (error?.code === code) throw error;
    deny(code, 'approved commit does not attest the exact Superuser Control Center ancestry and bytes');
  }
  return {
    migrations: migrations.map(item => {
      const expected = expectedByPath.get(item.path);
      return { ...item, blob: expected.blob, sha256: expected.sha256 };
    }),
    attestation: {
      ...stableCopy(transition),
      approved_sha: approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_bytes_verified: true,
    },
  };
}

export function attestSuperuserQaPerfC1Transition({
  cwd,
  policy,
  mode,
  approvedSha,
  changes,
  migrations,
  affectedFunctions,
  runGit,
}) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  const transition = SUPERUSER_QA_PERF_C1_RELEASE_TRANSITION;
  const expectedPaths = transition.migrations.map(item => item.path).sort();
  const migrationPaths = [...(migrations ?? [])].map(item => item?.path).sort();
  if (!migrationPaths.some(path => expectedPaths.includes(path))) return { migrations, attestation: null };
  const code = 'INVALID_SUPERUSER_QA_PERF_C1_TRANSITION';
  const supabaseChanges = (changes ?? []).filter(item => item?.path?.startsWith('supabase/'))
    .map(item => ({ path: item.path, status: item.status }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedChanges = transition.productive_paths.map(path => ({ path, status: 'A' }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (canonicalJson(policy?.superuser_qa_perf_c1_transition ?? null) !== canonicalJson(transition)
    || policy?.baseline?.sha !== transition.baseline_sha
    || canonicalJson(policy?.supabase?.finance_policy ?? null) !== canonicalJson(transition.finance_policy)
    || !SHA_PATTERN.test(approvedSha ?? '') || typeof runGit !== 'function'
    || canonicalJson(migrationPaths) !== canonicalJson(expectedPaths)
    || (affectedFunctions ?? []).length !== 0
    || canonicalJson(supabaseChanges) !== canonicalJson(expectedChanges)) {
    deny(code, 'PERF C1 permits exactly one reviewed migration, zero Edge Functions, and no config drift');
  }
  const expectedByPath = new Map(transition.migrations.map(item => [item.path, item]));
  for (const migration of migrations) {
    const expected = expectedByPath.get(migration.path);
    if (!expected || migration.version !== expected.version) {
      deny(code, 'PERF C1 migration versions differ from the reviewed authority');
    }
  }
  try {
    runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.baseline_sha, transition.integration_base_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.integration_base_sha, approvedSha], { cwd });
    for (const source of transition.migrations) {
      if (gitText(runGit, ['rev-parse', `${approvedSha}:${source.path}`], cwd) !== source.blob
        || fileTypeAtCommit(runGit, cwd, approvedSha, source.path) !== 'file') {
        deny(code, `PERF C1 migration blob/type differs from reviewed Git bytes: ${source.path}`);
      }
      const bytes = runGit(['show', `${approvedSha}:${source.path}`], { cwd });
      if (sha256Hex(bytes) !== source.sha256 || Buffer.from(bytes).byteLength !== source.byte_length
        || Buffer.from(bytes).includes(13)) {
        deny(code, `PERF C1 migration is not the exact reviewed Git-LF source: ${source.path}`);
      }
    }
    const actualChanges = parseNameStatusZ(runGit([
      'diff', '--name-status', '-z', transition.integration_base_sha, approvedSha, '--', 'supabase/',
    ], { cwd })).map(item => ({ path: item.path, status: item.status }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (canonicalJson(actualChanges) !== canonicalJson(expectedChanges)) {
      deny(code, 'PERF C1 committed Supabase closure differs from the exact one-migration authority');
    }
  } catch (error) {
    if (error?.code === code) throw error;
    deny(code, 'approved commit does not attest the exact PERF C1 ancestry and bytes');
  }
  return {
    migrations: migrations.map(item => {
      const expected = expectedByPath.get(item.path);
      return { ...item, blob: expected.blob, sha256: expected.sha256 };
    }),
    attestation: {
      ...stableCopy(transition), approved_sha: approvedSha,
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_bytes_verified: true,
    },
  };
}

export function attestWebControlCentersB1Transition({
  cwd,
  policy,
  mode,
  approvedSha,
  changes,
  migrations,
  affectedFunctions,
  runGit,
}) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  const transition = WEB_CONTROL_CENTERS_B1_RELEASE_TRANSITION;
  const expectedPaths = transition.migrations.map(item => item.path).sort();
  const migrationPaths = [...(migrations ?? [])].map(item => item?.path).sort();
  if (!migrationPaths.some(path => expectedPaths.includes(path))) return { migrations, attestation: null };
  const code = 'INVALID_WEB_CONTROL_CENTERS_B1_TRANSITION';
  const supabaseChanges = (changes ?? []).filter(item => item?.path?.startsWith('supabase/'))
    .map(item => ({ path: item.path, status: item.status }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedChanges = transition.productive_paths.map(path => ({ path, status: 'A' }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (canonicalJson(policy?.web_control_centers_b1_transition ?? null) !== canonicalJson(transition)
    || policy?.baseline?.sha !== transition.baseline_sha
    || canonicalJson(policy?.supabase?.finance_policy ?? null) !== canonicalJson(transition.finance_policy)
    || !SHA_PATTERN.test(approvedSha ?? '') || typeof runGit !== 'function'
    || !SHA_PATTERN.test(transition.reviewed_source_sha)
    || canonicalJson(migrationPaths) !== canonicalJson(expectedPaths)
    || (affectedFunctions ?? []).length !== 0
    || canonicalJson(supabaseChanges) !== canonicalJson(expectedChanges)) {
    deny(code, 'B1 permits one reviewed migration, zero Edge/config/finance changes, and requires finalized source provenance');
  }
  const expectedByPath = new Map(transition.migrations.map(item => [item.path, item]));
  for (const migration of migrations) {
    const expected = expectedByPath.get(migration.path);
    if (!expected || migration.version !== expected.version) {
      deny(code, 'B1 migration versions differ from the reviewed authority');
    }
  }
  try {
    for (const sha of [approvedSha, transition.reviewed_source_sha]) {
      runGit(['cat-file', '-e', `${sha}^{commit}`], { cwd });
    }
    runGit(['merge-base', '--is-ancestor', transition.baseline_sha, transition.integration_base_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.integration_base_sha, transition.reviewed_source_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.reviewed_source_sha, approvedSha], { cwd });
    for (const source of transition.migrations) {
      for (const sha of [transition.reviewed_source_sha, approvedSha]) {
        if (gitText(runGit, ['rev-parse', `${sha}:${source.path}`], cwd) !== source.blob
          || fileTypeAtCommit(runGit, cwd, sha, source.path) !== 'file') {
          deny(code, `B1 migration blob/type differs from reviewed Git bytes: ${source.path}`);
        }
        const bytes = runGit(['show', `${sha}:${source.path}`], { cwd });
        if (sha256Hex(bytes) !== source.sha256 || Buffer.from(bytes).byteLength !== source.byte_length
          || Buffer.from(bytes).includes(13)) {
          deny(code, `B1 migration is not the exact reviewed Git-LF source: ${source.path}`);
        }
      }
    }
    const actualChanges = parseNameStatusZ(runGit([
      'diff', '--name-status', '-z', transition.integration_base_sha, approvedSha, '--', 'supabase/',
    ], { cwd })).map(item => ({ path: item.path, status: item.status }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (canonicalJson(actualChanges) !== canonicalJson(expectedChanges)) {
      deny(code, 'B1 committed Supabase closure differs from the exact one-migration authority');
    }
  } catch (error) {
    if (error?.code === code) throw error;
    deny(code, 'approved commit does not attest exact B1 ancestry and bytes');
  }
  return {
    migrations: migrations.map(item => {
      const expected = expectedByPath.get(item.path);
      return { ...item, blob: expected.blob, sha256: expected.sha256 };
    }),
    attestation: {
      ...stableCopy(transition), approved_sha: approvedSha,
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true, reviewed_bytes_verified: true,
    },
  };
}

export function attestWebControlCentersB1QaC3Transition({
  cwd,
  policy,
  mode,
  approvedSha,
  changes,
  migrations,
  affectedFunctions,
  runGit,
}) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  const transition = WEB_CONTROL_CENTERS_B1_QA_C3_RELEASE_TRANSITION;
  const expectedPaths = transition.migrations.map(item => item.path).sort();
  const migrationPaths = [...(migrations ?? [])].map(item => item?.path).sort();
  if (!migrationPaths.some(path => expectedPaths.includes(path))) {
    return { migrations, attestation: null };
  }
  const code = 'INVALID_WEB_CONTROL_CENTERS_B1_QA_C3_TRANSITION';
  const supabaseChanges = (changes ?? []).filter(item => item?.path?.startsWith('supabase/'))
    .map(item => ({ path: item.path, status: item.status }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedChanges = transition.productive_paths.map(path => ({ path, status: 'A' }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (canonicalJson(policy?.web_control_centers_b1_qa_c3_transition ?? null)
      !== canonicalJson(transition)
    || policy?.baseline?.sha !== transition.baseline_sha
    || canonicalJson(policy?.supabase?.finance_policy ?? null)
      !== canonicalJson(transition.finance_policy)
    || !SHA_PATTERN.test(approvedSha ?? '') || typeof runGit !== 'function'
    || !SHA_PATTERN.test(transition.reviewed_source_sha)
    || canonicalJson(migrationPaths) !== canonicalJson(expectedPaths)
    || (affectedFunctions ?? []).length !== 0
    || canonicalJson(supabaseChanges) !== canonicalJson(expectedChanges)) {
    deny(code, 'QA-C3 permits one reviewed migration, zero Edge/config/finance changes, and exact RPC provenance');
  }
  const expectedByPath = new Map(transition.migrations.map(item => [item.path, item]));
  for (const migration of migrations) {
    const expected = expectedByPath.get(migration.path);
    if (!expected || migration.version !== expected.version) {
      deny(code, 'QA-C3 migration version differs from the reviewed authority');
    }
  }
  try {
    for (const sha of [approvedSha, transition.reviewed_source_sha]) {
      runGit(['cat-file', '-e', `${sha}^{commit}`], { cwd });
    }
    runGit(['merge-base', '--is-ancestor', transition.baseline_sha, transition.integration_base_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.integration_base_sha, transition.reviewed_source_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', transition.reviewed_source_sha, approvedSha], { cwd });
    for (const source of transition.migrations) {
      for (const sha of [transition.reviewed_source_sha, approvedSha]) {
        if (gitText(runGit, ['rev-parse', `${sha}:${source.path}`], cwd) !== source.blob
          || fileTypeAtCommit(runGit, cwd, sha, source.path) !== 'file') {
          deny(code, `QA-C3 migration blob/type differs from reviewed Git bytes: ${source.path}`);
        }
        const bytes = runGit(['show', `${sha}:${source.path}`], { cwd });
        if (sha256Hex(bytes) !== source.sha256 || Buffer.from(bytes).byteLength !== source.byte_length
          || Buffer.from(bytes).includes(13)) {
          deny(code, `QA-C3 migration is not the exact reviewed Git-LF source: ${source.path}`);
        }
      }
    }
    const actualChanges = parseNameStatusZ(runGit([
      'diff', '--name-status', '-z', transition.integration_base_sha, approvedSha, '--', 'supabase/',
    ], { cwd })).map(item => ({ path: item.path, status: item.status }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (canonicalJson(actualChanges) !== canonicalJson(expectedChanges)) {
      deny(code, 'QA-C3 committed Supabase closure differs from the exact one-migration authority');
    }
  } catch (error) {
    if (error?.code === code) throw error;
    deny(code, 'approved commit does not attest exact QA-C3 ancestry and bytes');
  }
  return {
    migrations: migrations.map(item => {
      const expected = expectedByPath.get(item.path);
      return { ...item, blob: expected.blob, sha256: expected.sha256 };
    }),
    attestation: {
      ...stableCopy(transition), approved_sha: approvedSha,
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true, reviewed_bytes_verified: true,
    },
  };
}

export function attestFinanceAuthorityTransition({ mode, policy, approvedSha, changes, migrations, affectedFunctions, runGit, cwd }) {
  if (isReadOnlyRecoveryMode(mode)) return { migrations, attestation: null };
  const f5 = F5_AUTONOMOUS_FINANCE_AUTHORITY_TRANSITION;
  const f5Candidate = migrations?.some(item => item.version === '20261026072512' || item.path === f5?.migration_path)
    || changes?.some(item => item.path === f5?.migration_path);
  if (f5Candidate) {
    const code = 'INVALID_FINANCE_AUTHORITY_TRANSITION';
    if (canonicalJson(policy?.finance_authority_f5_transition) !== canonicalJson(f5)
      || policy?.baseline?.sha !== f5.baseline_sha || !SHA_PATTERN.test(approvedSha ?? '')
      || canonicalJson(affectedFunctions) !== canonicalJson([f5.function]) || migrations.length !== 1
      || migrations[0].path !== f5.migration_path || migrations[0].version !== '20261026072512'
      || typeof runGit !== 'function') deny(code, 'F5 is inapplicable or its productive scope differs');
    const classified = classifyChangedPaths(changes);
    const productive = classified.productive;
    const expectedStatus = new Map([[f5.migration_path, 'A'], [f5.function_path, 'M']]);
    if (classified.config.length !== 0
      || canonicalJson(productive.map(item => item.path).sort()) !== canonicalJson(f5.productive_paths)
      || productive.some(item => item.status !== expectedStatus.get(item.path))) {
      deny(code, 'F5 permits exactly its migration and bdag-ledger change with no config drift');
    }
    try {
      runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
      runGit(['merge-base', '--is-ancestor', f5.baseline_sha, f5.integration_base_sha], { cwd });
      runGit(['merge-base', '--is-ancestor', f5.integration_base_sha, approvedSha], { cwd });
      const exactBlobs = [
        [f5.migration_path, f5.migration_blob],
        [f5.function_path, f5.function_blob],
        ['supabase/config.toml', f5.config_blob],
        ...f5.client_sources.map(source => [source.path, source.blob]),
      ];
      for (const [path, expectedBlob] of exactBlobs) {
        const blob = gitText(runGit, ['rev-parse', `${approvedSha}:${path}`], cwd);
        if (blob !== expectedBlob || fileTypeAtCommit(runGit, cwd, approvedSha, path) !== 'file') {
          deny(code, `F5 committed blob/path differs: ${path}`);
        }
      }
      const migrationBytes = runGit(['show', `${approvedSha}:${f5.migration_path}`], { cwd });
      if (sha256Hex(migrationBytes) !== f5.migration_sha256) deny(code, 'F5 migration bytes differ');
      for (const source of f5.client_sources) {
        if (sha256Hex(runGit(['show', `${approvedSha}:${source.path}`], { cwd })) !== source.sha256) {
          deny(code, `F5 client source bytes differ: ${source.path}`);
        }
      }
      const actualChanges = parseNameStatusZ(runGit([
        'diff', '--name-status', '-z', f5.integration_base_sha, approvedSha, '--', 'supabase/',
      ], { cwd }));
      if (canonicalJson(actualChanges.map(item => ({ path: item.path, status: item.status })).sort((a,b) => a.path.localeCompare(b.path)))
        !== canonicalJson(productive.map(item => ({ path: item.path, status: item.status })).sort((a,b) => a.path.localeCompare(b.path)))) {
        deny(code, 'F5 Git productive closure differs from supplied evidence');
      }
    } catch (error) {
      if (error?.code === code) throw error;
      deny(code, 'approved commit does not attest the exact F5 ancestry and bytes');
    }
    const attestation = {
      id: f5.id, from_phase: f5.from_phase, to_phase: f5.to_phase, baseline_sha: f5.baseline_sha,
      reviewed_source_sha: f5.reviewed_source_sha, integration_base_sha: f5.integration_base_sha,
      approved_sha: approvedSha, baseline_descendant_verified: true, integration_base_descendant_verified: true,
      migration_blob: f5.migration_blob, migration_sha256: f5.migration_sha256,
      function_blob: f5.function_blob, function_source_sha256: f5.function_source_sha256,
      config_blob: f5.config_blob, client_contract: f5.client_contract,
      client_sources: f5.client_sources, cron_job: f5.cron_job,
    };
    return {
      migrations: migrations.map(item => ({ ...item, blob: f5.migration_blob, sha256: f5.migration_sha256 })),
      attestation,
    };
  }
  const f4 = F4_GENERAL_FINANCE_AUTHORITY_TRANSITION;
  const f4Candidate = migrations?.some(item => item.version === '20261026030000' || item.path === f4?.migration_path)
    || changes?.some(item => item.path === f4?.migration_path);
  if (f4Candidate) {
    const code = 'INVALID_FINANCE_AUTHORITY_TRANSITION';
    if (canonicalJson(policy?.finance_authority_f4_transition) !== canonicalJson(f4)
      || policy?.baseline?.sha !== f4.baseline_sha || !SHA_PATTERN.test(approvedSha ?? '')
      || canonicalJson(affectedFunctions) !== canonicalJson([]) || migrations.length !== 1
      || migrations[0].path !== f4.migration_path || migrations[0].version !== '20261026030000'
      || typeof runGit !== 'function') deny(code, 'F4 is inapplicable or its productive scope differs');
    const classified = classifyChangedPaths(changes);
    const productive = classified.productive;
    if (classified.config.length !== 0
      || canonicalJson(productive.map(item => item.path).sort()) !== canonicalJson(f4.productive_paths)
      || productive.some(item => item.status !== 'A')) {
      deny(code, 'F4 permits exactly its one migration and no Edge/config changes');
    }
    try {
      runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
      runGit(['merge-base', '--is-ancestor', f4.baseline_sha, f4.integration_base_sha], { cwd });
      runGit(['merge-base', '--is-ancestor', f4.integration_base_sha, approvedSha], { cwd });
      const migrationBlob = gitText(runGit, ['rev-parse', `${approvedSha}:${f4.migration_path}`], cwd);
      if (migrationBlob !== f4.migration_blob
        || fileTypeAtCommit(runGit, cwd, approvedSha, f4.migration_path) !== 'file') {
        deny(code, 'F4 committed migration blob/path differs');
      }
      const migrationBytes = runGit(['show', `${approvedSha}:${f4.migration_path}`], { cwd });
      if (sha256Hex(migrationBytes) !== f4.migration_sha256) deny(code, 'F4 migration bytes differ');
      const actualChanges = parseNameStatusZ(runGit([
        'diff', '--name-status', '-z', f4.integration_base_sha, approvedSha, '--', 'supabase/',
      ], { cwd }));
      if (canonicalJson(actualChanges.map(item => ({ path: item.path, status: item.status })).sort((a,b) => a.path.localeCompare(b.path)))
        !== canonicalJson(productive.map(item => ({ path: item.path, status: item.status })).sort((a,b) => a.path.localeCompare(b.path)))) {
        deny(code, 'F4 Git productive closure differs from supplied evidence');
      }
    } catch (error) {
      if (error?.code === code) throw error;
      deny(code, 'approved commit does not attest the exact F4 ancestry and bytes');
    }
    const attestation = {
      id: f4.id, from_phase: f4.from_phase, to_phase: f4.to_phase, baseline_sha: f4.baseline_sha,
      reviewed_source_sha: f4.reviewed_source_sha, integration_base_sha: f4.integration_base_sha,
      approved_sha: approvedSha, baseline_descendant_verified: true, integration_base_descendant_verified: true,
      migration_blob: f4.migration_blob, migration_sha256: f4.migration_sha256,
    };
    return {
      migrations: migrations.map(item => ({ ...item, blob: f4.migration_blob, sha256: f4.migration_sha256 })),
      attestation,
    };
  }
  const c2 = F3_C2_FINANCE_AUTHORITY_TRANSITION;
  const c2Candidate = migrations?.some(item => item.version === '20261025160452' || item.path === c2.migration_path)
    || changes?.some(item => item.path === c2.migration_path);
  if (c2Candidate) {
    const code = 'INVALID_FINANCE_AUTHORITY_TRANSITION';
    if (canonicalJson(policy?.finance_authority_c2_transition) !== canonicalJson(c2)
      || policy?.baseline?.sha !== c2.baseline_sha || !SHA_PATTERN.test(approvedSha ?? '')
      || canonicalJson(affectedFunctions) !== canonicalJson([]) || migrations.length !== 1
      || migrations[0].path !== c2.migration_path || migrations[0].version !== '20261025160452'
      || typeof runGit !== 'function') deny(code, 'C2 is inapplicable or its productive scope differs');
    const classified = classifyChangedPaths(changes);
    const productive = classified.productive;
    if (classified.config.length !== 0
      || canonicalJson(productive.map(item => item.path).sort()) !== canonicalJson(c2.productive_paths)
      || productive.some(item => item.status !== 'A')) {
      deny(code, 'C2 permits exactly its one migration and no Edge/config changes');
    }
    try {
      runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
      runGit(['merge-base', '--is-ancestor', c2.baseline_sha, c2.integration_base_sha], { cwd });
      runGit(['merge-base', '--is-ancestor', c2.integration_base_sha, approvedSha], { cwd });
      const migrationBlob = gitText(runGit, ['rev-parse', `${approvedSha}:${c2.migration_path}`], cwd);
      if (migrationBlob !== c2.migration_blob
        || fileTypeAtCommit(runGit, cwd, approvedSha, c2.migration_path) !== 'file') {
        deny(code, 'C2 committed migration blob/path differs');
      }
      const migrationBytes = runGit(['show', `${approvedSha}:${c2.migration_path}`], { cwd });
      if (sha256Hex(migrationBytes) !== c2.migration_sha256) deny(code, 'C2 migration bytes differ');
      const actualChanges = parseNameStatusZ(runGit([
        'diff', '--name-status', '-z', c2.integration_base_sha, approvedSha, '--', 'supabase/',
      ], { cwd }));
      if (canonicalJson(actualChanges.map(item => ({ path: item.path, status: item.status })).sort((a,b) => a.path.localeCompare(b.path)))
        !== canonicalJson(productive.map(item => ({ path: item.path, status: item.status })).sort((a,b) => a.path.localeCompare(b.path)))) {
        deny(code, 'C2 Git productive closure differs from supplied evidence');
      }
    } catch (error) {
      if (error?.code === code) throw error;
      deny(code, 'approved commit does not attest the exact C2 ancestry and bytes');
    }
    const attestation = {
      id: c2.id, from_phase: c2.from_phase, to_phase: c2.to_phase, baseline_sha: c2.baseline_sha,
      reviewed_source_sha: c2.reviewed_source_sha, integration_base_sha: c2.integration_base_sha,
      approved_sha: approvedSha, baseline_descendant_verified: true, integration_base_descendant_verified: true,
      migration_blob: c2.migration_blob, migration_sha256: c2.migration_sha256,
    };
    return {
      migrations: migrations.map(item => ({ ...item, blob: c2.migration_blob, sha256: c2.migration_sha256 })),
      attestation,
    };
  }
  const t = F3_FINANCE_AUTHORITY_TRANSITION;
  const candidate = migrations?.some(item => item.version === '20261025011000' || item.path === t.migration_path)
    || (policy?.baseline?.sha === t.baseline_sha && affectedFunctions?.includes(t.function));
  if (!candidate) return { migrations, attestation: null };
  const code = 'INVALID_FINANCE_AUTHORITY_TRANSITION';
  if (canonicalJson(policy?.finance_authority_transition) !== canonicalJson(t)
    || policy?.baseline?.sha !== t.baseline_sha || !SHA_PATTERN.test(approvedSha ?? '')
    || canonicalJson(affectedFunctions) !== canonicalJson([t.function]) || migrations.length !== 1
    || migrations[0].path !== t.migration_path || migrations[0].version !== '20261025011000'
    || typeof runGit !== 'function') deny(code, 'foundation is inapplicable or its productive scope differs');
  const productive = classifyChangedPaths(changes).productive;
  if (canonicalJson(productive.map(item => item.path).sort()) !== canonicalJson(t.productive_paths)
    || productive.some(item => item.status !== (item.path === t.migration_path ? 'A' : 'M'))) {
    deny(code, 'foundation permits exactly its one migration and existing bdag-ledger source');
  }
  try {
    runGit(['cat-file', '-e', `${approvedSha}^{commit}`], { cwd });
    runGit(['merge-base', '--is-ancestor', t.baseline_sha, t.integration_base_sha], { cwd });
    runGit(['merge-base', '--is-ancestor', t.integration_base_sha, approvedSha], { cwd });
    for (const [path, blob] of [[t.migration_path, t.migration_blob], [t.function_path, t.function_blob], ['supabase/config.toml', t.config_blob]]) {
      if (gitText(runGit, ['rev-parse', `${approvedSha}:${path}`], cwd) !== blob
        || fileTypeAtCommit(runGit, cwd, approvedSha, path) !== 'file') deny(code, 'foundation committed blob/path differs');
    }
    for (const source of t.client_sources) {
      if (gitText(runGit, ['rev-parse', `${approvedSha}:${source.path}`], cwd) !== source.blob
        || fileTypeAtCommit(runGit, cwd, approvedSha, source.path) !== 'file'
        || sha256Hex(runGit(['show', `${approvedSha}:${source.path}`], { cwd })) !== source.sha256) {
        deny(code, 'foundation client contract source differs');
      }
    }
    if (t.frozen_f2_parser.ref !== t.integration_base_sha
      || gitText(runGit, ['rev-parse', `${t.frozen_f2_parser.ref}:${t.frozen_f2_parser.path}`], cwd) !== t.frozen_f2_parser.blob
      || fileTypeAtCommit(runGit, cwd, t.frozen_f2_parser.ref, t.frozen_f2_parser.path) !== 'file'
      || sha256Hex(runGit(['show', `${t.frozen_f2_parser.ref}:${t.frozen_f2_parser.path}`], { cwd }))
        !== t.frozen_f2_parser.sha256) {
      deny(code, 'frozen F2 parser evidence differs');
    }
    const migrationBytes = runGit(['show', `${approvedSha}:${t.migration_path}`], { cwd });
    if (sha256Hex(migrationBytes) !== t.migration_sha256) deny(code, 'foundation migration bytes differ');
    const actualChanges = parseNameStatusZ(runGit(['diff', '--name-status', '-z', t.baseline_sha, approvedSha, '--', 'supabase/'], { cwd }));
    if (canonicalJson(actualChanges.map(item => ({ path: item.path, status: item.status })).sort((a,b) => a.path.localeCompare(b.path)))
      !== canonicalJson(productive.map(item => ({ path: item.path, status: item.status })).sort((a,b) => a.path.localeCompare(b.path)))) {
      deny(code, 'Git productive closure differs from supplied evidence');
    }
  } catch (error) {
    if (error?.code === code) throw error;
    deny(code, 'approved commit does not attest the exact foundation ancestry and bytes');
  }
  const attestation = { id: t.id, phase: t.phase, baseline_sha: t.baseline_sha,
    reviewed_source_sha: t.reviewed_source_sha, integration_base_sha: t.integration_base_sha,
    approved_sha: approvedSha, baseline_descendant_verified: true, integration_base_descendant_verified: true,
    migration_blob: t.migration_blob, migration_sha256: t.migration_sha256,
    function_blob: t.function_blob, function_source_sha256: t.function_source_sha256, config_blob: t.config_blob,
    client_contract: t.client_contract, client_sources: t.client_sources, frozen_f2_parser: t.frozen_f2_parser };
  return { migrations: migrations.map(item => ({ ...item, blob: t.migration_blob, sha256: t.migration_sha256 })), attestation };
}

export function verifyMigrationDryRun({ text, manifest }) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024
    || text.includes('\0') || !Array.isArray(manifest?.resources?.migrations)) {
    deny('MIGRATION_DRY_RUN_MISMATCH', 'migration dry-run evidence is malformed');
  }
  const trimmed = text.trim();
  let pendingFiles;
  if (trimmed.startsWith('{')) {
    let result;
    try {
      result = JSON.parse(trimmed);
    } catch {
      deny('MIGRATION_DRY_RUN_MISMATCH', 'structured migration dry-run evidence is invalid JSON');
    }
    const expectedKeys = ['dryRun', 'message', 'migrations', 'roles', 'seeds', 'upToDate'];
    const migrations = result?.migrations;
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || canonicalJson(Object.keys(result).sort()) !== canonicalJson(expectedKeys)
      || result.dryRun !== true || typeof result.upToDate !== 'boolean'
      || typeof result.message !== 'string' || result.message.length === 0
      || !Array.isArray(migrations) || migrations.some(item => typeof item !== 'string')
      || !Array.isArray(result.seeds) || result.seeds.length !== 0
      || !Array.isArray(result.roles) || result.roles.length !== 0
      || result.upToDate !== (migrations.length === 0)
      || new Set(migrations).size !== migrations.length) {
      deny('MIGRATION_DRY_RUN_MISMATCH', 'structured migration dry-run evidence is malformed');
    }
    pendingFiles = [...migrations].sort();
  } else {
    const matches = [...text.matchAll(/(?:^|[\s•])((20[0-9]{12})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql)(?=\s|$)/gm)];
    pendingFiles = [...new Set(matches.map(match => match[1]))].sort();
  }
  const expectedFiles = manifest.resources.migrations.map(item => posix.basename(item?.path ?? '')).sort();
  const expected = manifest.resources.migrations.map(item => item?.version).sort();
  if (expected.some(version => !/^20[0-9]{12}$/.test(version ?? ''))
    || expectedFiles.some((filename, index) => !filename.startsWith(`${expected[index]}_`)
      || !/^[0-9]{14}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/.test(filename))
    || new Set(expected).size !== expected.length
    || new Set(expectedFiles).size !== expectedFiles.length
    || canonicalJson(pendingFiles) !== canonicalJson(expectedFiles)) {
    deny('MIGRATION_DRY_RUN_MISMATCH', 'remote dry-run does not exactly match the manifest migrations', {
      expected: expectedFiles,
      pending: pendingFiles,
    });
  }
  return { complete: true, pending_versions: pendingFiles.map(filename => filename.slice(0, 14)) };
}

function parseTomlScalar(raw, lineNumber) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?(?:0|[1-9][0-9]*)$/.test(value)) return Number(value);
  const quoted = value.match(/^(["'])(.*)\1$/);
  if (quoted && !quoted[2].includes(quoted[1])) return quoted[2];
  deny('AMBIGUOUS_FUNCTION_CONFIG', `unsupported TOML value on line ${lineNumber}`);
}

export function parseFunctionConfig(toml) {
  if (typeof toml !== 'string') deny('AMBIGUOUS_FUNCTION_CONFIG', 'config.toml must be text');
  const result = {};
  let current = null;
  const allowedKeys = new Set(['entrypoint', 'import_map', 'verify_jwt']);
  for (const [offset, original] of toml.split(/\r?\n/).entries()) {
    const lineNumber = offset + 1;
    const line = original.trim();
    if (!line || line.startsWith('#')) continue;
    const section = line.match(/^\[functions\.([A-Za-z0-9][A-Za-z0-9-]*)\]$/);
    if (section) {
      current = section[1];
      if (Object.hasOwn(result, current)) {
        deny('AMBIGUOUS_FUNCTION_CONFIG', `duplicate function section ${current}`);
      }
      result[current] = {};
      continue;
    }
    if (line.startsWith('[')) deny('AMBIGUOUS_FUNCTION_CONFIG', `unsupported TOML section on line ${lineNumber}`);
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!assignment || !current || !allowedKeys.has(assignment[1])) {
      deny('AMBIGUOUS_FUNCTION_CONFIG', `unsupported or misplaced TOML key on line ${lineNumber}`);
    }
    const [, key, rawValue] = assignment;
    if (Object.hasOwn(result[current], key)) {
      deny('AMBIGUOUS_FUNCTION_CONFIG', `duplicate ${key} for function ${current}`);
    }
    result[current][key] = parseTomlScalar(rawValue, lineNumber);
  }
  for (const [name, config] of Object.entries(result)) {
    if (typeof config.verify_jwt !== 'boolean') {
      deny('AMBIGUOUS_FUNCTION_CONFIG', `function ${name} has no unambiguous verify_jwt value`);
    }
  }
  return result;
}

function stripQuotedLiteral(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1$/s);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[2].replace(/"/g, '\\"')}"`);
  } catch {
    return null;
  }
}

export function parseModuleSpecifiers(source, path = '<source>') {
  if (typeof source !== 'string') deny('AMBIGUOUS_IMPORT', `module ${path} is not text`);
  if (/\brequire\s*\(/.test(source)
    || /\bimport\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=/.test(source)
    || /^\s*\/\/\/\s*<reference\b[^>]*\b(?:path|types|lib)\s*=/m.test(source)) {
    deny('AMBIGUOUS_IMPORT', `unsupported module dependency syntax in ${path}`);
  }
  const imports = [];
  const seen = new Set();
  const add = (kind, specifier) => {
    const key = `${kind}\0${specifier}`;
    if (!seen.has(key)) {
      seen.add(key);
      imports.push({ kind, specifier });
    }
  };
  const dynamicPattern = /\bimport\s*\(([^)]*)\)/gs;
  for (const match of source.matchAll(dynamicPattern)) {
    const specifier = stripQuotedLiteral(match[1]);
    if (!specifier) deny('AMBIGUOUS_IMPORT', `non-literal dynamic import in ${path}`);
    add('dynamic', specifier);
  }
  const staticImportPattern = /\bimport\s+(?!\()(?:(?:[^'";]*?)\s+from\s+)?(["'])([^"']+)\1/g;
  for (const match of source.matchAll(staticImportPattern)) add('static', match[2]);
  const exportPattern = /\bexport\s+[^'";]*?\s+from\s+(["'])([^"']+)\1/g;
  for (const match of source.matchAll(exportPattern)) add('export', match[2]);
  return imports;
}

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'];

function normalizeModulePath(path) {
  const normalized = validateGitPath(path);
  if (!normalized.startsWith('supabase/functions/')) {
    deny('IMPORT_ESCAPES_FUNCTIONS', `module is outside supabase/functions: ${path}`);
  }
  return normalized;
}

function resolveLocalModule(fromPath, specifier, available) {
  const joined = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (joined === '..' || joined.startsWith('../') || !joined.startsWith('supabase/functions/')) {
    deny('IMPORT_ESCAPES_FUNCTIONS', `import ${specifier} from ${fromPath} escapes supabase/functions`);
  }
  const extension = posix.extname(joined);
  const candidates = extension
    ? [joined]
    : [...MODULE_EXTENSIONS.map(item => `${joined}${item}`), ...MODULE_EXTENSIONS.map(item => `${joined}/index${item}`)];
  const matches = candidates.filter(candidate => available.has(candidate));
  if (matches.length === 0) deny('UNRESOLVED_IMPORT', `cannot resolve ${specifier} from ${fromPath}`);
  if (matches.length !== 1) deny('AMBIGUOUS_IMPORT', `multiple resolutions for ${specifier} from ${fromPath}`, { matches });
  return matches[0];
}

function functionNameForPath(path) {
  const match = path.match(/^supabase\/functions\/([^/]+)\//);
  return match && match[1] !== '_shared' ? match[1] : null;
}

export function buildFunctionGraph(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    deny('AMBIGUOUS_IMPORT', 'function graph files must be a path-to-source object');
  }
  const normalizedFiles = new Map();
  for (const [rawPath, source] of Object.entries(files)) {
    const path = normalizeModulePath(rawPath);
    const filename = posix.basename(path).toLowerCase();
    if (filename === 'deno.json' || filename === 'deno.jsonc'
      || !/\.(?:ts|tsx|js|jsx|mjs|json)$/.test(filename)) {
      deny('UNSUPPORTED_FUNCTION_SOURCE', `function source or implicit runtime config is unsupported: ${path}`);
    }
    if (normalizedFiles.has(path)) deny('AMBIGUOUS_IMPORT', `duplicate normalized module path ${path}`);
    if (typeof source !== 'string') deny('AMBIGUOUS_IMPORT', `module ${path} is not text`);
    normalizedFiles.set(path, source);
  }
  const nodes = {};
  const reverse = {};
  for (const [path, source] of normalizedFiles) {
    const specifiers = parseModuleSpecifiers(source, path);
    const localImports = [];
    const externalImports = [];
    for (const entry of specifiers) {
      if (entry.specifier.startsWith('.')) {
        const resolved = resolveLocalModule(path, entry.specifier, normalizedFiles);
        localImports.push(resolved);
        (reverse[resolved] ??= []).push(path);
      } else {
        externalImports.push(entry.specifier);
      }
    }
    nodes[path] = {
      externalImports: [...new Set(externalImports)].sort(),
      functionName: functionNameForPath(path),
      localImports: [...new Set(localImports)].sort(),
      path,
      sourceSha256: sha256Hex(Buffer.from(source, 'utf8')),
      specifiers,
    };
  }
  for (const importers of Object.values(reverse)) importers.sort();
  return Object.freeze({ nodes, reverse });
}

function assertAuthorizedFunction(name, managed, forbidden) {
  if (!name || forbidden.has(name) || !managed.has(name)) {
    deny('FUNCTION_NOT_AUTHORIZED', `function ${name ?? '<unknown>'} is not managed by the release gate`);
  }
}

export function resolveAffectedFunctions({
  changes,
  graph,
  managedFunctions,
  forbiddenFunctions = [],
  configBefore,
  configAfter,
}) {
  if (!Array.isArray(changes) || !graph?.nodes || !graph?.reverse) {
    deny('FUNCTION_NOT_AUTHORIZED', 'affected-function inputs are incomplete');
  }
  const managed = new Set(managedFunctions);
  const forbidden = new Set(forbiddenFunctions);
  const affected = new Set();
  const queue = [];
  for (const change of changes) {
    const path = validateGitPath(change.path);
    if (path === 'supabase/config.toml') {
      if (!configBefore || typeof configBefore !== 'object' || Array.isArray(configBefore)
        || !configAfter || typeof configAfter !== 'object' || Array.isArray(configAfter)) {
        deny('AMBIGUOUS_FUNCTION_CONFIG', 'config.toml changes require parsed before and after declarations');
      }
      const currentNames = Object.keys(configAfter).sort();
      const managedNames = [...managed].sort();
      if (canonicalJson(currentNames) !== canonicalJson(managedNames)) {
        deny('FUNCTION_NOT_AUTHORIZED', 'current function config does not equal the managed allowlist');
      }
      for (const name of new Set([...Object.keys(configBefore), ...currentNames])) {
        if (canonicalJson(configBefore[name] ?? null) === canonicalJson(configAfter[name] ?? null)) continue;
        assertAuthorizedFunction(name, managed, forbidden);
        affected.add(name);
      }
      continue;
    }
    const name = functionNameForPath(path);
    if (name) {
      assertAuthorizedFunction(name, managed, forbidden);
      affected.add(name);
      if (graph.nodes[path]) queue.push(path);
    } else if (path.startsWith('supabase/functions/_shared/')) {
      if (!graph.nodes[path]) deny('UNRESOLVED_IMPORT', `changed shared module ${path} is missing from approved tree`);
      queue.push(path);
    }
  }
  const visited = new Set(queue);
  while (queue.length) {
    const imported = queue.shift();
    for (const importer of graph.reverse[imported] ?? []) {
      const name = graph.nodes[importer]?.functionName;
      if (name) {
        assertAuthorizedFunction(name, managed, forbidden);
        affected.add(name);
      }
      if (!visited.has(importer)) {
        visited.add(importer);
        queue.push(importer);
      }
    }
  }
  return [...affected].sort();
}

function configuredFunctionPath(functionName, raw, fallback, label) {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || raw.length === 0) {
    deny('FUNCTION_CONTRACT_MISMATCH', `${label} for ${functionName} is invalid`);
  }
  const replaced = raw.replaceAll('\\', '/').replace(/^\.\//, '');
  const candidate = replaced.startsWith('supabase/functions/')
    ? replaced
    : replaced.startsWith('functions/')
      ? `supabase/${replaced}`
      : posix.join(`supabase/functions/${functionName}`, replaced);
  const normalized = normalizeModulePath(candidate);
  if (label === 'entrypoint' && !normalized.startsWith(`supabase/functions/${functionName}/`)) {
    deny('FUNCTION_CONTRACT_MISMATCH', `entrypoint for ${functionName} escapes its function directory`);
  }
  return normalized;
}

export function buildFunctionContracts({
  affectedFunctions,
  graph,
  configBefore = {},
  configAfter,
  changes = [],
}) {
  if (!Array.isArray(affectedFunctions) || !graph?.nodes || !configAfter
    || typeof configAfter !== 'object' || Array.isArray(configAfter) || !Array.isArray(changes)) {
    deny('FUNCTION_CONTRACT_MISMATCH', 'function contract inputs are incomplete');
  }
  const changedPaths = new Set(changes.map(change => validateGitPath(change.path)));
  return [...affectedFunctions].sort().map(name => {
    const config = configAfter[name];
    if (!config || typeof config.verify_jwt !== 'boolean') {
      deny('FUNCTION_CONTRACT_MISMATCH', `effective config for ${name} is unavailable`);
    }
    const entrypoint = configuredFunctionPath(name, config.entrypoint, `supabase/functions/${name}/index.ts`, 'entrypoint');
    const importMap = config.import_map === undefined
      ? null
      : configuredFunctionPath(name, config.import_map, null, 'import map');
    const previousConfig = configBefore[name];
    const previousEntrypoint = previousConfig
      ? configuredFunctionPath(name, previousConfig.entrypoint, `supabase/functions/${name}/index.ts`, 'entrypoint')
      : null;
    const previousImportMap = previousConfig
      ? (previousConfig.import_map === undefined
        ? null
        : configuredFunctionPath(name, previousConfig.import_map, null, 'import map'))
      : null;
    const bundleConfigChanged = !previousConfig
      || previousEntrypoint !== entrypoint
      || previousImportMap !== importMap;
    if (!graph.nodes[entrypoint]) deny('FUNCTION_CONTRACT_MISMATCH', `entrypoint for ${name} is absent from the source graph`);
    if (importMap && !graph.nodes[importMap]) deny('FUNCTION_CONTRACT_MISMATCH', `import map for ${name} is absent from the source graph`);
    const queue = [entrypoint];
    const visited = new Set(importMap ? [importMap] : []);
    while (queue.length) {
      const path = queue.shift();
      if (visited.has(path)) continue;
      const node = graph.nodes[path];
      if (!node) deny('FUNCTION_CONTRACT_MISMATCH', `transitive source ${path} is unavailable`);
      visited.add(path);
      queue.push(...node.localImports);
    }
    const sourceFiles = [...visited].sort().map(path => ({ path, sha256: graph.nodes[path].sourceSha256 }));
    if (sourceFiles.some(item => !/^[0-9a-f]{64}$/.test(item.sha256 ?? ''))) {
      deny('FUNCTION_CONTRACT_MISMATCH', `source digest for ${name} is invalid`);
    }
    const sourceIdentity = { entrypoint, import_map: importMap, source_files: sourceFiles };
    return {
      name,
      entrypoint,
      import_map: importMap,
      verify_jwt: config.verify_jwt,
      source_changed: bundleConfigChanged || sourceFiles.some(item => changedPaths.has(item.path)),
      source_files: sourceFiles,
      source_sha256: sha256Hex(canonicalJson(sourceIdentity)),
    };
  });
}

export function verifyFunctionContracts({ manifest, graph, configBefore = {}, configAfter, functionName }) {
  const functions = manifest?.resources?.functions;
  const contracts = manifest?.resources?.function_contracts;
  if (!Array.isArray(functions) || !Array.isArray(contracts)
    || canonicalJson(contracts.map(item => item?.name)) !== canonicalJson([...functions].sort())) {
    deny('FUNCTION_CONTRACT_MISMATCH', 'manifest function contracts are incomplete');
  }
  if (functionName !== undefined && !functions.includes(functionName)) {
    deny('FUNCTION_CONTRACT_MISMATCH', `function ${functionName} is not in the approved manifest`);
  }
  const rebuilt = buildFunctionContracts({
    affectedFunctions: functions,
    graph,
    configBefore,
    configAfter,
    changes: manifest?.delta?.files ?? [],
  });
  if (canonicalJson(rebuilt) !== canonicalJson(contracts)) {
    deny('FUNCTION_CONTRACT_MISMATCH', 'current source or function config differs from the approved manifest');
  }
  const selected = functionName === undefined ? rebuilt : rebuilt.filter(item => item.name === functionName);
  return {
    result: 'FUNCTION_CONTRACT_VERIFIED',
    functions: selected.map(item => ({ name: item.name, source_sha256: item.source_sha256, verify_jwt: item.verify_jwt })),
  };
}

function isImmutableExternalSpecifier(specifier) {
  if (specifier.startsWith('node:')) return true;
  if (/^npm:(?:@[^/]+\/[^@/]+|[^@/]+)@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\/.*)?$/.test(specifier)) return true;
  if (/^jsr:@[^/]+\/[^@/]+@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\/.*)?$/.test(specifier)) return true;
  if (/^https?:\/\//.test(specifier)) {
    let url;
    try {
      url = new URL(specifier);
    } catch {
      return false;
    }
    if (url.protocol !== 'https:') return false;
    if (url.hostname === 'esm.sh') {
      return /@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\/|$)/.test(url.pathname);
    }
    if (url.hostname === 'deno.land') {
      return /^\/(?:std|x\/[A-Za-z0-9._-]+)@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\/|$)/.test(url.pathname);
    }
    if (url.hostname === 'raw.githubusercontent.com') {
      return /^\/[^/]+\/[^/]+\/[0-9a-f]{40}\//i.test(url.pathname);
    }
    return false;
  }
  return false;
}

export function analyzeFunctionReproducibility({ affectedFunctions, graph }) {
  const findings = [];
  const blockedFunctions = new Set();
  for (const functionName of affectedFunctions) {
    const starts = Object.values(graph.nodes).filter(node => node.functionName === functionName).map(node => node.path);
    if (starts.length === 0) {
      findings.push({ severity: 'BLOCKING', code: 'FUNCTION_SOURCE_MISSING', path: null, resource: functionName, message: 'managed function source is missing' });
      blockedFunctions.add(functionName);
      continue;
    }
    const queue = [...starts];
    const visited = new Set();
    while (queue.length) {
      const path = queue.shift();
      if (visited.has(path)) continue;
      visited.add(path);
      const node = graph.nodes[path];
      if (!node) {
        findings.push({ severity: 'BLOCKING', code: 'UNRESOLVED_IMPORT', path, resource: functionName, message: 'resolved dependency is absent from graph' });
        blockedFunctions.add(functionName);
        continue;
      }
      for (const specifier of node.externalImports) {
        if (!isImmutableExternalSpecifier(specifier)) {
          findings.push({
            severity: 'BLOCKING',
            code: 'FLOATING_DEPENDENCY',
            path,
            resource: functionName,
            message: `dependency is not immutably pinned: ${specifier}`,
            specifier,
          });
          blockedFunctions.add(functionName);
        }
      }
      queue.push(...node.localImports);
    }
  }
  findings.sort((left, right) => `${left.resource}:${left.path}:${left.code}`.localeCompare(`${right.resource}:${right.path}:${right.code}`));
  return Object.freeze({ allowed: findings.length === 0, blockedFunctions: [...blockedFunctions].sort(), findings });
}

function riskFinding(code, resource, path, message) {
  return { severity: 'HIGH', code, path: path ?? null, resource: resource ?? null, message };
}

export function classifyRisk({ affectedFunctions = [], changedPaths = [], configBefore = {}, configAfter = {} }) {
  const findings = [];
  const seen = new Set();
  const add = finding => {
    const key = `${finding.code}:${finding.resource}:${finding.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  };
  for (const name of affectedFunctions) {
    if (/stripe|finance|financial|checkout/.test(name)) add(riskFinding('FINANCE_RESOURCE', name, null, 'financial or Stripe resource'));
    if (/webhook/.test(name)) add(riskFinding('WEBHOOK_RESOURCE', name, null, 'webhook resource'));
    if (/bdag/.test(name)) add(riskFinding('BDAG_RESOURCE', name, null, 'BDAG resource'));
    if (/media|stream/.test(name)) add(riskFinding('PRIVATE_MEDIA_RESOURCE', name, null, 'private media resource'));
    if (/moderation|content-safety/.test(name)) add(riskFinding('MODERATION_RESOURCE', name, null, 'moderation resource'));
    if (/auth|token|agora/.test(name)) add(riskFinding('AUTH_RESOURCE', name, null, 'authentication or token resource'));
    const before = configBefore[name]?.verify_jwt;
    const after = configAfter[name]?.verify_jwt;
    if (before !== undefined && after !== undefined && before !== after) {
      add(riskFinding('VERIFY_JWT_CHANGED', name, 'supabase/config.toml', 'verify_jwt changed'));
    }
    if (after === false) add(riskFinding('VERIFY_JWT_DISABLED', name, 'supabase/config.toml', 'verify_jwt is disabled'));
  }
  for (const path of changedPaths) {
    if (/^supabase\/migrations\/[^/]+\.sql$/.test(path)) {
      add(riskFinding('DATABASE_MIGRATION', 'database', path, 'production database migration'));
    }
    if (/^(?:apps\/admin-web\/|shared\/web-deployment\/|shared\/web-media\/)/.test(path)
      || path === 'shared/adsOperationalTruth.ts'
      || path === 'shared/adsErrorPresentation.ts'
      || path === 'assets/branding/nelyon/v1/nelyon-wordmark-on-dark.png') {
      add(riskFinding('ADMIN_WEB_PRODUCTION_RESOURCE', 'admin-web', path,
        'Admin Web production bundle or deployment authority changed'));
    }
    if (path === '.github/nelyon-production-release-policy.json'
      || path === '.github/workflows/nelyon-production-release.yml'
      || path === 'scripts/nelyon-production-release.mjs'
      || path === 'scripts/nelyon-production-snapshot-adapter.mjs'
      || path === 'scripts/nelyon-admin-production-release.mjs') {
      add(riskFinding('GATE_AUTHORITY_CHANGE', 'release-gate', path, 'release authority changed'));
    }
  }
  findings.sort((left, right) => `${left.code}:${left.resource}:${left.path}`.localeCompare(`${right.code}:${right.resource}:${right.path}`));
  return Object.freeze({ level: findings.length ? 'HIGH' : 'STANDARD', findings });
}

function collectFunctionSources(directory, root, files = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) deny('AMBIGUOUS_IMPORT', `function source link is unsupported: ${path}`);
    if (entry.isDirectory()) collectFunctionSources(path, root, files);
    else if (entry.isFile()) {
      const relativePath = relative(root, path).replaceAll('\\', '/');
      const filename = entry.name.toLowerCase();
      if (filename === 'deno.json' || filename === 'deno.jsonc'
        || !/\.(?:ts|tsx|js|jsx|mjs|json)$/.test(filename)) {
        deny('UNSUPPORTED_FUNCTION_SOURCE', `function source or implicit runtime config is unsupported: ${relativePath}`);
      }
      files[relativePath] = readFileSync(path, 'utf8');
    }
  }
  return files;
}

const b2IntegratedSources = new WeakMap();

function b2IntegratedJson(value) {
  let nodes = 0;
  function copy(item, depth = 0) {
    if (++nodes > 50000 || depth > 32) b2Reject();
    if (item === null || typeof item === 'string' || typeof item === 'boolean'
      || typeof item === 'number' && Number.isSafeInteger(item)) return item;
    if (!item || typeof item !== 'object' || types.isProxy(item)) b2Reject();
    const array = Array.isArray(item);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) b2Reject();
    const properties = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(properties).filter(key => !array || key !== 'length');
    if (array && (keys.length !== item.length || keys.some((key, i) => key !== String(i)))) b2Reject();
    const result = array ? [] : Object.create(null);
    for (const key of keys) {
      const property = properties[key];
      if (typeof key !== 'string' || B2_UNSAFE_KEYS.has(key) || !property.enumerable
        || !Object.hasOwn(property, 'value')) b2Reject();
      result[key] = copy(property.value, depth + 1);
    }
    return result;
  }
  return copy(value);
}

function retainB2IntegratedSource({ manifest, descriptorBytes, request = null }) {
  const capability = Object.freeze(Object.create(null));
  b2IntegratedSources.set(capability, { manifestSha256: sha256Hex(canonicalJson(manifest)),
    descriptorSha256: sha256Hex(descriptorBytes), approvedSha: manifest.identity.approved_sha,
    requestSha256: request === null ? null : sha256Hex(canonicalJson(request)) });
  return capability;
}

// Candidate booleans and serialized capabilities cannot authorize an integrated
// commit. Recompile its Git evidence before the private provider is contacted.
export function verifyB2IntegratedSource({ cwd, policy, request, manifest, descriptorBytes }) {
  try {
    policy = b2IntegratedJson(policy); request = b2IntegratedJson(request); manifest = b2IntegratedJson(manifest);
    descriptorBytes = b2Bytes(descriptorBytes, 128 * 1024);
    const git = args => execFileSync('git', args, { cwd, env: gitChildEnvironment(), stdio: 'pipe' });
    const head = git(['rev-parse', 'HEAD']).toString('utf8').trim();
    if (!SHA_PATTERN.test(head) || head !== request.approvedSha || head !== request.mainSha
      || head !== manifest.identity.approved_sha || head !== manifest.baseline.origin_main_sha
      || manifest.identity.run_id !== String(request.runId) || manifest.identity.run_attempt !== request.runAttempt
      || manifest.identity.release_id !== request.releaseId) b2Reject();
    const descriptor = parseB2ReleaseDescriptor(descriptorBytes, sha256Hex(descriptorBytes));
    const evidence = compileLocalEvidence({ cwd, policy, request, generatedAt: manifest.generated_at });
    const rebuilt = buildManifest({ ...evidence, policy, request });
    if (canonicalJson(rebuilt) !== canonicalJson(manifest)) b2Reject();
    if (!evidence.b2Release || manifest.baseline.sha !== descriptor.contract.baseline_sha
      || canonicalJson(manifest.resources.web_control_centers_b2_transition)
        !== canonicalJson(b2PublicBinding(descriptor, sha256Hex(descriptorBytes)))
      || canonicalJson(manifest.resources.function_contracts) !== canonicalJson(evidence.functionContracts)
      || canonicalJson(manifest.resources.migrations) !== canonicalJson(evidence.migrations)
      || canonicalJson(manifest.runtime_closure) !== canonicalJson(evidence.runtimeClosure)
      || !git(['show', `${head}:${B2_DESCRIPTOR_PATH}`]).equals(Buffer.from(descriptorBytes))) b2Reject();
    // The host subsequently reads these working-tree bytes. Check them against
    // the committed tree, including unchanged dependencies and configuration.
    const paths = new Set(['supabase/config.toml', ...descriptor.contract.productive_changes.map(row => row.path),
      ...evidence.functionContracts.flatMap(row => row.source_files.map(file => file.path))]);
    for (const file of paths) {
      const committed = git(['show', `${head}:${file}`]);
      if (!readFileSync(join(cwd, file)).equals(committed)) b2Reject();
    }
    for (const file of descriptor.contract.productive_changes) {
      if (sha256Hex(git(['show', `${descriptor.contract.reviewed_source_sha}:${file.path}`])) !== file.sha256) b2Reject();
    }
    return retainB2IntegratedSource({ manifest, descriptorBytes, request });
  } catch { b2Reject(); }
}

export function assertB2IntegratedSource(capability, { manifest, descriptorBytes, request }) {
  try {
    const state = b2IntegratedSources.get(capability);
    manifest = b2IntegratedJson(manifest); descriptorBytes = b2Bytes(descriptorBytes, 128 * 1024);
    if (request !== undefined) request = b2IntegratedJson(request);
    if (!state || state.manifestSha256 !== sha256Hex(canonicalJson(manifest))
      || state.descriptorSha256 !== sha256Hex(descriptorBytes)
      || state.approvedSha !== manifest.identity.approved_sha
      || (request !== undefined && state.requestSha256 !== sha256Hex(canonicalJson(request)))) b2Reject();
    return true;
  } catch { b2Reject(); }
}

export function verifyB2HistoricalIntegratedSource({ verifiedSource, historicalRuntimeClosure }) {
  try {
    const verified = b2SourceState(verifiedSource);
    const historical = readTrustedB2HistoricalRuntimeClosure(historicalRuntimeClosure, verified.recoveryProvenance);
    const descriptorBytes = readTrustedB2HistoricalDescriptorBytes(historicalRuntimeClosure, verified.recoveryProvenance);
    const descriptor = parseB2ReleaseDescriptor(descriptorBytes, sha256Hex(descriptorBytes));
    if (historical.sourceSha !== verified.provenance.approvedSha
      || historical.sourceSha !== verified.manifest.identity.approved_sha
      || canonicalJson(historical.closure) !== canonicalJson(verified.manifest.runtime_closure)
      || canonicalJson(b2PublicBinding(descriptor, sha256Hex(descriptorBytes)))
        !== canonicalJson(verified.manifest.resources.web_control_centers_b2_transition)) b2RecoveryReject();
    return retainB2IntegratedSource({ manifest: verified.manifest, descriptorBytes });
  } catch { b2RecoveryReject(); }
}

export function compileLocalEvidence({ cwd, policy, request, generatedAt = new Date().toISOString() }) {
  // Keep failing Git diagnostics captured: execFileSync otherwise echoes stderr
  // before callers can turn a private preparation failure into a generic result.
  const runGit = args => execFileSync('git', args, { cwd, env: gitChildEnvironment(), stdio: 'pipe',
    encoding: args.includes('-z') ? 'buffer' : 'utf8' });
  const gitState = resolveGitState({
    cwd,
    baselineSha: policy.baseline.sha,
    approvedSha: request.approvedSha,
    expectedRepository: policy.repository,
    runGit,
  });
  const classified = classifyChangedPaths(gitState.changes);
  const migrationDelta = validateMigrationDelta({
    changes: gitState.changes,
    baselineLatestMigration: policy.baseline.latest_migration,
  });
  const graph = buildFunctionGraph(collectFunctionSources(join(cwd, 'supabase', 'functions'), cwd));
  const baselineConfig = runGit(['show', `${policy.baseline.sha}:supabase/config.toml`]);
  const currentConfig = readFileSync(join(cwd, 'supabase', 'config.toml'), 'utf8');
  const configBefore = parseFunctionConfig(baselineConfig);
  const configAfter = parseFunctionConfig(currentConfig);
  if (!isReadOnlyRecoveryMode(request.mode) && isB2Delta(gitState.changes)) {
    const descriptorBytes = readFileSync(join(cwd, B2_DESCRIPTOR_PATH));
    const expectedDescriptorSha256 = sha256Hex(descriptorBytes);
    const descriptor = parseB2ReleaseDescriptor(descriptorBytes, expectedDescriptorSha256);
    // Candidate descriptors never expand the historical managed allowlist.
    if (descriptor.contract.state !== 'approved') b2Reject();
    const committedDescriptor = runGit(['show', `${request.approvedSha}:${B2_DESCRIPTOR_PATH}`]);
    if (sha256Hex(Buffer.from(committedDescriptor, 'utf8')) !== expectedDescriptorSha256) b2Reject();
    try {
      for (const ancestor of [descriptor.contract.baseline_sha, descriptor.contract.reviewed_source_sha,
        descriptor.contract.integration_base_sha]) runGit(['merge-base', '--is-ancestor', ancestor, request.approvedSha]);
    } catch { b2Reject(); }
    const productiveFiles = classified.productive.map(change => ({ path: change.path, status: change.status,
      type: change.fileType, bytes: Buffer.from(runGit(['show', `${request.approvedSha}:${change.path}`]), 'utf8') }));
    const repositoryRoot = resolve(cwd);
    const runtimeClosure = buildPrivateRuntimeClosure({
      repositoryRoot,
      readFile: absolutePath => {
        const member = relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
        if (!member || member.startsWith('../') || isAbsolute(member)) b2Reject();
        return execFileSync('git', ['show', `${request.approvedSha}:${member}`], {
          cwd, env: gitChildEnvironment(), stdio: 'pipe',
        });
      },
    });
    const publicEvidence = compileB2PublicEvidence({ descriptorBytes, expectedDescriptorSha256, productiveFiles,
      graph, configBefore, configAfter, changes: gitState.changes, gitState, policy,
      ancestry: { baseline: true, reviewedSource: true, integrationBase: true }, runtimeClosure });
    return { ...publicEvidence, gitState, classified,
      reproducibility: analyzeFunctionReproducibility({ affectedFunctions: publicEvidence.affectedFunctions, graph }),
      risk: classifyRisk({ affectedFunctions: publicEvidence.affectedFunctions,
        changedPaths: gitState.changes.map(change => change.path), configBefore, configAfter }),
      compiler: { path: 'scripts/nelyon-production-release.mjs',
        sha256: runtimeClosure.files.find(item => item.path === 'scripts/nelyon-production-release.mjs').sha256,
        snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
        snapshot_adapter_sha256: runtimeClosure.files.find(item => item.path === 'scripts/nelyon-production-snapshot-adapter.mjs').sha256 }, generatedAt };
  }
  const affectedFunctions = resolveAffectedFunctions({
    changes: gitState.changes,
    graph,
    managedFunctions: policy.supabase.managed_functions,
    forbiddenFunctions: policy.supabase.forbidden_functions,
    configBefore,
    configAfter,
  });
  const transitionEvidence = attestManagedScopeTransition({
    cwd,
    policy,
    mode: request.mode,
    approvedSha: request.approvedSha,
    migrations: migrationDelta,
    affectedFunctions,
    runGit,
  });
  const reproducibility = analyzeFunctionReproducibility({ affectedFunctions, graph });
  const functionContracts = buildFunctionContracts({
    affectedFunctions,
    graph,
    configBefore,
    configAfter,
    changes: gitState.changes,
  });
  const financeTransition = attestFinanceAuthorityTransition({ cwd, policy, mode: request.mode, approvedSha: request.approvedSha,
    changes: gitState.changes, migrations: transitionEvidence.migrations, affectedFunctions, runGit });
  const phaseBoundMigrations = attestPhaseBoundMigrationOrigins({
    cwd,
    policy,
    approvedSha: request.approvedSha,
    migrations: financeTransition.migrations,
    runGit,
  });
  const storiesB1Transition = attestStoriesB1Transition({
    cwd,
    policy,
    mode: request.mode,
    approvedSha: request.approvedSha,
    changes: gitState.changes,
    migrations: phaseBoundMigrations,
    affectedFunctions,
    runGit,
  });
  const storiesSafetyC1Transition = attestStoriesSafetyC1Transition({
    cwd,
    policy,
    mode: request.mode,
    approvedSha: request.approvedSha,
    changes: gitState.changes,
    migrations: storiesB1Transition.migrations,
    affectedFunctions,
    runGit,
  });
  const storiesSafetyC2Transition = attestStoriesSafetyC2Transition({
    cwd, policy, mode: request.mode, approvedSha: request.approvedSha,
    changes: gitState.changes, migrations: storiesSafetyC1Transition.migrations, affectedFunctions, runGit,
  });
  const storiesQaC1Transition = attestStoriesQaC1Transition({
    cwd, policy, mode: request.mode, approvedSha: request.approvedSha,
    changes: gitState.changes, migrations: storiesSafetyC2Transition.migrations, affectedFunctions, runGit,
  });
  const superuserControlCenterTransition = attestSuperuserControlCenterTransition({
    cwd, policy, mode: request.mode, approvedSha: request.approvedSha,
    changes: gitState.changes, migrations: storiesQaC1Transition.migrations, affectedFunctions, runGit,
  });
  const superuserQaPerfC1Transition = attestSuperuserQaPerfC1Transition({
    cwd, policy, mode: request.mode, approvedSha: request.approvedSha,
    changes: gitState.changes, migrations: superuserControlCenterTransition.migrations,
    affectedFunctions, runGit,
  });
  const webControlCentersB1Transition = attestWebControlCentersB1Transition({
    cwd, policy, mode: request.mode, approvedSha: request.approvedSha,
    changes: gitState.changes, migrations: superuserQaPerfC1Transition.migrations,
    affectedFunctions, runGit,
  });
  const webControlCentersB1QaC3Transition = attestWebControlCentersB1QaC3Transition({
    cwd, policy, mode: request.mode, approvedSha: request.approvedSha,
    changes: gitState.changes, migrations: webControlCentersB1Transition.migrations,
    affectedFunctions, runGit,
  });
  const risk = classifyRisk({
    affectedFunctions,
    changedPaths: gitState.changes.map(change => change.path),
    configBefore,
    configAfter,
  });
  const compilerPath = join(cwd, 'scripts', 'nelyon-production-release.mjs');
  const snapshotAdapterPath = join(cwd, 'scripts', 'nelyon-production-snapshot-adapter.mjs');
  return {
    gitState,
    classified,
    migrations: webControlCentersB1QaC3Transition.migrations,
    managedScopeTransition: transitionEvidence.attestation,
    financeAuthorityTransition: financeTransition.attestation,
    storiesB1Transition: storiesB1Transition.attestation,
    storiesSafetyC1Transition: storiesSafetyC1Transition.attestation,
    storiesSafetyC2Transition: storiesSafetyC2Transition.attestation,
    storiesQaC1Transition: storiesQaC1Transition.attestation,
    superuserControlCenterTransition: superuserControlCenterTransition.attestation,
    superuserQaPerfC1Transition: superuserQaPerfC1Transition.attestation,
    webControlCentersB1Transition: webControlCentersB1Transition.attestation,
    webControlCentersB1QaC3Transition: webControlCentersB1QaC3Transition.attestation,
    affectedFunctions,
    functionContracts,
    reproducibility,
    risk,
    compiler: {
      path: 'scripts/nelyon-production-release.mjs',
      sha256: sha256Hex(readFileSync(compilerPath)),
      snapshot_adapter_path: 'scripts/nelyon-production-snapshot-adapter.mjs',
      snapshot_adapter_sha256: sha256Hex(readFileSync(snapshotAdapterPath)),
    },
    generatedAt,
  };
}

function stableCopy(value) {
  return JSON.parse(canonicalJson(value));
}

export function buildManifest({
  request,
  policy,
  gitState,
  classified,
  migrations,
  managedScopeTransition,
  financeAuthorityTransition,
  storiesB1Transition,
  storiesSafetyC1Transition,
  storiesSafetyC2Transition,
  storiesQaC1Transition,
  superuserControlCenterTransition,
  superuserQaPerfC1Transition,
  webControlCentersB1Transition,
  webControlCentersB1QaC3Transition,
  b2Release,
  affectedFunctions,
  functionContracts,
  reproducibility,
  risk,
  runtimeClosure,
  compiler,
  generatedAt,
  pendingB2Recovery,
}) {
  if (pendingB2Recovery !== undefined) {
    const state = pendingB2RecoveryRequests.get(pendingB2Recovery);
    if (!state || state.request !== canonicalJson(request) || state.policy !== sha256Hex(canonicalJson(policy))) {
      deny('INVALID_RECOVERY_SOURCE', 'pending recovery capability does not match the request and policy');
    }
    validateRequestStructure(request, policy);
  } else validateRequest(request, policy);
  const b2Candidate = !isReadOnlyRecoveryMode(request.mode)
    && (isB2Delta(gitState?.changes) || isB2Delta(classified?.productive));
  if (b2Candidate) {
    ({ gitState, classified, migrations, functionContracts, affectedFunctions, risk, reproducibility, runtimeClosure, compiler, generatedAt }
      = projectB2EvidenceParts({ gitState, classified, migrations, functionContracts, affectedFunctions,
        risk, reproducibility, runtimeClosure, compiler, generatedAt }));
    b2Release = projectB2ReleaseEvidence(b2Release, policy);
  }
  const b2Binding = b2Candidate ? validateB2CompiledPublic({ b2Release, policy, gitState,
    classified, functionContracts, migrations }) : null;
  if (b2Candidate && risk?.level !== 'HIGH') b2Reject();
  if (!b2Candidate && b2Release !== undefined) b2Reject();
  const recoveryMode = isReadOnlyRecoveryMode(request.mode);
  if (!risk || !['STANDARD', 'HIGH'].includes(risk.level) || !Array.isArray(risk.findings)) {
    deny('INVALID_RISK_CLASSIFICATION', 'manifest risk classification is incomplete');
  }
  if (request.mode === 'admin_recovery' && risk.level !== 'HIGH') {
    deny('INVALID_RISK_CLASSIFICATION', 'Admin recovery is always a HIGH-risk Cloudflare production operation');
  }
  if (request.mode === 'release') {
    const requiredConfirmation = risk.level === 'HIGH'
      ? policy.scope_confirmations.release_high_risk
      : policy.scope_confirmations.release_standard;
    if (request.scopeConfirmation !== requiredConfirmation) {
      deny(
        risk.level === 'HIGH' ? 'HIGH_RISK_CONFIRMATION_REQUIRED' : 'SCOPE_CONFIRMATION_MISMATCH',
        'release confirmation does not match the computed manifest risk',
      );
    }
  }
  if (!/^[0-9a-f]{64}$/.test(compiler?.sha256 ?? '')
    || compiler?.path !== 'scripts/nelyon-production-release.mjs'
    || compiler?.snapshot_adapter_path !== 'scripts/nelyon-production-snapshot-adapter.mjs'
    || !/^[0-9a-f]{64}$/.test(compiler?.snapshot_adapter_sha256 ?? '')) {
    deny('INVALID_COMPILER_IDENTITY', 'compiler SHA-256 is invalid');
  }
  if (b2Candidate || pendingB2Recovery || (request.mode === 'admin_recovery' && runtimeClosure)) {
    b2AssertCompilerClosure(compiler, runtimeClosure);
  }
  const contracts = (recoveryMode ? [] : [...(functionContracts ?? [])]).map(stableCopy).sort((left, right) => String(left.name).localeCompare(String(right.name)));
  const functionNames = (recoveryMode ? [] : [...affectedFunctions]).sort();
  const earlyF5Candidate = !recoveryMode && migrations?.some(item => item.version === '20261026072512'
    || item.path === F5_AUTONOMOUS_FINANCE_AUTHORITY_TRANSITION.migration_path);
  if (earlyF5Candidate
    && canonicalJson(functionNames) !== canonicalJson([F5_AUTONOMOUS_FINANCE_AUTHORITY_TRANSITION.function])) {
    deny('INVALID_FINANCE_AUTHORITY_TRANSITION', 'F5 requires exactly the bdag-ledger function contract');
  }
  if (canonicalJson(contracts.map(item => item.name)) !== canonicalJson(functionNames)
    || contracts.some(contract => typeof contract.entrypoint !== 'string'
      || (contract.import_map !== null && typeof contract.import_map !== 'string')
      || typeof contract.verify_jwt !== 'boolean'
      || typeof contract.source_changed !== 'boolean'
      || !Array.isArray(contract.source_files) || contract.source_files.length === 0
      || !/^[0-9a-f]{64}$/.test(contract.source_sha256 ?? '')
      || contract.source_files.some(item => typeof item?.path !== 'string' || !/^[0-9a-f]{64}$/.test(item?.sha256 ?? '')))) {
    deny('FUNCTION_CONTRACT_MISMATCH', 'manifest function contracts do not match the affected function set');
  }
  const f2MigrationPath = `supabase/migrations/${F2_MANAGED_SCOPE_TRANSITION.migration}.sql`;
  const f2Migration = migrations?.find(item => item?.path === f2MigrationPath);
  const f2TransitionCandidate = !recoveryMode
    && policy?.baseline?.sha === F2_MANAGED_SCOPE_TRANSITION.baseline_sha
    && (Boolean(f2Migration) || functionNames.includes(F2_MANAGED_SCOPE_TRANSITION.resource));
  if (f2TransitionCandidate) {
    const expectedAttestation = {
      id: F2_MANAGED_SCOPE_TRANSITION.id,
      attested_source_sha: F2_MANAGED_SCOPE_TRANSITION.attested_source_sha,
      approved_sha: request.approvedSha,
      descendant_verified: true,
      migration_blob: F2_MANAGED_SCOPE_TRANSITION.migration_blob,
    };
    if (!f2Migration
      || f2Migration.blob !== F2_MANAGED_SCOPE_TRANSITION.migration_blob
      || canonicalJson(managedScopeTransition) !== canonicalJson(expectedAttestation)) {
      deny('INVALID_MANAGED_SCOPE_TRANSITION', 'manifest lacks the exact Git-attested F2 managed scope transition');
    }
  } else if (managedScopeTransition !== undefined && managedScopeTransition !== null) {
    deny('INVALID_MANAGED_SCOPE_TRANSITION', 'managed scope transition attestation is not applicable');
  }
  const stories = STORIES_B1_RELEASE_TRANSITION;
  const storiesCandidate = !recoveryMode && migrations?.some(item => item?.path === stories.migration_path);
  if (storiesCandidate) {
    const expectedAttestation = {
      ...stableCopy(stories),
      approved_sha: request.approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true,
    };
    const expectedFunctions = stories.functions.map(item => item.name).sort();
    const expectedByName = new Map(stories.functions.map(item => [item.name, item]));
    if (canonicalJson(policy?.stories_b1_transition ?? null) !== canonicalJson(stories)
      || policy.baseline.sha !== stories.baseline_sha
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || gitState.baselineSha !== stories.baseline_sha || risk.level !== 'HIGH'
      || migrations.length !== 1 || migrations[0].path !== stories.migration_path
      || migrations[0].blob !== stories.migration_blob || migrations[0].sha256 !== stories.migration_sha256
      || canonicalJson(functionNames) !== canonicalJson(expectedFunctions)
      || canonicalJson(storiesB1Transition ?? null) !== canonicalJson(expectedAttestation)
      || classified.config.length !== 0
      || canonicalJson(policy.supabase.finance_policy) !== canonicalJson(stories.finance_policy)
      || contracts.some(contract => {
        const expected = expectedByName.get(contract.name);
        return !expected || contract.source_changed !== true
          || contract.source_sha256 !== expected.source_sha256
          || contract.verify_jwt !== expected.verify_jwt;
      })) {
      deny('INVALID_STORIES_B1_TRANSITION', 'manifest lacks the exact Stories B1 fail-closed release attestation');
    }
  } else if (storiesB1Transition !== undefined && storiesB1Transition !== null) {
    deny('INVALID_STORIES_B1_TRANSITION', 'Stories B1 transition attestation is not applicable');
  }
  const storiesSafety = STORIES_SAFETY_C1_RELEASE_TRANSITION;
  const storiesSafetyCandidate = !recoveryMode
    && migrations?.some(item => item?.path === storiesSafety.migration_path);
  if (storiesSafetyCandidate) {
    const expectedAttestation = {
      ...stableCopy(storiesSafety),
      approved_sha: request.approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true,
    };
    if (canonicalJson(policy?.stories_safety_c1_transition ?? null) !== canonicalJson(storiesSafety)
      || policy.baseline.sha !== storiesSafety.baseline_sha
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || gitState.baselineSha !== storiesSafety.baseline_sha || risk.level !== 'HIGH'
      || migrations.length !== 1 || migrations[0].path !== storiesSafety.migration_path
      || migrations[0].blob !== storiesSafety.migration_blob
      || migrations[0].sha256 !== storiesSafety.migration_sha256
      || functionNames.length !== 0 || contracts.length !== 0
      || canonicalJson(storiesSafetyC1Transition ?? null) !== canonicalJson(expectedAttestation)
      || classified.config.length !== 0
      || canonicalJson(classified.productive.map(item => item.path).sort())
        !== canonicalJson(storiesSafety.productive_paths)
      || canonicalJson(policy.supabase.finance_policy) !== canonicalJson(storiesSafety.finance_policy)
      || storiesSafety.safety.activation !== false
      || storiesSafety.safety.owner_approved_policy !== false
      || storiesSafety.safety.auto_publish_enabled !== false
      || storiesSafety.safety.automatic_allow_authorized !== false
      || storiesSafety.safety.automatic_block_authorized !== false
      || canonicalJson(storiesSafety.safety.decisions) !== canonicalJson(['pending', 'review'])) {
      deny('INVALID_STORIES_SAFETY_C1_TRANSITION',
        'manifest lacks the exact Stories Safety C1 fail-closed technical-preparation attestation');
    }
  } else if (storiesSafetyC1Transition !== undefined && storiesSafetyC1Transition !== null) {
    deny('INVALID_STORIES_SAFETY_C1_TRANSITION',
      'Stories Safety C1 transition attestation is not applicable');
  }
  const storiesSafetyC2 = STORIES_SAFETY_C2_RELEASE_TRANSITION;
  const storiesSafetyC2Candidate = !recoveryMode
    && migrations?.some(item => item?.path === storiesSafetyC2.migration_path);
  if (storiesSafetyC2Candidate) {
    const expectedFunctions = storiesSafetyC2.functions.map(item => item.name).sort();
    const expectedByName = new Map(storiesSafetyC2.functions.map(item => [item.name, item]));
    const expectedAttestation = {
      ...stableCopy(storiesSafetyC2),
      approved_sha: request.approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true,
    };
    if (canonicalJson(policy?.stories_safety_c2_transition ?? null) !== canonicalJson(storiesSafetyC2)
      || policy.baseline.sha !== storiesSafetyC2.baseline_sha
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || gitState.baselineSha !== storiesSafetyC2.baseline_sha || risk.level !== 'HIGH'
      || migrations.length !== 1 || migrations[0].path !== storiesSafetyC2.migration_path
      || migrations[0].version !== '20261027191918'
      || migrations[0].blob !== storiesSafetyC2.migration_blob
      || migrations[0].sha256 !== storiesSafetyC2.migration_sha256
      || canonicalJson(functionNames) !== canonicalJson(expectedFunctions)
      || contracts.length !== 1 || contracts.some(contract => {
        const expected = expectedByName.get(contract.name);
        return !expected || contract.source_changed !== true || contract.source_sha256 !== expected.source_sha256
          || contract.verify_jwt !== expected.verify_jwt;
      })
      || canonicalJson(storiesSafetyC2Transition ?? null) !== canonicalJson(expectedAttestation)
      || classified.config.length !== 0
      || canonicalJson(classified.productive.map(item => item.path).sort())
        !== canonicalJson(storiesSafetyC2.productive_paths)
      || canonicalJson(policy.supabase.finance_policy) !== canonicalJson(storiesSafetyC2.finance_policy)
      || storiesSafetyC2.safety.activation !== true
      || storiesSafetyC2.safety.owner_approved_policy !== false
      || storiesSafetyC2.safety.owner_approved_operating_model !== true
      || storiesSafetyC2.safety.automatic_allow_authorized !== false
      || storiesSafetyC2.safety.automatic_block_authorized !== false
      || storiesSafetyC2.safety.mode !== 'PUBLISH_FIRST_ASYNC_REVIEW'
      || storiesSafetyC2.safety.numeric_thresholds !== null
      || storiesSafetyC2.safety.historical_backfill !== false) {
      deny('INVALID_STORIES_SAFETY_C2_TRANSITION',
        'manifest lacks the exact Stories Safety C2 publish-first operating-model attestation');
    }
  } else if (storiesSafetyC2Transition !== undefined && storiesSafetyC2Transition !== null) {
    deny('INVALID_STORIES_SAFETY_C2_TRANSITION',
      'Stories Safety C2 transition attestation is not applicable');
  }
  const storiesQaC1 = STORIES_QA_C1_RELEASE_TRANSITION;
  const storiesQaC1Candidate = !recoveryMode
    && migrations?.some(item => item?.path === storiesQaC1.migration_path);
  if (storiesQaC1Candidate) {
    const expectedAttestation = {
      ...stableCopy(storiesQaC1),
      approved_sha: request.approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true,
    };
    if (canonicalJson(policy?.stories_qa_c1_transition ?? null) !== canonicalJson(storiesQaC1)
      || policy.baseline.sha !== storiesQaC1.baseline_sha
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || request.mainSha !== request.approvedSha
      || gitState.baselineSha !== storiesQaC1.baseline_sha || risk.level !== 'HIGH'
      || migrations.length !== 1 || migrations[0].path !== storiesQaC1.migration_path
      || migrations[0].version !== '20261029042807'
      || migrations[0].blob !== storiesQaC1.migration_blob
      || migrations[0].sha256 !== storiesQaC1.migration_sha256
      || functionNames.length !== 0 || contracts.length !== 0
      || canonicalJson(storiesQaC1Transition ?? null) !== canonicalJson(expectedAttestation)
      || classified.config.length !== 0
      || canonicalJson(classified.productive.map(item => item.path).sort())
        !== canonicalJson(storiesQaC1.productive_paths)
      || canonicalJson(policy.supabase.finance_policy) !== canonicalJson(storiesQaC1.finance_policy)) {
      deny('INVALID_STORIES_QA_C1_TRANSITION',
        'manifest lacks the exact Stories QA C1 one-migration zero-Edge attestation');
    }
  } else if (storiesQaC1Transition !== undefined && storiesQaC1Transition !== null) {
    deny('INVALID_STORIES_QA_C1_TRANSITION', 'Stories QA C1 transition attestation is not applicable');
  }
  const controlCenter = SUPERUSER_CONTROL_CENTER_RELEASE_TRANSITION;
  const controlCenterCandidate = !recoveryMode
    && migrations?.some(item => controlCenter.productive_paths.includes(item?.path));
  if (controlCenterCandidate) {
    const expectedAttestation = {
      ...stableCopy(controlCenter),
      approved_sha: request.approvedSha,
      baseline_descendant_verified: true,
      integration_base_descendant_verified: true,
      reviewed_bytes_verified: true,
    };
    const expectedMigrations = controlCenter.migrations.map(item => ({
      version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
    })).sort((left, right) => left.version.localeCompare(right.version));
    const actualMigrations = [...(migrations ?? [])].map(item => ({
      version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
    })).sort((left, right) => left.version.localeCompare(right.version));
    if (canonicalJson(policy?.superuser_control_center_transition ?? null) !== canonicalJson(controlCenter)
      || policy.baseline.sha !== controlCenter.baseline_sha
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || request.mainSha !== request.approvedSha
      || gitState.baselineSha !== controlCenter.baseline_sha || risk.level !== 'HIGH'
      || canonicalJson(actualMigrations) !== canonicalJson(expectedMigrations)
      || functionNames.length !== 0 || contracts.length !== 0
      || canonicalJson(superuserControlCenterTransition ?? null) !== canonicalJson(expectedAttestation)
      || classified.config.length !== 0
      || canonicalJson(classified.productive.map(item => item.path).sort())
        !== canonicalJson([...controlCenter.productive_paths].sort())
      || canonicalJson(policy.supabase.finance_policy) !== canonicalJson(controlCenter.finance_policy)) {
      deny('INVALID_SUPERUSER_CONTROL_CENTER_TRANSITION',
        'manifest lacks the exact Superuser Control Center three-migration zero-Edge attestation');
    }
  } else if (superuserControlCenterTransition !== undefined && superuserControlCenterTransition !== null) {
    deny('INVALID_SUPERUSER_CONTROL_CENTER_TRANSITION',
      'Superuser Control Center transition attestation is not applicable');
  }
  const perfC1 = SUPERUSER_QA_PERF_C1_RELEASE_TRANSITION;
  const perfC1Candidate = !recoveryMode
    && migrations?.some(item => perfC1.productive_paths.includes(item?.path));
  if (perfC1Candidate) {
    const expectedAttestation = {
      ...stableCopy(perfC1), approved_sha: request.approvedSha,
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_bytes_verified: true,
    };
    const expectedMigrations = perfC1.migrations.map(item => ({
      version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
    })).sort((left, right) => left.version.localeCompare(right.version));
    const actualMigrations = [...(migrations ?? [])].map(item => ({
      version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
    })).sort((left, right) => left.version.localeCompare(right.version));
    if (canonicalJson(policy?.superuser_qa_perf_c1_transition ?? null) !== canonicalJson(perfC1)
      || policy.baseline.sha !== perfC1.baseline_sha
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || request.mainSha !== request.approvedSha || gitState.baselineSha !== perfC1.baseline_sha
      || risk.level !== 'HIGH' || canonicalJson(actualMigrations) !== canonicalJson(expectedMigrations)
      || functionNames.length !== 0 || contracts.length !== 0
      || canonicalJson(superuserQaPerfC1Transition ?? null) !== canonicalJson(expectedAttestation)
      || classified.config.length !== 0
      || canonicalJson(classified.productive.map(item => item.path).sort())
        !== canonicalJson([...perfC1.productive_paths].sort())
      || canonicalJson(policy.supabase.finance_policy) !== canonicalJson(perfC1.finance_policy)) {
      deny('INVALID_SUPERUSER_QA_PERF_C1_TRANSITION',
        'manifest lacks the exact PERF C1 one-migration zero-Edge attestation');
    }
  } else if (superuserQaPerfC1Transition !== undefined && superuserQaPerfC1Transition !== null) {
    deny('INVALID_SUPERUSER_QA_PERF_C1_TRANSITION', 'PERF C1 transition attestation is not applicable');
  }
  const webB1 = WEB_CONTROL_CENTERS_B1_RELEASE_TRANSITION;
  const webB1Candidate = !recoveryMode
    && migrations?.some(item => webB1.productive_paths.includes(item?.path));
  if (webB1Candidate) {
    const expectedAttestation = {
      ...stableCopy(webB1), approved_sha: request.approvedSha,
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true, reviewed_bytes_verified: true,
    };
    const expectedMigrations = webB1.migrations.map(item => ({
      version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
    })).sort((left, right) => left.version.localeCompare(right.version));
    const actualMigrations = [...(migrations ?? [])].map(item => ({
      version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
    })).sort((left, right) => left.version.localeCompare(right.version));
    if (canonicalJson(policy?.web_control_centers_b1_transition ?? null) !== canonicalJson(webB1)
      || policy.baseline.sha !== webB1.baseline_sha
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || request.mainSha !== request.approvedSha || gitState.baselineSha !== webB1.baseline_sha
      || risk.level !== 'HIGH' || canonicalJson(actualMigrations) !== canonicalJson(expectedMigrations)
      || functionNames.length !== 0 || contracts.length !== 0
      || canonicalJson(webControlCentersB1Transition ?? null) !== canonicalJson(expectedAttestation)
      || classified.config.length !== 0
      || canonicalJson(classified.productive.map(item => item.path).sort())
        !== canonicalJson([...webB1.productive_paths].sort())
      || canonicalJson(policy.supabase.finance_policy) !== canonicalJson(webB1.finance_policy)) {
      deny('INVALID_WEB_CONTROL_CENTERS_B1_TRANSITION',
        'manifest lacks the exact B1 one-migration zero-Edge/config/finance attestation');
    }
  } else if (webControlCentersB1Transition !== undefined && webControlCentersB1Transition !== null) {
    deny('INVALID_WEB_CONTROL_CENTERS_B1_TRANSITION', 'B1 transition attestation is not applicable');
  }
  const webB1QaC3 = WEB_CONTROL_CENTERS_B1_QA_C3_RELEASE_TRANSITION;
  const webB1QaC3Candidate = !recoveryMode
    && migrations?.some(item => webB1QaC3.productive_paths.includes(item?.path));
  if (webB1QaC3Candidate) {
    const expectedAttestation = {
      ...stableCopy(webB1QaC3), approved_sha: request.approvedSha,
      baseline_descendant_verified: true, integration_base_descendant_verified: true,
      reviewed_source_descendant_verified: true, reviewed_bytes_verified: true,
    };
    const expectedMigrations = webB1QaC3.migrations.map(item => ({
      version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
    })).sort((left, right) => left.version.localeCompare(right.version));
    const actualMigrations = [...(migrations ?? [])].map(item => ({
      version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
    })).sort((left, right) => left.version.localeCompare(right.version));
    if (canonicalJson(policy?.web_control_centers_b1_qa_c3_transition ?? null)
        !== canonicalJson(webB1QaC3)
      || policy.baseline.sha !== webB1QaC3.baseline_sha
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || request.mainSha !== request.approvedSha || gitState.baselineSha !== webB1QaC3.baseline_sha
      || risk.level !== 'HIGH' || canonicalJson(actualMigrations) !== canonicalJson(expectedMigrations)
      || functionNames.length !== 0 || contracts.length !== 0
      || canonicalJson(webControlCentersB1QaC3Transition ?? null)
        !== canonicalJson(expectedAttestation)
      || classified.config.length !== 0
      || canonicalJson(classified.productive.map(item => item.path).sort())
        !== canonicalJson([...webB1QaC3.productive_paths].sort())
      || canonicalJson(policy.supabase.finance_policy)
        !== canonicalJson(webB1QaC3.finance_policy)) {
      deny('INVALID_WEB_CONTROL_CENTERS_B1_QA_C3_TRANSITION',
        'manifest lacks the exact QA-C3 one-migration zero-Edge/config/finance attestation');
    }
  } else if (webControlCentersB1QaC3Transition !== undefined
    && webControlCentersB1QaC3Transition !== null) {
    deny('INVALID_WEB_CONTROL_CENTERS_B1_QA_C3_TRANSITION',
      'QA-C3 transition attestation is not applicable');
  }
  const f5 = F5_AUTONOMOUS_FINANCE_AUTHORITY_TRANSITION;
  const f5Candidate = !recoveryMode && migrations?.some(item => item.version === '20261026072512'
    || item.path === f5.migration_path);
  if (f5Candidate) {
    const expected = {
      id: f5.id, from_phase: f5.from_phase, to_phase: f5.to_phase, baseline_sha: f5.baseline_sha,
      reviewed_source_sha: f5.reviewed_source_sha, integration_base_sha: f5.integration_base_sha,
      approved_sha: request.approvedSha, baseline_descendant_verified: true,
      integration_base_descendant_verified: true, migration_blob: f5.migration_blob,
      migration_sha256: f5.migration_sha256, function_blob: f5.function_blob,
      function_source_sha256: f5.function_source_sha256, config_blob: f5.config_blob,
      client_contract: f5.client_contract, client_sources: f5.client_sources, cron_job: f5.cron_job,
    };
    const contract = contracts[0];
    if (canonicalJson(policy?.finance_authority_f5_transition) !== canonicalJson(f5)
      || policy.baseline.sha !== f5.baseline_sha
      || canonicalJson(policy.supabase.finance_policy) !== canonicalJson({
        platform_fee_bps: f5.finance_policy.platform_fee_bps,
        purchase_enabled: f5.finance_policy.purchase_enabled,
        refunds_enabled: f5.finance_policy.refunds_enabled,
        subscription_enabled: f5.finance_policy.subscription_enabled,
      })
      || canonicalJson(financeAuthorityTransition ?? null) !== canonicalJson(expected)
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || gitState.baselineSha !== f5.baseline_sha || risk.level !== 'HIGH'
      || canonicalJson(classified.productive.map(item => item.path).sort()) !== canonicalJson(f5.productive_paths)
      || migrations.length !== 1 || migrations[0].path !== f5.migration_path
      || migrations[0].blob !== f5.migration_blob || migrations[0].sha256 !== f5.migration_sha256
      || canonicalJson(functionNames) !== canonicalJson([f5.function]) || contracts.length !== 1
      || contract?.name !== f5.function || contract?.entrypoint !== f5.function_path
      || contract?.verify_jwt !== true || contract?.source_changed !== true
      || contract?.source_sha256 !== f5.function_source_sha256 || classified.config.length !== 0) {
      deny('INVALID_FINANCE_AUTHORITY_TRANSITION', 'manifest lacks the exact F5 ancestry/bytes/closure attestation');
    }
  }
  const f4 = F4_GENERAL_FINANCE_AUTHORITY_TRANSITION;
  const f4Candidate = !f5Candidate && !recoveryMode && migrations?.some(item => item.version === '20261026030000'
    || item.path === f4.migration_path);
  if (f4Candidate) {
    const expected = {
      id: f4.id, from_phase: f4.from_phase, to_phase: f4.to_phase, baseline_sha: f4.baseline_sha,
      reviewed_source_sha: f4.reviewed_source_sha, integration_base_sha: f4.integration_base_sha,
      approved_sha: request.approvedSha, baseline_descendant_verified: true,
      integration_base_descendant_verified: true, migration_blob: f4.migration_blob,
      migration_sha256: f4.migration_sha256,
    };
    if (canonicalJson(policy?.finance_authority_f4_transition) !== canonicalJson(f4)
      || policy.baseline.sha !== f4.baseline_sha
      || canonicalJson(financeAuthorityTransition ?? null) !== canonicalJson(expected)
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || gitState.baselineSha !== f4.baseline_sha
      || canonicalJson(classified.productive.map(item => item.path).sort()) !== canonicalJson(f4.productive_paths)
      || migrations.length !== 1 || migrations[0].path !== f4.migration_path
      || migrations[0].blob !== f4.migration_blob || migrations[0].sha256 !== f4.migration_sha256
      || functionNames.length !== 0 || contracts.length !== 0 || classified.config.length !== 0) {
      deny('INVALID_FINANCE_AUTHORITY_TRANSITION', 'manifest lacks the exact F4 ancestry/bytes/closure attestation');
    }
  }
  const c2 = F3_C2_FINANCE_AUTHORITY_TRANSITION;
  const c2Candidate = !f4Candidate && !recoveryMode && migrations?.some(item => item.version === '20261025160452'
    || item.path === c2.migration_path);
  if (c2Candidate) {
    const expected = {
      id: c2.id, from_phase: c2.from_phase, to_phase: c2.to_phase, baseline_sha: c2.baseline_sha,
      reviewed_source_sha: c2.reviewed_source_sha, integration_base_sha: c2.integration_base_sha,
      approved_sha: request.approvedSha, baseline_descendant_verified: true,
      integration_base_descendant_verified: true, migration_blob: c2.migration_blob,
      migration_sha256: c2.migration_sha256,
    };
    if (policy.baseline.sha !== c2.baseline_sha
      || canonicalJson(financeAuthorityTransition ?? null) !== canonicalJson(expected)
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || gitState.baselineSha !== c2.baseline_sha
      || canonicalJson(classified.productive.map(item => item.path).sort()) !== canonicalJson(c2.productive_paths)
      || migrations.length !== 1 || migrations[0].path !== c2.migration_path
      || migrations[0].blob !== c2.migration_blob || migrations[0].sha256 !== c2.migration_sha256
      || functionNames.length !== 0 || contracts.length !== 0 || classified.config.length !== 0) {
      deny('INVALID_FINANCE_AUTHORITY_TRANSITION', 'manifest lacks the exact C2 ancestry/bytes/closure attestation');
    }
  }
  const f3 = F3_FINANCE_AUTHORITY_TRANSITION;
  const f3Candidate = !f5Candidate && !f4Candidate && !c2Candidate && !recoveryMode && (migrations?.some(item => item.version === '20261025011000' || item.path === f3.migration_path)
    || (policy.baseline.sha === f3.baseline_sha && functionNames.includes(f3.function)));
  if (f3Candidate) {
    const expected = { id: f3.id, phase: f3.phase, baseline_sha: f3.baseline_sha,
      reviewed_source_sha: f3.reviewed_source_sha, integration_base_sha: f3.integration_base_sha,
      approved_sha: request.approvedSha, baseline_descendant_verified: true, integration_base_descendant_verified: true,
      migration_blob: f3.migration_blob, migration_sha256: f3.migration_sha256,
      function_blob: f3.function_blob, function_source_sha256: f3.function_source_sha256, config_blob: f3.config_blob,
      client_contract: f3.client_contract, client_sources: f3.client_sources, frozen_f2_parser: f3.frozen_f2_parser };
    if (recoveryMode || policy.baseline.sha !== f3.baseline_sha
      || canonicalJson(financeAuthorityTransition ?? null) !== canonicalJson(expected)
      || gitState.approvedSha !== request.approvedSha || gitState.originMainSha !== request.approvedSha
      || gitState.baselineSha !== f3.baseline_sha
      || canonicalJson(classified.productive.map(item => item.path).sort()) !== canonicalJson(f3.productive_paths)
      || migrations.length !== 1 || migrations[0].path !== f3.migration_path
      || migrations[0].blob !== f3.migration_blob || migrations[0].sha256 !== f3.migration_sha256
      || canonicalJson(functionNames) !== canonicalJson([f3.function])
      || contracts[0]?.source_sha256 !== f3.function_source_sha256 || classified.config.length !== 0) {
      deny('INVALID_FINANCE_AUTHORITY_TRANSITION', 'manifest lacks the exact foundation ancestry/bytes/closure attestation');
    }
  } else if (!f5Candidate && !f4Candidate && !c2Candidate && financeAuthorityTransition != null) deny('INVALID_FINANCE_AUTHORITY_TRANSITION', 'foundation attestation is inapplicable');
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    deny('INVALID_MANIFEST_TIME', 'manifest generation time is invalid');
  }
  const files = [...(classified?.all ?? [])]
    .map(change => ({ file_type: change.fileType ?? null, path: change.path, status: change.status }))
    .sort((left, right) => `${left.path}:${left.status}`.localeCompare(`${right.path}:${right.status}`));
  const baselineBlockers = [...affectedFunctions]
    .filter(resource => (policy.baseline.blocked_resources ?? []).includes(resource))
    .map(resource => ({
      severity: 'BLOCKING',
      code: 'BASELINE_RESOURCE_UNREPRODUCIBLE',
      path: null,
      resource,
      message: 'verified baseline marks this resource unreproducible',
    }));
  const blockers = [...(reproducibility?.findings ?? []), ...baselineBlockers,
    ...(pendingB2Recovery ? [{ severity: 'BLOCKING', code: 'PRIVATE_B2_AUTHORITY_PENDING', path: null,
      resource: 'recovery', message: 'separate protected exact-attempt authorization is required' }] : [])]
    .map(stableCopy)
    .filter((finding, index, findings) => findings.findIndex(candidate => (
      candidate.code === finding.code
      && candidate.resource === finding.resource
      && candidate.path === finding.path
    )) === index)
    .sort((left, right) => `${left.code}:${left.resource}:${left.path}`.localeCompare(`${right.code}:${right.resource}:${right.path}`));
  const productiveCount = recoveryMode ? 0 : (classified?.productive?.length ?? 0);
  const result = blockers.length > 0
    ? 'DENY'
    : productiveCount === 0
      ? 'NO PRODUCTIVE CHANGES'
      : 'PLAN READY';
  return {
    schema_version: 1,
    generated_at: new Date(generatedAt).toISOString(),
    identity: {
      actor: request.actor,
      triggering_actor: request.triggeringActor,
      repository: request.repository,
      workflow_ref: request.workflowRef,
      ref: request.ref,
      run_id: String(request.runId),
      run_attempt: request.runAttempt,
      release_id: request.releaseId,
      approved_sha: request.approvedSha,
      mode: request.mode,
      scope_confirmation: request.scopeConfirmation,
    },
    ...(request.mode === 'admin_recovery' ? {
      recovery: {
        kind: 'admin_cloudflare_forward_completion',
        source_run_id: String(request.recoverySourceRunId),
      },
    } : {}),
    ...(pendingB2Recovery ? { recovery: { kind: 'postcheck_only', source_run_id: String(request.recoverySourceRunId) } } : {}),
    baseline: {
      state: policy.baseline.state,
      sha: gitState.baselineSha,
      origin_main_sha: gitState.originMainSha,
    },
    delta: {
      files,
      productive_change_count: productiveCount,
    },
    resources: {
      ...(b2Binding ? { web_control_centers_b2_transition: b2Binding } : {}),
      functions: functionNames,
      function_contracts: contracts,
      migrations: (recoveryMode ? [] : [...migrations]).map(stableCopy).sort((left, right) => left.version.localeCompare(right.version)),
      config_changed: recoveryMode ? false : (classified?.config?.length ?? 0) > 0,
      ...(managedScopeTransition ? { managed_scope_transition: stableCopy(managedScopeTransition) } : {}),
      ...(financeAuthorityTransition ? { finance_authority_transition: stableCopy(financeAuthorityTransition) } : {}),
      ...(storiesB1Transition ? { stories_b1_transition: stableCopy(storiesB1Transition) } : {}),
      ...(storiesSafetyC1Transition
        ? { stories_safety_c1_transition: stableCopy(storiesSafetyC1Transition) }
        : {}),
      ...(storiesSafetyC2Transition
        ? { stories_safety_c2_transition: stableCopy(storiesSafetyC2Transition) }
        : {}),
      ...(storiesQaC1Transition
        ? { stories_qa_c1_transition: stableCopy(storiesQaC1Transition) }
        : {}),
      ...(superuserControlCenterTransition
        ? { superuser_control_center_transition: stableCopy(superuserControlCenterTransition) }
        : {}),
      ...(superuserQaPerfC1Transition
        ? { superuser_qa_perf_c1_transition: stableCopy(superuserQaPerfC1Transition) }
        : {}),
      ...(webControlCentersB1Transition
        ? { web_control_centers_b1_transition: stableCopy(webControlCentersB1Transition) }
        : {}),
      ...(webControlCentersB1QaC3Transition
        ? { web_control_centers_b1_qa_c3_transition: stableCopy(webControlCentersB1QaC3Transition) }
        : {}),
    },
    risk: stableCopy(risk),
    blockers,
    compiler: {
      path: compiler.path,
      sha256: compiler.sha256,
      snapshot_adapter_path: compiler.snapshot_adapter_path,
      snapshot_adapter_sha256: compiler.snapshot_adapter_sha256,
    },
    ...((b2Binding || pendingB2Recovery || (request.mode === 'admin_recovery' && runtimeClosure))
      ? { runtime_closure: runtimeClosure } : {}),
    result,
  };
}

const BUNDLE_FILES = ['manifest.json', 'manifest.sha256', 'summary.md'];

function assertSafeBundleDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    deny('UNSAFE_ARTIFACT', 'bundle directory must resolve to an absolute path');
  }
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) deny('UNSAFE_ARTIFACT', 'bundle directory is not an ordinary directory');
  const entries = readdirSync(directory);
  for (const entry of entries) {
    if (!BUNDLE_FILES.includes(entry)) deny('UNSAFE_ARTIFACT', `unexpected bundle entry ${entry}`);
    const child = lstatSync(join(directory, entry));
    if (!child.isFile() || child.isSymbolicLink()) deny('UNSAFE_ARTIFACT', `bundle entry ${entry} is not an ordinary file`);
  }
}

function manifestSummary(manifest, digest) {
  return [
    '# Nelyon production release plan',
    '',
    `- Release: ${manifest.identity.release_id}`,
    `- Mode: ${manifest.identity.mode}`,
    `- SHA: ${manifest.identity.approved_sha}`,
    `- Manifest SHA-256: ${digest}`,
    `- Risk: ${manifest.risk.level}`,
    `- Productive changes: ${manifest.delta.productive_change_count}`,
    `- Result: ${manifest.result}`,
    '',
  ].join('\n');
}

export function writeManifestBundle({ manifest, outputDirectory }) {
  if (manifest?.resources?.web_control_centers_b2_transition || isB2Delta(manifest?.delta?.files)) {
    manifest = projectB2Manifest(manifest);
  }
  assertSafeBundleDirectory(outputDirectory);
  const manifestBytes = canonicalJson(manifest);
  const digest = sha256Hex(Buffer.from(manifestBytes, 'utf8'));
  writeFileSync(join(outputDirectory, 'manifest.json'), manifestBytes, { encoding: 'utf8', flag: 'w' });
  writeFileSync(join(outputDirectory, 'manifest.sha256'), `${digest}\n`, { encoding: 'utf8', flag: 'w' });
  writeFileSync(join(outputDirectory, 'summary.md'), manifestSummary(manifest, digest), { encoding: 'utf8', flag: 'w' });
  return {
    digest,
    provenance: {
      approvedSha: manifest.identity.approved_sha,
      compilerSha256: manifest.compiler.sha256,
      environmentName: 'production',
      manifestDigest: digest,
      releaseId: manifest.identity.release_id,
      runAttempt: manifest.identity.run_attempt,
      runId: manifest.identity.run_id,
    },
  };
}

function verifyArtifactEntries(entries) {
  if (!Array.isArray(entries)) return;
  const seen = new Set();
  for (const entry of entries) {
    const path = entry?.path;
    if (typeof path !== 'string' || path.includes('\\') || path.includes('/')
      || path === '.' || path === '..' || /^[A-Za-z]:/.test(path) || isAbsolute(path)
      || !BUNDLE_FILES.includes(path) || entry.type !== 'file' || seen.has(path)) {
      deny('UNSAFE_ARTIFACT', 'artifact archive contains an unsafe, duplicate, or unexpected entry', { entry });
    }
    seen.add(path);
  }
  if (seen.size !== BUNDLE_FILES.length || BUNDLE_FILES.some(path => !seen.has(path))) {
    deny('UNSAFE_ARTIFACT', 'artifact archive does not contain exactly the expected files');
  }
}

export function verifyManifestBundle({ directory, expected }) {
  assertSafeBundleDirectory(directory);
  verifyArtifactEntries(expected?.artifactEntries);
  const actualEntries = readdirSync(directory).sort();
  if (canonicalJson(actualEntries) !== canonicalJson([...BUNDLE_FILES].sort())) {
    deny('UNSAFE_ARTIFACT', 'manifest bundle contains unexpected filesystem entries');
  }
  for (const entry of actualEntries) {
    const stat = lstatSync(join(directory, entry));
    if (!stat.isFile() || stat.isSymbolicLink()) deny('UNSAFE_ARTIFACT', `bundle entry ${entry} is not an ordinary file`);
  }
  const manifestBytes = readFileSync(join(directory, 'manifest.json'), 'utf8');
  const claimedDigest = readFileSync(join(directory, 'manifest.sha256'), 'utf8').trim();
  const actualDigest = sha256Hex(Buffer.from(manifestBytes, 'utf8'));
  if (!/^[0-9a-f]{64}$/.test(claimedDigest) || claimedDigest !== actualDigest) {
    deny('MANIFEST_DIGEST_MISMATCH', 'manifest digest does not match exact bytes');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes);
  } catch {
    deny('MANIFEST_DIGEST_MISMATCH', 'manifest is not valid JSON');
  }
  if (canonicalJson(manifest) !== manifestBytes) {
    deny('MANIFEST_DIGEST_MISMATCH', 'manifest bytes are not canonical');
  }
  const actualProvenance = {
    approvedSha: manifest.identity?.approved_sha,
    compilerSha256: manifest.compiler?.sha256,
    environmentName: 'production',
    manifestDigest: actualDigest,
    releaseId: manifest.identity?.release_id,
    runAttempt: manifest.identity?.run_attempt,
    runId: manifest.identity?.run_id,
  };
  for (const key of ['approvedSha', 'compilerSha256', 'environmentName', 'manifestDigest', 'releaseId', 'runAttempt', 'runId']) {
    if (expected?.[key] !== actualProvenance[key]) {
      deny('ARTIFACT_PROVENANCE_MISMATCH', `artifact ${key} does not match the current release attempt`);
    }
  }
  return { digest: actualDigest, manifest, provenance: actualProvenance };
}

const RECOVERY_RELEASE_FILES = ['auto-deploy-evidence.json', 'bundle', 'remote-evidence.json', 'request.json'];
const RECOVERY_GATE_FILES = [
  'protected-stage-proofs.json',
  'gate-proof.json',
  'migration-dry-run.json',
  'postcheck-result.json',
  'pre-function-revalidation.json',
  'pre-migration-revalidation.json',
  'pre-snapshot-verification.json',
  'revalidation.json',
  'release-observation.json',
];
const ADMIN_RECOVERY_FILES = [
  'admin-web-manifest.json',
  'admin-web-manifest.sha256',
  'admin-web-build.json',
  'admin-web-previous.json',
  'admin-web-before-routes.json',
  'admin-web-preview-before.json',
  'admin-web-preview-enabled.json',
  'admin-web-preview-closed.json',
  'admin-web-candidate.json',
  'admin-web-preview-http.json',
  'admin-web-promoted-version.json',
  'admin-web-after-routes.json',
  'admin-web-production-http.json',
  'admin-web-release-result.json',
  'admin-web-recovered-routes.json',
  'admin-web-recovered-deployment.json',
  'admin-web-recovery.json',
];
const POSTCHECK_RECOVERY_FILES = [
  'postcheck-recovery-result.json',
  'production-recovery.json',
  'verified-source.json',
];

function assertSafeRecoveryDirectory(directory, allowed, required, code = 'UNSAFE_RECOVERY_ARTIFACT') {
  if (typeof directory !== 'string' || !isAbsolute(directory) || !existsSync(directory)) {
    deny(code, 'recovery artifact directory must be an existing absolute path');
  }
  const root = lstatSync(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) deny(code, 'recovery artifact root is unsafe');
  const entries = readdirSync(directory).sort();
  if (entries.some(entry => !allowed.includes(entry)) || required.some(entry => !entries.includes(entry))) {
    deny(code, 'recovery artifact entries are incomplete or unexpected');
  }
  for (const entry of entries) {
    const stat = lstatSync(join(directory, entry));
    const expectedDirectory = entry === 'bundle';
    if (stat.isSymbolicLink() || (expectedDirectory ? !stat.isDirectory() : !stat.isFile())) {
      deny(code, `recovery artifact entry ${entry} has an unsafe type`);
    }
  }
  return true;
}

function readFixedJson(directory, name, code) {
  const path = join(directory, name);
  let body;
  try {
    body = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    deny(code, `${name} is missing or is not valid JSON`);
  }
  return body;
}

function expectedRecoverySourceSteps(source) {
  return {
    pre_snapshot: 'success',
    pre_verification: 'success',
    migration_dry_run: 'success',
    migrations: 'success',
    functions: 'success',
    post_snapshot: source.post_snapshot_status,
    postcheck: source.postcheck_status,
  };
}

const b2VerifiedSources = new WeakMap();
const b2VerifiedSourceRuns = new WeakMap();
const b2VerifiedSourceOutputs = new WeakMap();

function b2SourceState(verifiedSource) {
  const state = b2VerifiedSources.get(verifiedSource);
  if (!state || b2VerifiedSourceOutputs.get(verifiedSource) !== canonicalJson(verifiedSource)) b2RecoveryReject();
  return state;
}

export function validateProtectedB2RecoveryRequest({ request, policy, policyBytes, verifiedSource, authorityContext }) {
  try {
    validateRequestStructure(request, policy);
    const state = b2SourceState(verifiedSource);
    if (request.mode !== 'postcheck_recovery' || !Array.isArray(request.productiveResources)
      || request.productiveResources.length !== 0 || !state.provenance.authorizationSha256
      || !Buffer.isBuffer(policyBytes) || types.isProxy(policyBytes)
      || sha256Hex(policyBytes) !== state.provenance.policySha256
      || canonicalJson(JSON.parse(policyBytes.toString('utf8'))) !== canonicalJson(policy)
      || String(request.recoverySourceRunId) !== state.publicSource.source_run_id
      || b2HistoricalContexts.get(authorityContext) !== state) b2RecoveryReject();
    assertAuthorityReceiptMatch(publicAuthorityReceipt(authorityContext), state.proofs[0].receipt);
    return Object.freeze({ schemaVersion: 1, result: 'PROTECTED_B2_RECOVERY_AUTHENTICATED' });
  } catch { b2RecoveryReject(); }
}

export function verifyPendingB2RecoveryAuthority({ request, policy, policyBytes, manifest, verifiedSource, authorityContext }) {
  try {
    validateProtectedB2RecoveryRequest({ request, policy, policyBytes, verifiedSource, authorityContext });
    const expectedBlocker = { severity: 'BLOCKING', code: 'PRIVATE_B2_AUTHORITY_PENDING', path: null,
      resource: 'recovery', message: 'separate protected exact-attempt authorization is required' };
    if (manifest?.result !== 'DENY' || canonicalJson(manifest.blockers) !== canonicalJson([expectedBlocker])
      || manifest.identity?.mode !== 'postcheck_recovery' || manifest.identity.approved_sha !== request.approvedSha
      || String(manifest.identity.run_id) !== String(request.runId) || manifest.identity.run_attempt !== request.runAttempt
      || manifest.identity.release_id !== request.releaseId || manifest.delta?.productive_change_count !== 0
      || canonicalJson(manifest.resources) !== canonicalJson({ config_changed: false, function_contracts: [], functions: [], migrations: [] })
      || canonicalJson(manifest.recovery) !== canonicalJson({ kind: 'postcheck_only', source_run_id: String(request.recoverySourceRunId) })) {
      b2RecoveryReject();
    }
    return publicAuthorityReceipt(authorityContext);
  } catch { b2RecoveryReject(); }
}

function assertB2SourceArtifacts(verifiedSource, { run, artifacts, source } = {}) {
  const state = b2SourceState(verifiedSource);
  const original = state.provenance;
  if (run && (String(run.id) !== original.runId || run.run_attempt !== original.runAttempt
    || run.head_sha !== original.approvedSha || run.path !== original.workflow || run.repository?.full_name !== original.repository)) b2RecoveryReject();
  for (const kind of ['release', 'gate']) {
    const candidate = source ? source[`${kind}_artifact`] : artifacts?.[kind];
    if (!candidate || canonicalJson({ id: String(candidate.id), name: candidate.name, digest: candidate.digest })
      !== canonicalJson(original.artifacts[kind])) b2RecoveryReject();
  }
  return state;
}

// Recovery retains a closed public projection, never an artifact object graph.
// Optional public compiler fields support historical manifests; descriptor
// authentication remains mandatory when resolving their private authority.
const B2_RECOVERY_CONTRACT_SCHEMA = {
  id: b2String, to_phase: b2String, baseline_sha: b2String, reviewed_source_sha: b2String, integration_base_sha: b2String,
  'state?': b2String, 'release_ready?': b2Boolean, 'from_phase?': b2String, 'approved_sha_ancestry?': b2String,
  'productive_changes?': [{ path: b2String, status: b2String, blob: b2String, sha256: b2String, byte_length: b2Integer }],
  'functions?': [{ name: b2String, verify_jwt: b2Boolean, source_sha256: b2String, config_sha256: b2String }],
  'function_inventory?': { before: b2Integer, after: b2Integer },
  'managed_scope_transition?': { add: [b2String], remove: [b2String] }, 'cron_activation?': b2Boolean,
  'finance_invariants?': { platform_fee_bps: b2Integer, purchase_enabled: b2Boolean, refunds_enabled: b2Boolean,
    subscription_enabled: b2Boolean, require_no_movement: b2Boolean },
  'private_authority_max_bytes?': b2Integer, 'requires_separate_baseline_promotion?': b2Boolean,
};
const b2StepStatus = value => { if (!['success', 'failure', 'skipped', 'cancelled'].includes(value)) b2RecoveryReject(); return value; };
const B2_RECOVERY_REQUEST_SCHEMA = { approvedSha: b2String, mainSha: b2String, runId: b2String, runAttempt: b2Integer,
  releaseId: b2String, repository: b2String, mode: b2String, 'actor?': b2String, 'triggeringActor?': b2String,
  'workflowRef?': b2String, 'ref?': b2String, 'scopeConfirmation?': b2String, 'recoverySourceRunId?': b2NullableString,
  'productiveResources?': [b2String] };
const B2_RECOVERY_OBSERVATION_SCHEMA = { schema_version: b2Integer, result: b2String,
  steps: Object.fromEntries(['pre_snapshot', 'pre_verification', 'migration_dry_run', 'migrations', 'functions', 'post_snapshot', 'postcheck'].map(key => [key, b2StepStatus])),
  pre_evidence_sha256: b2NullableString, post_evidence_sha256: b2NullableString, 'postcheck_file_sha256?': b2NullableString,
  'admin_web?': { required: b2Boolean,
    ...Object.fromEntries(['build', 'upload', 'candidate', 'promote', 'routes', 'finalize', 'recovery',
      'temporary_urls_prestate', 'temporary_urls_enable', 'temporary_urls_cleanup'].map(key => [`${key}?`, b2StepStatus])),
    ...Object.fromEntries(['result_sha256', 'recovery_sha256', 'temporary_urls_prestate_sha256', 'temporary_urls_enable_sha256',
      'temporary_urls_cleanup_sha256'].map(key => [`${key}?`, b2NullableString])) } };

function projectB2RecoverySourceParts({ manifest, request, observation }) {
  try {
    const projected = {
      manifest: b2Projection(manifest, {
        'schema_version?': b2Integer, 'generated_at?': b2String,
        identity: { approved_sha: b2String, run_id: b2String, run_attempt: b2Integer, release_id: b2String, mode: b2String,
          'actor?': b2String, 'triggering_actor?': b2String, 'repository?': b2String, 'workflow_ref?': b2String,
          'ref?': b2String, 'scope_confirmation?': b2String },
        baseline: { sha: b2String, 'state?': b2String, 'origin_main_sha?': b2String },
        compiler: { 'path?': b2String, 'sha256?': b2String, snapshot_adapter_path: b2String, snapshot_adapter_sha256: b2String },
        runtime_closure: b2RuntimeClosure,
        resources: { functions: [b2String], migrations: [B2_MIGRATION_SCHEMA], 'function_contracts?': [B2_CONTRACT_SCHEMA],
          'config_changed?': b2Boolean, web_control_centers_b2_transition: { contract: B2_RECOVERY_CONTRACT_SCHEMA,
            descriptorSha256: b2String, publicContractSha256: b2String, expectedPrivateAuthoritySha256: b2String, privateAuthorityRequired: b2Boolean } },
        'delta?': { files: [{ file_type: b2NullableString, path: b2String, status: b2String }], productive_change_count: b2Integer },
        'risk?': B2_RISK_SCHEMA, 'blockers?': [b2Finding], 'result?': b2String,
      }),
      request: b2Projection(request, B2_RECOVERY_REQUEST_SCHEMA), observation: b2Projection(observation, B2_RECOVERY_OBSERVATION_SCHEMA),
    };
    b2AssertCompilerClosure(projected.manifest.compiler, projected.manifest.runtime_closure);
    return projected;
  } catch { b2RecoveryReject(); }
}

function projectB2RecoveryChain(value, authorityContext, verifiedB2Source) {
  try {
    if (b2VerifiedSources.get(value) !== b2VerifiedSources.get(verifiedB2Source)
      || !b2VerifiedSources.has(value) || b2VerifiedSourceOutputs.get(value) !== canonicalJson(value)) b2RecoveryReject();
    const artifact = { id: b2String, name: b2String, digest: b2String };
    const receipt = publicAuthorityReceipt(authorityContext);
    const projected = b2Projection(value, {
      schema_version: b2Integer, result: b2String, recovery_run_id: b2String, recovery_run_attempt: b2Integer,
      recovery_release_id: b2String, current_sha: b2String, source_run_id: b2String, source_run_attempt: b2Integer,
      source_release_id: b2String, source_sha: b2String, source_manifest_sha256: b2String, source_observation_sha256: b2String,
      source_artifact_digests: { gate: b2String, release: b2String }, recovery_artifacts: { release: artifact, gate: artifact, recovery: artifact },
      recovered_evidence_sha256: b2String, recovered_result_sha256: b2String,
      authorityReceipt: candidate => { assertAuthorityReceiptMatch(receipt, candidate); return receipt; },
    });
    return projected;
  } catch { b2RecoveryReject(); }
}
const b2HistoricalContexts = new WeakMap();
function b2RecoveryReject() {
  const error = new Error('B2 recovery authority rejected');
  error.code = 'B2_RECOVERY_AUTHORITY_INVALID';
  error.stack = 'Error: B2 recovery authority rejected';
  throw Object.freeze(error);
}
function b2ProofTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) b2RecoveryReject();
  return Date.parse(value);
}
function verifyB2SourceProof({ source, run, manifest, observation, gateDirectory, trustedProvenance }) {
  try {
    const candidateBytes = readFileSync(join(gateDirectory, 'protected-stage-proofs.json'));
    const expectedBytes = trustedProvenance.proofBytes;
    if (!Buffer.isBuffer(expectedBytes) || !candidateBytes.equals(expectedBytes)
      || trustedProvenance.expectedProofSha256 !== source.protected_stage_proof_sha256
      || sha256Hex(candidateBytes) !== trustedProvenance.expectedProofSha256) b2RecoveryReject();
    const text = candidateBytes.toString('utf8');
    const proofs = JSON.parse(text);
    if (canonicalJson(proofs) !== text || canonicalJson(proofs) !== canonicalJson(trustedProvenance.proofs)
      || !Array.isArray(proofs) || proofs.length < 2 || proofs.length > 5) b2RecoveryReject();
    const protectedSteps = trustedProvenance.protectedSteps;
    b2Exact(protectedSteps, ['runId', 'runAttempt', 'repository', 'workflow', 'approvedSha', 'steps']);
    if (protectedSteps.runId !== source.run_id || protectedSteps.runAttempt !== source.run_attempt
      || protectedSteps.repository !== source.repository || protectedSteps.workflow !== run.path
      || protectedSteps.approvedSha !== source.source_sha || !Array.isArray(protectedSteps.steps)) b2RecoveryReject();
    const stages = ['migrations', 'functions'];
    let prefixEnded = false;
    for (const [observed, stage] of [['upload', 'admin_upload'], ['promote', 'admin_promote'], ['routes', 'admin_route']]) {
      if (observation.admin_web?.[observed] === 'success') {
        if (prefixEnded || observation.admin_web.required !== true) b2RecoveryReject();
        stages.push(stage);
      } else prefixEnded = true;
    }
    if (observation.admin_web?.candidate === 'success' && observation.admin_web?.upload !== 'success') b2RecoveryReject();
    const protectedNames = protectedSteps.steps.filter(step => typeof step?.name === 'string' && step.name.startsWith('B2 protected ')).map(step => step.name);
    if (proofs.length !== stages.length || canonicalJson(protectedNames) !== canonicalJson(stages.map(stage => `B2 protected ${stage}`))) b2RecoveryReject();
    const intervals = [];
    for (let index = 0; index < stages.length; index++) {
      const proof = proofs[index];
      b2Exact(proof, ['runId', 'runAttempt', 'releaseId', 'approvedSha', 'manifestSha256', 'stage', 'verifiedAt', 'receipt']);
      if (proof.runId !== source.run_id || proof.runAttempt !== source.run_attempt
        || proof.releaseId !== source.release_id || proof.approvedSha !== source.source_sha
        || proof.manifestSha256 !== source.manifest_sha256 || proof.stage !== stages[index]) b2RecoveryReject();
      assertAuthorityReceiptMatch(proofs[0].receipt, proof.receipt);
      const binding = manifest.resources.web_control_centers_b2_transition;
      if (proof.receipt.descriptorSha256 !== binding.descriptorSha256
        || proof.receipt.privateAuthoritySha256 !== binding.expectedPrivateAuthoritySha256
        || proof.receipt.publicContractSha256 !== binding.publicContractSha256) b2RecoveryReject();
      const matches = protectedSteps.steps.filter(step => step?.name === `B2 protected ${proof.stage}`);
      if (matches.length !== 1) b2RecoveryReject();
      const step = matches[0];
      b2Exact(step, ['name', 'conclusion', 'startedAt', 'completedAt']);
      if (step.conclusion !== 'success' || b2ProofTime(step.startedAt) > b2ProofTime(proof.verifiedAt)
        || b2ProofTime(proof.verifiedAt) > b2ProofTime(step.completedAt)) b2RecoveryReject();
      intervals.push({ startedAt: step.startedAt, completedAt: step.completedAt });
    }
    return { proofs, intervals };
  } catch { b2RecoveryReject(); }
}

/** Source must be the in-memory output of exact run/artifact/proof verification.
 * The provider comes from the protected caller, never an artifact or locator. */
export async function resolveB2HistoricalAuthority({ verifiedSource, descriptorBytes, provider, historicalRuntimeClosure }) {
  try {
    const verified = b2SourceState(verifiedSource);
    const historical = readTrustedB2HistoricalRuntimeClosure(historicalRuntimeClosure, verified.recoveryProvenance);
    if (historical.sourceSha !== verified.provenance.approvedSha
      || canonicalJson(historical.closure) !== canonicalJson(verified.manifest.runtime_closure)) b2RecoveryReject();
    const binding = verified.manifest.resources.web_control_centers_b2_transition;
    const bytes = await provider.getBySha256(binding.expectedPrivateAuthoritySha256);
    const c = binding.contract;
    const authorityContext = createReleaseAuthorityContext({ descriptorBytes,
      expectedDescriptorSha256: binding.descriptorSha256, phase: c.to_phase,
      transitionId: c.id, baselineSha: c.baseline_sha, reviewedSourceSha: c.reviewed_source_sha,
      integrationBaseSha: c.integration_base_sha, requestedAt: verified.proofs[0].verifiedAt,
      authorityJson: Buffer.from(bytes).toString('utf8'), expectedPrivateAuthoritySha256: binding.expectedPrivateAuthoritySha256 });
    const receipt = publicAuthorityReceipt(authorityContext);
    const { backup, approval } = authorityContext.privateAuthority;
    for (let index = 0; index < verified.proofs.length; index++) {
      assertAuthorityReceiptMatch(receipt, verified.proofs[index].receipt);
      const interval = verified.intervals[index];
      if (b2ProofTime(interval.startedAt) < b2ProofTime(approval.approvedAt)
        || b2ProofTime(interval.startedAt) < b2ProofTime(backup.completedObservedAt)
        || b2ProofTime(interval.completedAt) >= b2ProofTime(approval.expiresAt)
        || b2ProofTime(interval.completedAt) >= b2ProofTime(backup.expiresAt)) b2RecoveryReject();
    }
    b2HistoricalContexts.set(authorityContext, verified);
    return authorityContext;
  } catch { b2RecoveryReject(); }
}

function verifyB2CurrentGate({ request, manifest, currentGate, authorityContext, policy, requestedAt }) {
  assertB2CatalogSecurityCoverage(authorityContext);
  const receipt = publicAuthorityReceipt(authorityContext);
  b2ProofTime(requestedAt);
  const identity = manifest?.identity;
  if (!identity || identity.run_id !== String(request?.runId) || identity.run_attempt !== request?.runAttempt
    || !/^[1-9][0-9]*$/.test(identity.run_id) || !Number.isSafeInteger(identity.run_attempt) || identity.run_attempt < 1
    || !/^nelyon-[0-9]{8}-[0-9]{3}$/.test(identity.release_id) || !/^[0-9a-f]{40}$/.test(identity.approved_sha)
    || identity.release_id !== request?.releaseId || identity.approved_sha !== request?.approvedSha
    || currentGate?.result !== 'GATE_VERIFIED' || String(currentGate.run_id) !== identity.run_id
    || currentGate.run_attempt !== identity.run_attempt || currentGate.release_id !== identity.release_id
    || currentGate.approved_sha !== identity.approved_sha || currentGate.manifest_sha256 !== sha256Hex(canonicalJson(manifest))
    || currentGate.environment?.name !== 'production' || currentGate.environment?.id !== policy.environment?.id) b2RecoveryReject();
  assertAuthorityReceiptMatch(receipt, currentGate.authorityReceipt);
  return receipt;
}

function verifyB2CurrentBackup(options, bindApproved) {
  const approved = options.authorityContext.privateAuthority.backup;
  const project = options.policy?.supabase?.project_ref;
  if (project !== 'aewwdlvbwpczqyvkwvvj' || approved.projectRefSha256 !== sha256Hex(project)) b2RecoveryReject();
  const observed = selectRecentCompletedBackup({ backups: [options.backup] }, options.requestedAt, options.policy.supabase.backup);
  const age = b2ProofTime(options.requestedAt) - b2ProofTime(observed.inserted_at);
  if (age < 0 || age >= 86_400_000) b2RecoveryReject();
  if (bindApproved && (observed.inserted_at !== approved.insertedAt
    || sha256Hex(canonicalJson(observed)) !== approved.evidenceSha256)) b2RecoveryReject();
}

function verifyB2CurrentOperation(options) {
  const receipt = verifyB2CurrentGate(options);
  verifyB2CurrentBackup(options, !['postcheck_recovery', 'admin_recovery'].includes(options.request?.mode));
  return receipt;
}

/** Revalidate an ordinary B2 release mutation at the protected caller's current
 * clock, without writing a second stage proof. Never accepts recovery modes. */
export function verifyB2ProtectedReleaseMutation(options) {
  try {
    if (options?.request?.mode !== 'release') b2RecoveryReject();
    const receipt = verifyB2CurrentOperation(options);
    const binding = options.manifest.resources?.web_control_centers_b2_transition;
    if (!binding || canonicalJson(binding.contract) !== canonicalJson(options.authorityContext.descriptor.contract)
      || binding.descriptorSha256 !== receipt.descriptorSha256
      || binding.expectedPrivateAuthoritySha256 !== receipt.privateAuthoritySha256) b2RecoveryReject();
    const { approval, backup } = options.authorityContext.privateAuthority;
    const at = b2ProofTime(options.requestedAt);
    if (at < b2ProofTime(approval.approvedAt) || at < b2ProofTime(backup.completedObservedAt)
      || at >= b2ProofTime(approval.expiresAt) || at >= b2ProofTime(backup.expiresAt)) b2RecoveryReject();
    return receipt;
  } catch { b2RecoveryReject(); }
}
/** Identity-only preflight; never authorizes a mutation or completed recovery. */
export function verifyB2RecoveryPreflight({ recoveryRequest, recoveryManifest, verifiedSource, authorityContext,
  currentGate, policy, requestedAt = new Date().toISOString() }) {
  try {
    const source = b2SourceState(verifiedSource);
    if (!source || b2HistoricalContexts.get(authorityContext) !== source
      || !b2VerifiedSourceRuns.get(verifiedSource)?.includes(String(recoveryRequest?.recoverySourceRunId))
      || !['postcheck_recovery', 'admin_recovery'].includes(recoveryRequest?.mode)
      || canonicalJson(recoveryManifest?.resources) !== canonicalJson({ config_changed: false,
        function_contracts: [], functions: [], migrations: [] })) b2RecoveryReject();
    const receipt = verifyB2CurrentGate({ request: recoveryRequest, manifest: recoveryManifest,
      currentGate, authorityContext, policy, requestedAt });
    assertAuthorityReceiptMatch(receipt, source.proofs[0].receipt);
    return { authorityReceipt: receipt };
  } catch { b2RecoveryReject(); }
}

export function verifyB2RecoveryOperation(options) {
  try {
    const requestedAt = options.requestedAt ?? new Date().toISOString();
    const result = verifyB2RecoveryPreflight({ ...options, requestedAt });
    // A historical authority binds the original observation. Recovery separately
    // observes a fresh backup in the same project; it must not reuse its old TTL.
    verifyB2CurrentBackup({ ...options, requestedAt }, false);
    return result;
  } catch { b2RecoveryReject(); }
}

export function b2HistoricalSnapshotBinding({ verifiedSource, authorityContext }) {
  try {
    const source = b2SourceState(verifiedSource);
    if (!source || b2HistoricalContexts.get(authorityContext) !== source) b2RecoveryReject();
    assertAuthorityReceiptMatch(publicAuthorityReceipt(authorityContext), source.proofs[0].receipt);
    return { manifest: JSON.parse(canonicalJson(source.manifest)), requestedAt: source.proofs[0].verifiedAt };
  } catch { b2RecoveryReject(); }
}

function b2ProofRoot(root, proofPath) {
  if (typeof root !== 'string' || typeof proofPath !== 'string' || !isAbsolute(root) || !isAbsolute(proofPath)
    || root !== resolve(root) || proofPath !== join(root, 'protected-stage-proofs.json')) b2RecoveryReject();
  for (let current = root; ; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || relative(current, realpathSync(current)) !== '') b2RecoveryReject();
    if (dirname(current) === current) break;
  }
  return lstatSync(root);
}

function b2SameFile(a, b) {
  return Boolean(a && b && a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs);
}

// The protected runner must own this ordinary directory and exclude other writers.
// The lock serializes cooperating processes; no candidate path is accepted. Node
// lacks openat/renameat directory handles, so hostile replacement of a trusted
// directory by another privileged process is outside this runner-root contract.
async function persistB2MutationProof({ trustedProofRoot, proofPath, request, currentGate, requestedAt, stage, receipt, mutate }) {
  const rootStat = b2ProofRoot(trustedProofRoot, proofPath);
  const lockPath = join(trustedProofRoot, '.protected-stage-proofs.lock');
  const tempPath = join(trustedProofRoot, `.protected-stage-proofs.${randomUUID()}.tmp`);
  let lockFd, tempFd, lockStat, tempStat;
  const assertRoot = () => { if (!b2SameFile(rootStat, b2ProofRoot(trustedProofRoot, proofPath))) b2RecoveryReject(); };
  const ordinary = stat => stat && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
  try {
    lockFd = openSync(lockPath, 'wx', 0o600); lockStat = fstatSync(lockFd);
    assertRoot();
    const priorStat = lstatSync(proofPath, { throwIfNoEntry: false });
    let priorBytes = null, proofs = [];
    if (priorStat) {
      if (!ordinary(priorStat) || priorStat.size > 65536) b2RecoveryReject();
      const fd = openSync(proofPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      try {
        if (!b2SameFile(priorStat, fstatSync(fd))) b2RecoveryReject();
        priorBytes = readFileSync(fd);
      } finally { closeSync(fd); }
      proofs = JSON.parse(priorBytes.toString('utf8'));
      if (!Array.isArray(proofs) || canonicalJson(proofs) !== priorBytes.toString('utf8')) b2RecoveryReject();
    }
    const order = request.mode === 'admin_recovery' ? ['admin_upload', 'admin_promote', 'admin_route']
      : ['migrations', 'functions', 'admin_upload', 'admin_promote', 'admin_route'];
    if (proofs.length >= order.length || stage !== order[proofs.length]) b2RecoveryReject();
    let previousAt = 0;
    for (let index = 0; index < proofs.length; index++) {
      const proof = proofs[index];
      b2Exact(proof, ['runId', 'runAttempt', 'releaseId', 'approvedSha', 'manifestSha256', 'stage', 'verifiedAt', 'receipt']);
      if (proof.stage !== order[index] || proof.runId !== String(request.runId) || proof.runAttempt !== request.runAttempt
        || proof.releaseId !== request.releaseId || proof.approvedSha !== request.approvedSha
        || proof.manifestSha256 !== currentGate.manifest_sha256 || b2ProofTime(proof.verifiedAt) < previousAt
        || b2ProofTime(proof.verifiedAt) > b2ProofTime(requestedAt)) b2RecoveryReject();
      previousAt = b2ProofTime(proof.verifiedAt);
      assertAuthorityReceiptMatch(receipt, proof.receipt);
    }
    proofs.push({ runId: String(request.runId), runAttempt: request.runAttempt, releaseId: request.releaseId,
      approvedSha: request.approvedSha, manifestSha256: currentGate.manifest_sha256, stage, verifiedAt: requestedAt, receipt });
    const bytes = Buffer.from(canonicalJson(proofs));
    tempFd = openSync(tempPath, 'wx', 0o600); tempStat = fstatSync(tempFd);
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(tempFd, bytes, written, bytes.length - written);
      if (!Number.isSafeInteger(count) || count <= 0) b2RecoveryReject();
      written += count;
    }
    fsyncSync(tempFd); closeSync(tempFd); tempFd = undefined;
    assertRoot();
    if (!b2SameFile(tempStat, lstatSync(tempPath)) || !b2SameFile(lockStat, lstatSync(lockPath))) b2RecoveryReject();
    const currentStat = lstatSync(proofPath, { throwIfNoEntry: false });
    if (priorStat ? !ordinary(currentStat) || !b2SameFile(priorStat, currentStat)
      || currentStat.size !== priorStat.size || currentStat.mtimeMs !== priorStat.mtimeMs
      || !readFileSync(proofPath).equals(priorBytes) : currentStat !== undefined) b2RecoveryReject();
    renameSync(tempPath, proofPath); tempStat = undefined;
    // Atomic rename publishes only complete fsynced bytes. POSIX also needs its
    // directory entry synced; Windows does not support opening directories here.
    if (process.platform !== 'win32') { const fd = openSync(trustedProofRoot, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
    assertRoot();
    await mutate();
  } finally {
    if (tempFd !== undefined) closeSync(tempFd);
    if (lockFd !== undefined) closeSync(lockFd);
    if (tempStat && b2SameFile(tempStat, lstatSync(tempPath, { throwIfNoEntry: false }))) unlinkSync(tempPath);
    if (lockStat && b2SameFile(lockStat, lstatSync(lockPath, { throwIfNoEntry: false }))) unlinkSync(lockPath);
  }
}

/** Retain only the closed public migration-attempt proof, including after a
 * failed/indeterminate apply. This is evidence retention, never authorization
 * or an assertion that the operation succeeded. No private provider is read. */
export function retainB2MigrationAttemptProof({trustedProofRoot,destinationDirectory,manifest,request,expectedReceipt}) {
  try {
    const source=join(trustedProofRoot,'protected-stage-proofs.json');
    b2ProofRoot(trustedProofRoot,source);
    const stat=lstatSync(source,{throwIfNoEntry:false});if(!stat)return false;
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536)b2RecoveryReject();
    const fd=openSync(source,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW??0));let bytes;
    try{if(!b2SameFile(stat,fstatSync(fd)))b2RecoveryReject();bytes=readFileSync(fd);}finally{closeSync(fd);}
    const proofs=JSON.parse(bytes.toString('utf8'));
    if(!Array.isArray(proofs)||proofs.length!==1||canonicalJson(proofs)!==bytes.toString('utf8'))b2RecoveryReject();
    assertAuthorityReceiptMatch(expectedReceipt,expectedReceipt);
    const proof=proofs[0],identity=manifest?.identity,binding=manifest?.resources?.web_control_centers_b2_transition;
    b2Exact(proof,['runId','runAttempt','releaseId','approvedSha','manifestSha256','stage','verifiedAt','receipt']);
    if(!identity||!binding||proof.stage!=='migrations'||proof.runId!==String(request?.runId)
      ||proof.runId!==identity.run_id||!/^[1-9][0-9]*$/.test(proof.runId)
      ||proof.runAttempt!==request.runAttempt||proof.runAttempt!==identity.run_attempt||!Number.isSafeInteger(proof.runAttempt)||proof.runAttempt<1
      ||proof.releaseId!==request.releaseId||proof.releaseId!==identity.release_id||!/^nelyon-[0-9]{8}-[0-9]{3}$/.test(proof.releaseId)
      ||proof.approvedSha!==request.approvedSha||proof.approvedSha!==identity.approved_sha||!/^[a-f0-9]{40}$/.test(proof.approvedSha)
      ||proof.manifestSha256!==sha256Hex(canonicalJson(manifest))
      ||proof.receipt.descriptorSha256!==binding.descriptorSha256
      ||proof.receipt.privateAuthoritySha256!==binding.expectedPrivateAuthoritySha256
      ||proof.receipt.publicContractSha256!==binding.publicContractSha256)b2RecoveryReject();
    b2ProofTime(proof.verifiedAt);assertAuthorityReceiptMatch(expectedReceipt,proof.receipt);
    const destination=join(destinationDirectory,'protected-stage-proofs.json');b2ProofRoot(destinationDirectory,destination);
    const existing=lstatSync(destination,{throwIfNoEntry:false});
    if(existing){if(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1||!readFileSync(destination).equals(bytes))b2RecoveryReject();}
    else writeFileSync(destination,canonicalJson(proofs),{encoding:'utf8',flag:'wx',mode:0o600});
    return true;
  }catch{b2RecoveryReject();}
}

/** Protected runtime primitive. The caller owns the clock and mutation callback;
 * no candidate CLI option can reach this API. Persist the closed proof before
 * control reaches the mutation, and never propagate callback diagnostics. */
export async function executeB2ProtectedMutation({ manifest, request, currentGate, authorityContext,
  policy, backup, requestedAt = new Date().toISOString(), stage, proofPath, trustedProofRoot, mutate, verifiedSource }) {
  try {
    const receipt = verifyB2CurrentOperation({ manifest, request, currentGate, authorityContext, policy, backup, requestedAt });
    if (!['migrations', 'functions', 'admin_upload', 'admin_promote', 'admin_route'].includes(stage)
      || typeof mutate !== 'function' || !isAbsolute(proofPath)
      || !proofPath.replaceAll('\\', '/').endsWith('/protected-stage-proofs.json')) b2RecoveryReject();
    if (['postcheck_recovery', 'admin_recovery'].includes(request.mode)) {
      verifyB2RecoveryOperation({ recoveryRequest: request, recoveryManifest: manifest, verifiedSource,
        authorityContext, currentGate, backup, policy, requestedAt });
      if (request.mode === 'postcheck_recovery') b2RecoveryReject();
    } else {
      const binding = manifest.resources?.web_control_centers_b2_transition;
      if (!binding || canonicalJson(binding.contract) !== canonicalJson(authorityContext.descriptor.contract)
        || binding.descriptorSha256 !== receipt.descriptorSha256
        || binding.expectedPrivateAuthoritySha256 !== receipt.privateAuthoritySha256) b2RecoveryReject();
      const { approval, backup: approvedBackup } = authorityContext.privateAuthority;
      const at = b2ProofTime(requestedAt);
      if (at < b2ProofTime(approval.approvedAt) || at < b2ProofTime(approvedBackup.completedObservedAt)
        || at >= b2ProofTime(approval.expiresAt) || at >= b2ProofTime(approvedBackup.expiresAt)) b2RecoveryReject();
    }
    await persistB2MutationProof({ trustedProofRoot, proofPath, request, currentGate, requestedAt, stage, receipt, mutate });
    return { authorityReceipt: receipt };
  } catch { b2RecoveryReject(); }
}

export function verifyRecoveryArtifactProvenance(options) {
  try {
    if (Object.hasOwn(options ?? {}, 'recoveryProvenance')) {
      if (['source', 'run', 'artifacts', 'protectedSteps'].some(key => Object.hasOwn(options, key))) b2RecoveryReject();
      const trusted = readTrustedB2RecoveryProvenance(options.recoveryProvenance);
      return verifyRecoveryArtifactProvenanceInternal({
        source: trusted.source,
        run: {
          id: trusted.run.id,
          run_attempt: trusted.run.runAttempt,
          status: trusted.run.status,
          conclusion: trusted.run.conclusion,
          event: trusted.run.event,
          head_sha: trusted.run.headSha,
          path: trusted.run.path,
          repository: { full_name: trusted.run.repository },
        },
        artifacts: Object.values(trusted.artifacts).map(item => ({ ...item, expired: false })),
        releaseBundle: options.releaseBundle,
        gateEvidence: options.gateEvidence,
        trustedProvenance: trusted,
        recoveryProvenance: options.recoveryProvenance,
      });
    }
    if (options?.source?.protected_stage_proof_sha256 || options?.protectedSteps) b2RecoveryReject();
    return verifyRecoveryArtifactProvenanceInternal(options);
  } catch (error) {
    if (options?.recoveryProvenance || options?.source?.protected_stage_proof_sha256 || options?.protectedSteps) b2RecoveryReject();
    throw error;
  }
}

function assertB2ArchiveFiles(directory, expected, includesBundle = false) {
  if (!expected || typeof expected !== 'object') b2RecoveryReject();
  const names = readdirSync(directory).flatMap(name => name === 'bundle' && includesBundle
    ? readdirSync(join(directory, name)).map(child => `bundle/${child}`) : [name]).sort();
  if (canonicalJson(names) !== canonicalJson(Object.keys(expected).sort())
    || names.some(name => sha256Hex(readFileSync(join(directory, ...name.split('/')))) !== expected[name])) b2RecoveryReject();
}

function verifyRecoveryArtifactProvenanceInternal({ source, run, artifacts, releaseBundle, gateEvidence, trustedProvenance,
  recoveryProvenance = null }) {
  const code = 'RECOVERY_SOURCE_PROVENANCE_MISMATCH';
  if (!source || !run || String(run.id) !== source.run_id || run.run_attempt !== source.run_attempt
    || run.status !== 'completed' || run.conclusion !== 'failure' || run.event !== 'workflow_dispatch'
    || run.head_sha !== source.source_sha || run.path !== '.github/workflows/nelyon-production-release.yml'
    || run.repository?.full_name !== source.repository) {
    deny(code, 'GitHub source run does not match the approved failed release');
  }
  if (!Array.isArray(artifacts)) deny(code, 'source artifact metadata is unavailable');
  const expectedArtifacts = [source.gate_artifact, source.release_artifact];
  for (const expected of expectedArtifacts) {
    const matches = artifacts.filter(item => item?.name === expected?.name);
    if (matches.length !== 1) deny(code, 'approved source artifact is missing or duplicated');
    const actual = matches[0];
    if (String(actual.id) !== expected.id || actual.name !== expected.name
      || actual.digest !== expected.digest || !/^sha256:[0-9a-f]{64}$/.test(actual.digest ?? '')) {
      deny(code, 'source artifact metadata does not match its full approved digest');
    }
  }

  const releaseDirectory = resolve(releaseBundle?.directory ?? '');
  const gateDirectory = resolve(gateEvidence?.directory ?? '');
  assertSafeRecoveryDirectory(releaseDirectory, RECOVERY_RELEASE_FILES, ['bundle', 'remote-evidence.json', 'request.json']);
  assertSafeRecoveryDirectory(gateDirectory, RECOVERY_GATE_FILES, ['release-observation.json']);
  const bundleDirectory = join(releaseDirectory, 'bundle');
  assertSafeRecoveryDirectory(bundleDirectory, BUNDLE_FILES, BUNDLE_FILES);
  if (trustedProvenance?.authorizationSha256) {
    assertB2ArchiveFiles(releaseDirectory, trustedProvenance.releaseFileDigests, true);
    assertB2ArchiveFiles(gateDirectory, trustedProvenance.gateFileDigests);
  }

  const manifestBytes = readFileSync(join(bundleDirectory, 'manifest.json'), 'utf8');
  const actualManifestSha256 = sha256Hex(Buffer.from(manifestBytes, 'utf8'));
  const claimedManifestSha256 = readFileSync(join(bundleDirectory, 'manifest.sha256'), 'utf8').trim();
  if (actualManifestSha256 !== source.manifest_sha256
    || claimedManifestSha256 !== actualManifestSha256
    || !/^[0-9a-f]{64}$/.test(claimedManifestSha256)) {
    deny(code, 'source manifest bytes do not match the approved digest');
  }
  let manifest = readFixedJson(bundleDirectory, 'manifest.json', code);
  if (canonicalJson(manifest) !== manifestBytes) deny(code, 'source manifest is not canonical');
  let sourceRequest = readFixedJson(releaseDirectory, 'request.json', code);
  let observation = readFixedJson(gateDirectory, 'release-observation.json', code);
  if (manifest.resources?.web_control_centers_b2_transition) {
    ({ manifest, request: sourceRequest, observation } = projectB2RecoverySourceParts({ manifest, request: sourceRequest, observation }));
  }
  if (sourceRequest.repository !== source.repository
    || sourceRequest.approvedSha !== source.source_sha
    || sourceRequest.mainSha !== source.source_sha
    || sourceRequest.releaseId !== source.release_id
    || String(sourceRequest.runId) !== source.run_id
    || sourceRequest.runAttempt !== source.run_attempt
    || sourceRequest.mode !== 'release'
    || manifest.identity?.approved_sha !== source.source_sha
    || manifest.identity?.release_id !== source.release_id
    || String(manifest.identity?.run_id) !== source.run_id
    || manifest.identity?.run_attempt !== source.run_attempt
    || manifest.identity?.mode !== 'release') {
    deny(code, 'source request or manifest identity does not match the approved release');
  }
  const expectedMigrationNames = source.expected_migrations.map(item => item.name);
  const actualMigrationNames = (manifest.resources?.migrations ?? []).map(item => item?.path?.replace(/^.*\//, '').replace(/\.sql$/, ''));
  const expectedFunctions = source.edge_functions.map(item => item.name);
  if (canonicalJson(actualMigrationNames) !== canonicalJson(expectedMigrationNames)
    || canonicalJson(manifest.resources?.functions) !== canonicalJson(expectedFunctions)) {
    deny(code, 'source manifest productive resources do not match the approved failed release');
  }
  const expectedSteps = expectedRecoverySourceSteps(source);
  if (observation.schema_version !== 1 || observation.result !== 'INCOMPLETE_OR_FAILED'
    || canonicalJson(observation.steps) !== canonicalJson(expectedSteps)
    || observation.pre_evidence_sha256 !== source.pre_snapshot_evidence_sha256
    || observation.post_evidence_sha256 !== source.post_snapshot_evidence_sha256) {
    deny(code, 'source observation is not a successful mutation followed by failed postcheck');
  }
  if (manifest.resources?.web_control_centers_b2_transition
    && (!trustedProvenance
      || manifest.runtime_closure.closure_sha256 !== trustedProvenance.sourceRuntimeClosureSha256)) b2RecoveryReject();
  const b2Proof = manifest.resources?.web_control_centers_b2_transition
    ? verifyB2SourceProof({ source, run, manifest, observation, gateDirectory, trustedProvenance }) : null;
  const result = {
    source_run_id: source.run_id,
    source_release_id: source.release_id,
    source_sha: source.source_sha,
    manifest_sha256: actualManifestSha256,
    source_artifact_digests: {
      gate: source.gate_artifact.digest,
      release: source.release_artifact.digest,
    },
    source_manifest: manifest,
    source_request: sourceRequest,
    source_observation: observation,
  };
  if (b2Proof) {
    result.authorityReceipt = b2Proof.proofs[0].receipt;
    // Copy before branding: mutation of caller JSON or output cannot replace
    // the manifest, source time, or receipt used for historical resolution.
    const verifiedState = JSON.parse(canonicalJson({ manifest, ...b2Proof, publicSource: result,
      provenance: { runId: source.run_id, runAttempt: source.run_attempt, approvedSha: source.source_sha,
        repository: source.repository, workflow: run.path,
        authorizationSha256: trustedProvenance.authorizationSha256,
        policySha256: trustedProvenance.policySha256,
        adminArtifact: trustedProvenance.adminArtifact,
        adminFileDigests: trustedProvenance.adminFileDigests,
        releaseFileDigests: trustedProvenance.releaseFileDigests,
        gateFileDigests: trustedProvenance.gateFileDigests,
        artifacts: Object.fromEntries(['release', 'gate'].map(kind => {
          const artifact = source[`${kind}_artifact`];
          return [kind, { id: String(artifact.id), name: artifact.name, digest: artifact.digest }];
        })) } }));
    verifiedState.recoveryProvenance = recoveryProvenance;
    b2VerifiedSources.set(result, verifiedState);
    b2VerifiedSourceRuns.set(result, [source.run_id]);
    b2VerifiedSourceOutputs.set(result, canonicalJson(result));
  }
  return result;
}

function requireAdminRecoveryArtifactMetadata({ artifacts, sourceRunId, sourceRunAttempt }) {
  const code = 'ADMIN_RECOVERY_SOURCE_MISMATCH';
  if (!Array.isArray(artifacts)) deny(code, 'source artifact metadata is unavailable');
  const names = {
    release: `nelyon-release-${sourceRunId}-${sourceRunAttempt}`,
    gate: `nelyon-gate-evidence-${sourceRunId}-${sourceRunAttempt}`,
    admin: `nelyon-admin-evidence-${sourceRunId}-${sourceRunAttempt}`,
  };
  const selected = {};
  for (const [kind, name] of Object.entries(names)) {
    const matches = artifacts.filter(item => item?.name === name);
    if (matches.length !== 1) deny(code, `${kind} source artifact is missing or duplicated`);
    const item = matches[0];
    if (!Number.isSafeInteger(Number(item.id)) || Number(item.id) < 1 || item.expired !== false
      || !/^sha256:[0-9a-f]{64}$/.test(item.digest ?? '')) {
      deny(code, `${kind} source artifact metadata is invalid`);
    }
    selected[kind] = { id: String(item.id), name, digest: item.digest };
  }
  return selected;
}

function requireExactRunArtifactMetadata({ artifacts, names, code }) {
  if (!Array.isArray(artifacts)) deny(code, 'source artifact metadata is unavailable');
  const selected = {};
  for (const [kind, name] of Object.entries(names)) {
    const matches = artifacts.filter(item => item?.name === name);
    if (matches.length !== 1) deny(code, `${kind} source artifact is missing or duplicated`);
    const item = matches[0];
    if (!Number.isSafeInteger(Number(item.id)) || Number(item.id) < 1 || item.expired !== false
      || !/^sha256:[0-9a-f]{64}$/.test(item.digest ?? '')) {
      deny(code, `${kind} source artifact metadata is invalid`);
    }
    selected[kind] = { id: String(item.id), name, digest: item.digest };
  }
  return selected;
}

function normalizedRecoveryRoutes(value, code) {
  if (!value || typeof value.zone_id !== 'string' || !Array.isArray(value.routes)) {
    deny(code, 'Admin route recovery evidence is incomplete');
  }
  return value.routes.map(item => {
    if (typeof item?.pattern !== 'string' || !Object.hasOwn(item, 'script')) {
      deny(code, 'Admin route recovery evidence is malformed');
    }
    return { pattern: item.pattern, script: item.script ?? null };
  }).sort((left, right) => `${left.pattern}:${left.script}`.localeCompare(`${right.pattern}:${right.script}`));
}

function verifyAdminPreviewLifecycleEvidence(value, {
  result,
  enabled,
  previewsEnabled,
  code,
}) {
  const keys = ['enabled', 'previews_enabled', 'result', 'schema_version', 'worker_name'];
  if (!value || canonicalJson(Object.keys(value).sort()) !== canonicalJson(keys)
    || value.schema_version !== 1 || value.result !== result
    || value.worker_name !== 'nelyon-admin-web'
    || value.enabled !== enabled || value.previews_enabled !== previewsEnabled) {
    deny(code, 'source Admin temporary URL lifecycle evidence is invalid');
  }
  return true;
}

function adminRecoveryTransitionAuthority({ policy, sourceManifest, expectedSourceSha, code, authorityContext, verifiedB2Source }) {
  if (sourceManifest?.resources?.web_control_centers_b2_transition) {
    try {
      const original = b2HistoricalSnapshotBinding({ verifiedSource: verifiedB2Source, authorityContext });
      if (canonicalJson(original.manifest) !== canonicalJson(sourceManifest)
        || sourceManifest.identity.approved_sha !== expectedSourceSha) b2RecoveryReject();
      projectB2Manifest(sourceManifest);
      const c = authorityContext.descriptor.contract;
      validateB2FunctionContracts(sourceManifest.resources.function_contracts, c.functions);
      const migration = c.productive_changes.at(-1);
      return { key: 'web_control_centers_b2_transition', b2: true,
        transition: { migrations: [{ ...migration, version: migration.path.split('/').at(-1).slice(0, 14) }], contract: c } };
    } catch { b2RecoveryReject(); }
  }
  const supported = [
    'superuser_control_center_transition',
    'superuser_qa_perf_c1_transition',
  ];
  const resources = sourceManifest?.resources;
  const present = supported.filter(key => Object.hasOwn(resources ?? {}, key));
  if (present.length !== 1) {
    deny(code, 'source release must contain exactly one supported Admin transition authority');
  }
  const key = present[0];
  const transition = policy?.[key];
  const expectedAttestation = transition && {
    ...transition,
    approved_sha: expectedSourceSha,
    baseline_descendant_verified: true,
    integration_base_descendant_verified: true,
    reviewed_bytes_verified: true,
  };
  if (!transition || !Array.isArray(transition.migrations) || transition.migrations.length < 1
    || canonicalJson(resources[key]) !== canonicalJson(expectedAttestation)) {
    deny(code, 'source Admin transition authority differs from the reviewed policy');
  }
  return { key, transition };
}

export function verifyAdminRecoverySourceProvenance(options) {
  try { return verifyAdminRecoverySourceProvenanceInternal(options); }
  catch (error) { if (options.authorityContext || options.verifiedB2Source || options.postcheckRecoveryChain?.authorityReceipt) b2RecoveryReject(); throw error; }
}

function verifyAdminRecoverySourceProvenanceInternal({
  policy,
  recoveryRequest,
  recoveryManifest,
  run,
  artifacts,
  releaseBundle,
  gateEvidence,
  adminEvidence,
  postcheckRecoveryChain = null,
  authorityContext, verifiedB2Source,
}) {
  if (postcheckRecoveryChain !== null && (authorityContext || postcheckRecoveryChain?.authorityReceipt)) {
    postcheckRecoveryChain = projectB2RecoveryChain(postcheckRecoveryChain, authorityContext, verifiedB2Source);
  }
  const code = 'ADMIN_RECOVERY_SOURCE_MISMATCH';
  validateRequest(recoveryRequest, policy);
  const declaredRecoveryRunId = String(recoveryRequest.recoverySourceRunId ?? '');
  const chainedRecovery = postcheckRecoveryChain !== null;
  const sourceRunId = chainedRecovery
    ? String(postcheckRecoveryChain?.source_run_id ?? '')
    : declaredRecoveryRunId;
  const sourceRunAttempt = Number(run?.run_attempt);
  const expectedSourceSha = chainedRecovery
    ? postcheckRecoveryChain?.source_sha
    : recoveryRequest.approvedSha;
  if (recoveryRequest.mode !== 'admin_recovery'
    || recoveryRequest.scopeConfirmation !== policy.scope_confirmations?.admin_recovery
    || recoveryManifest?.identity?.mode !== 'admin_recovery'
    || recoveryManifest?.identity?.approved_sha !== recoveryRequest.approvedSha
    || recoveryManifest?.recovery?.kind !== 'admin_cloudflare_forward_completion'
    || recoveryManifest?.recovery?.source_run_id !== declaredRecoveryRunId
    || canonicalJson(recoveryManifest?.resources) !== canonicalJson({
      config_changed: false, function_contracts: [], functions: [], migrations: [],
    })) {
    deny(code, 'recovery request and zero-resource manifest are not exactly bound');
  }
  if (chainedRecovery && (postcheckRecoveryChain?.schema_version !== 1
    || postcheckRecoveryChain?.result !== 'ADMIN_RECOVERY_POSTCHECK_CHAIN_VERIFIED'
    || postcheckRecoveryChain.recovery_run_id !== declaredRecoveryRunId
    || postcheckRecoveryChain.current_sha !== recoveryRequest.approvedSha
    || postcheckRecoveryChain.source_run_attempt !== sourceRunAttempt
    || !/^[0-9a-f]{40}$/.test(expectedSourceSha ?? '')
    || !/^[0-9a-f]{64}$/.test(postcheckRecoveryChain.source_manifest_sha256 ?? '')
    || !/^[0-9a-f]{64}$/.test(postcheckRecoveryChain.source_observation_sha256 ?? '')
    || !/^[0-9a-f]{64}$/.test(postcheckRecoveryChain.recovered_evidence_sha256 ?? '')
    || !/^[0-9a-f]{64}$/.test(postcheckRecoveryChain.recovered_result_sha256 ?? ''))) {
    deny(code, 'postcheck recovery chain is incomplete or does not match the Admin recovery request');
  }
  if (!run || String(run.id) !== sourceRunId || !Number.isSafeInteger(sourceRunAttempt) || sourceRunAttempt < 1
    || run.status !== 'completed' || run.conclusion !== policy.admin_recovery.source_conclusion
    || run.event !== policy.admin_recovery.source_event || run.head_branch !== policy.default_branch
    || run.head_sha !== expectedSourceSha || run.path !== policy.workflow_path
    || run.repository?.full_name !== policy.repository) {
    deny(code, 'source run is not the exact failed main workflow_dispatch release');
  }
  const selectedArtifacts = requireAdminRecoveryArtifactMetadata({ artifacts, sourceRunId, sourceRunAttempt });
  if (authorityContext || verifiedB2Source) {
    const sourceState = assertB2SourceArtifacts(verifiedB2Source, { run, artifacts: selectedArtifacts });
    const original = sourceState.provenance;
    if (original.authorizationSha256 && (!original.adminArtifact
      || canonicalJson({ id: String(selectedArtifacts.admin.id), name: selectedArtifacts.admin.name,
        digest: selectedArtifacts.admin.digest }) !== canonicalJson(original.adminArtifact))) b2RecoveryReject();
  }
  if (chainedRecovery && (selectedArtifacts.release.digest !== postcheckRecoveryChain.source_artifact_digests?.release
    || selectedArtifacts.gate.digest !== postcheckRecoveryChain.source_artifact_digests?.gate)) {
    deny(code, 'original release artifact digests differ from the verified postcheck recovery chain');
  }
  const releaseDirectory = resolve(releaseBundle?.directory ?? '');
  const gateDirectory = resolve(gateEvidence?.directory ?? '');
  const adminDirectory = resolve(adminEvidence?.directory ?? '');
  assertSafeRecoveryDirectory(releaseDirectory, RECOVERY_RELEASE_FILES, ['bundle', 'remote-evidence.json', 'request.json'], code);
  assertSafeRecoveryDirectory(gateDirectory, RECOVERY_GATE_FILES,
    chainedRecovery ? ['release-observation.json'] : ['release-observation.json', 'postcheck-result.json'], code);
  assertSafeRecoveryDirectory(adminDirectory, ADMIN_RECOVERY_FILES,
    ['admin-web-manifest.json', 'admin-web-manifest.sha256'], code);
  const bundleDirectory = join(releaseDirectory, 'bundle');
  assertSafeRecoveryDirectory(bundleDirectory, BUNDLE_FILES, BUNDLE_FILES, code);
  if (verifiedB2Source) {
    const original = b2SourceState(verifiedB2Source).provenance;
    if (original.authorizationSha256) {
      if (!original.adminFileDigests) b2RecoveryReject();
      assertB2ArchiveFiles(adminDirectory, original.adminFileDigests);
      assertB2ArchiveFiles(releaseDirectory, original.releaseFileDigests, true);
      assertB2ArchiveFiles(gateDirectory, original.gateFileDigests);
    }
  }
  const manifestBytes = readFileSync(join(bundleDirectory, 'manifest.json'), 'utf8');
  let sourceManifest = readFixedJson(bundleDirectory, 'manifest.json', code);
  const sourceManifestDigest = sha256Hex(manifestBytes);
  const sourceAdminReleaseManifestDigest = sha256Hex(canonicalJson(sourceManifest).trimEnd());
  if (canonicalJson(sourceManifest) !== manifestBytes
    || readFileSync(join(bundleDirectory, 'manifest.sha256'), 'utf8').trim() !== sourceManifestDigest) {
    deny(code, 'source release manifest bytes or digest are invalid');
  }
  let sourceRequest = readFixedJson(releaseDirectory, 'request.json', code);
  let observation = readFixedJson(gateDirectory, 'release-observation.json', code);
  const postcheckPath = join(gateDirectory, 'postcheck-result.json');
  const sourcePostcheck = chainedRecovery ? null : readFixedJson(gateDirectory, 'postcheck-result.json', code);
  const sourceTransition = adminRecoveryTransitionAuthority({
    policy, sourceManifest, expectedSourceSha, code, authorityContext, verifiedB2Source,
  });
  if (sourceTransition.b2) {
    ({ manifest: sourceManifest, request: sourceRequest, observation } = projectB2RecoverySourceParts({ manifest: sourceManifest, request: sourceRequest, observation }));
    const original = b2SourceState(verifiedB2Source).publicSource;
    if (canonicalJson(sourceManifest) !== canonicalJson(original.source_manifest)
      || canonicalJson(sourceRequest) !== canonicalJson(original.source_request)
      || canonicalJson(observation) !== canonicalJson(original.source_observation)) b2RecoveryReject();
  }
  if (sourceRequest.mode !== policy.admin_recovery.source_mode
    || sourceRequest.actor !== policy.owner || sourceRequest.triggeringActor !== policy.owner
    || sourceRequest.repository !== policy.repository || sourceRequest.ref !== policy.admin_recovery.source_ref
    || sourceRequest.workflowRef !== `${policy.repository}/${policy.workflow_path}@${policy.admin_recovery.source_ref}`
    || sourceRequest.scopeConfirmation !== policy.scope_confirmations.release_high_risk
    || sourceRequest.approvedSha !== expectedSourceSha || sourceRequest.mainSha !== expectedSourceSha
    || String(sourceRequest.runId) !== sourceRunId || sourceRequest.runAttempt !== sourceRunAttempt
    || sourceManifest.identity?.mode !== policy.admin_recovery.source_mode
    || sourceManifest.identity?.approved_sha !== expectedSourceSha
    || sourceManifest.identity?.release_id !== sourceRequest.releaseId
    || sourceManifest.identity?.scope_confirmation !== policy.scope_confirmations.release_high_risk
    || sourceManifest.risk?.level !== 'HIGH' || sourceManifest.result !== 'PLAN READY'
    || sourceManifest.delta?.productive_change_count !== (sourceTransition.b2 ? 5 : sourceTransition.transition.migrations.length)
    || String(sourceManifest.identity?.run_id) !== sourceRunId
    || sourceManifest.identity?.run_attempt !== sourceRunAttempt
    || canonicalJson(sourceManifest.resources?.migrations?.map(item => ({
      version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
    })).sort((a, b) => a.version.localeCompare(b.version)))
      !== canonicalJson(sourceTransition.transition.migrations.map(item => ({
        version: item.version, path: item.path, blob: item.blob, sha256: item.sha256,
      })).sort((a, b) => a.version.localeCompare(b.version)))
    || canonicalJson(sourceManifest.resources?.functions) !== canonicalJson(sourceTransition.b2
      ? sourceTransition.transition.contract.functions.map(item => item.name) : [])
    || (!sourceTransition.b2 && canonicalJson(sourceManifest.resources?.function_contracts) !== canonicalJson([]))
    || sourceManifest.resources?.config_changed !== Boolean(sourceTransition.b2)
    || (!sourceTransition.b2 && canonicalJson(sourceManifest.resources?.[sourceTransition.key] ?? null)
      !== canonicalJson({
        ...sourceTransition.transition,
        approved_sha: expectedSourceSha,
        baseline_descendant_verified: true,
        integration_base_descendant_verified: true,
        reviewed_bytes_verified: true,
      }))) {
    deny(code, 'source request or manifest is not the exact supported Admin release');
  }
  const expectedPostcheckKeys = [
    'applied_migrations', 'changed_functions', 'function_attestations', 'post_evidence_sha256',
    'pre_evidence_sha256', 'result',
  ];
  const expectedMigrationVersions = sourceTransition.transition.migrations
    .map(item => item.version).sort();
  if (observation.schema_version !== 1 || observation.result !== 'INCOMPLETE_OR_FAILED'
    || observation.admin_web?.required !== policy.admin_recovery.admin_enabled_required
    || observation.admin_web?.finalize === 'success') {
    deny(code, 'source release lifecycle does not permit forward Admin completion');
  }
  const lifecycleFields = [
    'temporary_urls_prestate', 'temporary_urls_enable', 'temporary_urls_cleanup',
    'temporary_urls_prestate_sha256', 'temporary_urls_enable_sha256',
    'temporary_urls_cleanup_sha256',
  ];
  const lifecycleDeclared = lifecycleFields.some(key => Object.hasOwn(observation.admin_web ?? {}, key));
  const lifecycleFilePresent = [
    'admin-web-preview-before.json', 'admin-web-preview-enabled.json', 'admin-web-preview-closed.json',
  ].some(name => existsSync(join(adminDirectory, name)));
  if (lifecycleFilePresent && !lifecycleDeclared) {
    deny(code, 'source Admin temporary URL files lack lifecycle authority');
  }
  if (lifecycleDeclared) {
    if (lifecycleFields.some(key => !Object.hasOwn(observation.admin_web, key))
      || observation.admin_web.temporary_urls_prestate !== 'success'
      || observation.admin_web.temporary_urls_cleanup !== 'success') {
      deny(code, 'source Admin temporary URL lifecycle is incomplete');
    }
    const beforePath = join(adminDirectory, 'admin-web-preview-before.json');
    const enabledPath = join(adminDirectory, 'admin-web-preview-enabled.json');
    const closedPath = join(adminDirectory, 'admin-web-preview-closed.json');
    const before = readFixedJson(adminDirectory, 'admin-web-preview-before.json', code);
    const closed = readFixedJson(adminDirectory, 'admin-web-preview-closed.json', code);
    verifyAdminPreviewLifecycleEvidence(before, {
      result: 'ADMIN_PREVIEW_LIFECYCLE_CAPTURED',
      enabled: observation.admin_web.temporary_urls_enable === 'success' ? false : before.enabled,
      previewsEnabled: observation.admin_web.temporary_urls_enable === 'success'
        ? false : before.previews_enabled,
      code,
    });
    verifyAdminPreviewLifecycleEvidence(closed, {
      result: 'ADMIN_PREVIEW_LIFECYCLE_CLOSED', enabled: false, previewsEnabled: false, code,
    });
    if (observation.admin_web.temporary_urls_prestate_sha256 !== sha256Hex(readFileSync(beforePath))
      || observation.admin_web.temporary_urls_cleanup_sha256 !== sha256Hex(readFileSync(closedPath))) {
      deny(code, 'source Admin temporary URL lifecycle digest differs');
    }
    if (observation.admin_web.temporary_urls_enable === 'success') {
      const enabledState = readFixedJson(adminDirectory, 'admin-web-preview-enabled.json', code);
      verifyAdminPreviewLifecycleEvidence(enabledState, {
        result: 'ADMIN_PREVIEW_LIFECYCLE_ENABLED', enabled: true, previewsEnabled: true, code,
      });
      if (observation.admin_web.temporary_urls_enable_sha256 !== sha256Hex(readFileSync(enabledPath))) {
        deny(code, 'source Admin temporary URL enable digest differs');
      }
    } else if (existsSync(enabledPath) || observation.admin_web.temporary_urls_enable_sha256 !== null) {
      deny(code, 'failed source Admin temporary URL enable has ambiguous evidence');
    }
  }
  if (chainedRecovery) {
    if (sourceManifestDigest !== postcheckRecoveryChain.source_manifest_sha256
      || sha256Hex(canonicalJson(observation)) !== postcheckRecoveryChain.source_observation_sha256
      || postcheckRecoveryChain.source_release_id !== sourceRequest.releaseId) {
      deny(code, 'original release bytes differ from the verified postcheck recovery chain');
    }
  } else if (sourceTransition.b2) {
    try {
      const receipt = publicAuthorityReceipt(authorityContext);
      b2Exact(sourcePostcheck, ['schemaVersion', 'stage', 'result', 'receipt', 'checks']);
      assertAuthorityReceiptMatch(receipt, sourcePostcheck.receipt);
      b2Exact(sourcePostcheck.checks, ['catalog', 'securityAdvisor', 'backup', 'finance', 'manifest', 'functionInventory', 'sourceParity']);
      if (sourcePostcheck.schemaVersion !== 1 || sourcePostcheck.stage !== 'postcheck' || sourcePostcheck.result !== 'VERIFIED'
        || Object.values(sourcePostcheck.checks).some(value => value !== true)
        || observation.steps?.post_snapshot !== 'success' || observation.steps?.postcheck !== 'success'
        || observation.postcheck_file_sha256 !== sha256Hex(readFileSync(postcheckPath))) b2RecoveryReject();
    } catch { b2RecoveryReject(); }
  } else if (observation.steps?.post_snapshot !== policy.admin_recovery.supabase_post_snapshot_status
    || observation.steps?.postcheck !== policy.admin_recovery.supabase_postcheck_status
    || !/^[0-9a-f]{64}$/.test(observation.post_evidence_sha256 ?? '')
    || observation.postcheck_file_sha256 !== sha256Hex(readFileSync(postcheckPath))
    || canonicalJson(Object.keys(sourcePostcheck).sort()) !== canonicalJson(expectedPostcheckKeys)
    || sourcePostcheck.result !== 'REMOTE_POSTCHECK_VERIFIED'
    || canonicalJson(sourcePostcheck.applied_migrations) !== canonicalJson(expectedMigrationVersions)
    || canonicalJson(sourcePostcheck.changed_functions) !== canonicalJson([])
    || canonicalJson(sourcePostcheck.function_attestations) !== canonicalJson([])
    || sourcePostcheck.pre_evidence_sha256 !== observation.pre_evidence_sha256
    || sourcePostcheck.post_evidence_sha256 !== observation.post_evidence_sha256) {
    deny(code, 'source release did not prove successful Supabase postcheck followed by failed Admin finalization');
  }
  const adminManifestBytes = readFileSync(join(adminDirectory, 'admin-web-manifest.json'), 'utf8');
  const adminManifest = readFixedJson(adminDirectory, 'admin-web-manifest.json', code);
  const adminSourceFiles = sourceTransition.b2
    ? b2Projection(adminManifest.source?.files, [{ path: b2String, bytes: b2Integer, sha256: b2String }])
    : adminManifest.source?.files;
  const canonicalAdminManifest = canonicalJson(adminManifest).trimEnd();
  const adminManifestDigest = sha256Hex(Buffer.from(canonicalAdminManifest, 'utf8'));
  if (adminManifestBytes !== `${canonicalAdminManifest}\n`
    || readFileSync(join(adminDirectory, 'admin-web-manifest.sha256'), 'utf8').trim() !== adminManifestDigest
    || adminManifest.enabled !== true || adminManifest.release?.mode !== 'release'
    || adminManifest.release?.approved_sha !== expectedSourceSha
    || adminManifest.release?.release_id !== sourceRequest.releaseId
    || String(adminManifest.release?.run_id) !== sourceRunId
    || adminManifest.release?.run_attempt !== sourceRunAttempt
    || adminManifest.release?.manifest_sha256 !== sourceAdminReleaseManifestDigest
    || !Array.isArray(adminManifest.source?.files)
    || adminManifest.source?.sha256 !== sha256Hex(canonicalJson(adminManifest.source.files).trimEnd())) {
    deny(code, 'source Admin manifest or digest is invalid');
  }
  const buildPath = join(adminDirectory, 'admin-web-build.json');
  const build = existsSync(buildPath) ? readFixedJson(adminDirectory, 'admin-web-build.json', code) : null;
  if (observation.admin_web?.build === 'success'
    && (!build || build.approved_sha !== expectedSourceSha
      || build.source_manifest_sha256 !== adminManifestDigest
      || !/^[0-9a-f]{64}$/.test(build.dist_sha256 ?? ''))) {
    deny(code, 'source Admin reproducible build evidence is invalid');
  }
  const previous = readFixedJson(adminDirectory, 'admin-web-previous.json', code);
  const beforeRoutes = readFixedJson(adminDirectory, 'admin-web-before-routes.json', code);
  const normalizedBeforeRoutes = normalizedRecoveryRoutes(beforeRoutes, code);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(previous?.version_id ?? '') || beforeRoutes.zone_id.length < 1) {
    deny(code, 'source Cloudflare pre-state is invalid');
  }
  const sourceCloudflarePrestate = {
    active_version_id: previous.version_id,
    zone_id: beforeRoutes.zone_id,
    routes_sha256: sha256Hex(canonicalJson(normalizedBeforeRoutes).trimEnd()),
  };
  const requiresRollback = ['candidate', 'promote'].some(step => observation.admin_web?.[step] === 'success');
  if (requiresRollback && policy.admin_recovery.rollback_required_after_candidate_or_promote) {
    for (const name of ['admin-web-recovered-routes.json', 'admin-web-recovered-deployment.json', 'admin-web-recovery.json']) {
      if (!existsSync(join(adminDirectory, name))) deny(code, 'required source Cloudflare rollback evidence is missing');
    }
    const recoveredRoutes = readFixedJson(adminDirectory, 'admin-web-recovered-routes.json', code);
    const recoveredDeployment = readFixedJson(adminDirectory, 'admin-web-recovered-deployment.json', code);
    const recovery = readFixedJson(adminDirectory, 'admin-web-recovery.json', code);
    const activeVersions = recoveredDeployment?.versions;
    if (observation.admin_web.recovery !== 'success'
      || observation.admin_web.recovery_sha256 !== sha256Hex(readFileSync(join(adminDirectory, 'admin-web-recovery.json')))
      || recovery.result !== 'ADMIN_RECOVERY_VERIFIED' || recovery.version_id !== previous.version_id
      || recovery.routes_restored !== true || !Array.isArray(activeVersions) || activeVersions.length !== 1
      || activeVersions[0]?.version_id !== previous.version_id || Number(activeVersions[0]?.percentage) !== 100
      || beforeRoutes.zone_id !== recoveredRoutes.zone_id
      || canonicalJson(normalizedRecoveryRoutes(beforeRoutes, code))
        !== canonicalJson(normalizedRecoveryRoutes(recoveredRoutes, code))) {
      deny(code, 'source Cloudflare rollback was not exact and successful');
    }
  }
  const result = {
    schema_version: 1,
    result: 'ADMIN_RECOVERY_SOURCE_VERIFIED',
    source_run_id: declaredRecoveryRunId,
    source_run_attempt: chainedRecovery
      ? postcheckRecoveryChain.recovery_run_attempt
      : sourceRunAttempt,
    source_sha: recoveryRequest.approvedSha,
    source_release_id: chainedRecovery
      ? postcheckRecoveryChain.recovery_release_id
      : sourceRequest.releaseId,
    original_source_run_id: sourceRunId,
    original_source_run_attempt: sourceRunAttempt,
    original_source_sha: expectedSourceSha,
    original_source_release_id: sourceRequest.releaseId,
    source_manifest_sha256: sourceManifestDigest,
    source_admin_manifest_sha256: adminManifestDigest,
    source_admin_source_sha256: adminManifest.source.sha256,
    source_admin_files: adminSourceFiles,
    source_build_sha256: build?.dist_sha256 ?? null,
    source_cloudflare_prestate: sourceCloudflarePrestate,
    source_artifacts: selectedArtifacts,
    source_manifest: sourceManifest,
    source_request: sourceRequest,
    source_observation: observation,
    source_transition_key: sourceTransition.key,
    postcheck_recovery_chain: chainedRecovery ? postcheckRecoveryChain : null,
  };
  if (sourceTransition.b2) {
    result.authorityReceipt = publicAuthorityReceipt(authorityContext);
    b2VerifiedSources.set(result, b2VerifiedSources.get(verifiedB2Source));
    b2VerifiedSourceRuns.set(result, [sourceRunId, declaredRecoveryRunId]);
    b2VerifiedSourceOutputs.set(result, canonicalJson(result));
  }
  return result;
}

export function verifyAdminRecoveryCloudflarePrestate({
  verifiedSource,
  currentPrevious,
  currentRoutes,
  authorityContext,
}) {
  if (verifiedSource?.authorityReceipt || authorityContext) {
    b2HistoricalSnapshotBinding({ verifiedSource, authorityContext });
  }
  const code = 'ADMIN_RECOVERY_CLOUDFLARE_PRESTATE_MISMATCH';
  const expected = verifiedSource?.source_cloudflare_prestate;
  const routes = normalizedRecoveryRoutes(currentRoutes, code);
  const routesSha256 = sha256Hex(canonicalJson(routes).trimEnd());
  if (verifiedSource?.result !== 'ADMIN_RECOVERY_SOURCE_VERIFIED'
    || !expected || typeof expected.active_version_id !== 'string'
    || typeof expected.zone_id !== 'string' || !/^[0-9a-f]{64}$/.test(expected.routes_sha256 ?? '')
    || currentPrevious?.version_id !== expected.active_version_id
    || currentRoutes?.zone_id !== expected.zone_id
    || routesSha256 !== expected.routes_sha256) {
    deny(code, 'current Cloudflare Admin pre-state differs from the exact recovered source state');
  }
  return {
    schema_version: 1,
    result: 'ADMIN_RECOVERY_CLOUDFLARE_PRESTATE_VERIFIED',
    active_version_id: currentPrevious.version_id,
    zone_id: currentRoutes.zone_id,
    routes_sha256: routesSha256,
  };
}

export function reconstructHistoricalAdvisorBaselineForRecovery({
  policy,
  migrations,
  advisorItems,
  recoveryExceptions,
  code = 'RECOVERY_POSTCHECK_FAILED',
}) {
  if (!Array.isArray(migrations?.items) || !Array.isArray(advisorItems)
    || !Array.isArray(recoveryExceptions)) {
    deny(code, 'Security Advisor recovery inputs are incomplete');
  }
  const installedMigrationNames = new Set(
    migrations.items.map(item => `${item?.version}_${item?.name}`),
  );
  const transitionIsInstalled = (paths, label) => {
    if (!Array.isArray(paths) || paths.length < 1
      || paths.some(path => typeof path !== 'string' || !path.endsWith('.sql'))) {
      deny(code, `${label} migration authority is incomplete`);
    }
    const states = paths.map(path => (
      installedMigrationNames.has(path.split('/').at(-1).replace(/\.sql$/, ''))
    ));
    if (states.some(Boolean) && !states.every(Boolean)) {
      deny(code, `${label} migration authority is only partially installed`);
    }
    return states.every(Boolean);
  };
  const restoredHistoricalFindings = [];
  const appendHistoricalFinding = (finding, label) => {
    const projected = {
      fingerprint: finding?.fingerprint ?? finding?.advisor_fingerprint,
      level: finding?.level ?? finding?.advisor_severity,
      resource_kind: finding?.resource_kind ?? finding?.advisor_type,
    };
    if (!/^[0-9a-f]{64}$/.test(projected.fingerprint ?? '')
      || typeof projected.level !== 'string' || projected.level.length < 1
      || typeof projected.resource_kind !== 'string' || projected.resource_kind.length < 1
      || restoredHistoricalFindings.some(item => item.fingerprint === projected.fingerprint)) {
      deny(code, `${label} historical Advisor finding is malformed or duplicated`);
    }
    restoredHistoricalFindings.push(projected);
  };
  if (transitionIsInstalled(
    [policy?.stories_b1_transition?.migration_path],
    'Stories B1',
  )) {
    const transition = policy?.stories_b1_transition?.security_advisor;
    if (!Array.isArray(transition?.introduced_exceptions)
      || transition.introduced_exceptions.length !== 15
      || !Array.isArray(transition?.removed_findings)
      || transition.removed_findings.length !== 2) {
      deny(code, 'Stories B1 Advisor transition is incomplete');
    }
    transition.removed_findings.forEach(item => appendHistoricalFinding(item, 'Stories B1'));
  }
  if (transitionIsInstalled(
    [policy?.stories_qa_c1_transition?.migration_path],
    'Stories QA C1',
  )) {
    appendHistoricalFinding(
      policy?.stories_qa_c1_transition?.rpc_predecessor_exception,
      'Stories QA C1',
    );
  }
  if (transitionIsInstalled(
    policy?.superuser_control_center_transition?.migrations?.map(item => item?.path),
    'Superuser Control Center',
  )) {
    appendHistoricalFinding(
      policy?.superuser_control_center_transition?.security_advisor?.predecessor_exception,
      'Superuser Control Center',
    );
  }

  const exceptionFingerprints = new Set(
    recoveryExceptions.map(item => item?.advisor_fingerprint),
  );
  if (exceptionFingerprints.has(undefined)
    || exceptionFingerprints.size !== recoveryExceptions.length) {
    deny(code, 'Security Advisor recovery exceptions are malformed or duplicated');
  }
  for (const historical of restoredHistoricalFindings) {
    const present = advisorItems.filter(item => item?.fingerprint === historical.fingerprint);
    if (present.length > 1 || (present.length === 1
      && !exceptionFingerprints.has(historical.fingerprint))) {
      deny(code, 'a replaced historical Advisor finding remains active without exact approval');
    }
  }
  return [
    ...advisorItems.filter(item => !exceptionFingerprints.has(item?.fingerprint)),
    ...restoredHistoricalFindings,
  ].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

export function verifyPostcheckRecovery({
  policy,
  recoveryRequest,
  recoveryManifest,
  sourceManifest,
  sourceObservation,
  currentEvidence,
  adapterSourceSha256,
  authorityContext, verifiedSource, currentGate, requestedAt = new Date().toISOString(),
}) {
  if (sourceManifest?.resources?.web_control_centers_b2_transition || authorityContext) {
    try {
      verifyB2RecoveryOperation({ recoveryRequest, recoveryManifest, verifiedSource, authorityContext,
        currentGate, backup: currentEvidence?.backup, policy, requestedAt });
      const original = b2HistoricalSnapshotBinding({ verifiedSource, authorityContext });
      if (canonicalJson(original.manifest) !== canonicalJson(sourceManifest)
        || canonicalJson(verifiedSource.source_observation) !== canonicalJson(sourceObservation)) b2RecoveryReject();
      return verifyProductionRecoverySnapshot({ recovery: currentEvidence, policy, request: recoveryRequest,
        manifest: recoveryManifest, adapterSourceSha256, authorityContext, requestedAt,
        recoveryAuthorization: { verifiedSource, currentGate } });
    } catch { b2RecoveryReject(); }
  }
  const code = 'RECOVERY_POSTCHECK_FAILED';
  const source = policy?.postcheck_recovery?.approved_sources?.find(item => (
    item.run_id === String(recoveryRequest?.recoverySourceRunId ?? '')
  ));
  if (!source
    || recoveryRequest?.mode !== 'postcheck_recovery'
    || recoveryRequest?.scopeConfirmation !== 'POSTCHECK_RECOVERY_READ_ONLY'
    || recoveryRequest?.approvedSha !== recoveryManifest?.identity?.approved_sha
    || recoveryRequest?.releaseId !== recoveryManifest?.identity?.release_id
    || String(recoveryRequest?.runId) !== String(recoveryManifest?.identity?.run_id)
    || recoveryRequest?.runAttempt !== recoveryManifest?.identity?.run_attempt) {
    deny(code, 'recovery request, manifest, or approved source identity is invalid');
  }
  if (!Array.isArray(recoveryRequest.productiveResources)
    || recoveryRequest.productiveResources.length !== 0
    || canonicalJson(recoveryManifest?.resources) !== canonicalJson({
      config_changed: false,
      function_contracts: [],
      functions: [],
      migrations: [],
    })) {
    deny('RECOVERY_MUTATION_FORBIDDEN', 'postcheck recovery cannot carry productive resources');
  }
  const expectedSourceSteps = expectedRecoverySourceSteps(source);
  if (sourceManifest?.identity?.approved_sha !== source.source_sha
    || sourceManifest?.identity?.release_id !== source.release_id
    || String(sourceManifest?.identity?.run_id) !== source.run_id
    || sourceManifest?.identity?.run_attempt !== source.run_attempt
    || canonicalJson(sourceObservation?.steps) !== canonicalJson(expectedSourceSteps)
    || sourceObservation?.result !== 'INCOMPLETE_OR_FAILED'
    || sourceObservation?.pre_evidence_sha256 !== source.pre_snapshot_evidence_sha256
    || sourceObservation?.post_evidence_sha256 !== source.post_snapshot_evidence_sha256) {
    deny(code, 'original release evidence is not the approved failed-postcheck source');
  }
  verifyProductionRecoverySnapshot({
    recovery: currentEvidence,
    policy,
    request: recoveryRequest,
    manifest: recoveryManifest,
    adapterSourceSha256,
  });
  const adminRecoveryTransitionKey = source.run_id === '41243646356'
    ? 'superuser_control_center_transition'
    : source.run_id === '41351597413'
      ? 'superuser_qa_perf_c1_transition'
      : null;
  const storiesB1Recovery = source.run_id === '40473092474';
  const webControlCentersB1Recovery = source.run_id === '41416609819';
  if (adminRecoveryTransitionKey) {
    try {
      verifyAdminRecoveryInfrastructurePostState({
        post: currentEvidence,
        policy,
        transitionKey: adminRecoveryTransitionKey,
      });
    } catch (error) {
      deny(code, String(error?.message ?? 'Admin recovery post-state verification failed'));
    }
  }

  const migrations = currentEvidence.migrations;
  const expectedMigrationRows = source.expected_migrations.map(expected => migrations.items.filter(item => (
    item.version === expected.name.slice(0, 14) && `${item.version}_${item.name}` === expected.name
  )));
  if (migrations.count !== source.expected_migration_count
    || expectedMigrationRows.some(rows => rows.length !== 1)
    || `${migrations.latest?.version}_${migrations.latest?.name}` !== source.expected_latest_migration) {
    deny(code, 'approved source migrations are missing, duplicated, or not the exact latest inventory');
  }

  if (currentEvidence.functions.count !== policy?.supabase?.expected_remote_function_count) {
    deny(code, 'remote Edge Function inventory count changed unexpectedly');
  }
  const currentFunctions = new Map(currentEvidence.functions.items.map(item => [item.slug, item]));
  const edgeAttestations = source.edge_functions.map(expected => {
    const actual = currentFunctions.get(expected.name);
    if (!actual || canonicalJson(actual) !== canonicalJson({
      ezbr_sha256: expected.source_sha256,
      slug: expected.name,
      status: expected.status,
      verify_jwt: expected.verify_jwt,
      version: expected.version,
    })) {
      deny(code, `Edge Function ${expected.name} differs from the approved live attestation`);
    }
    return {
      name: expected.name,
      source_sha256: actual.ezbr_sha256,
      status: actual.status,
      verify_jwt: actual.verify_jwt,
      version: actual.version,
    };
  });
  if (['40166468648', '40268500711', '40324910390', '40473092474', '41416609819']
    .includes(source.run_id)) {
    const transitionBaselineRunId = source.run_id === '40166468648'
      ? '40139736749'
      : source.run_id === '40324910390'
        ? '40166468648'
        : null;
    const functionTransitions = source.run_id === '40473092474'
      ? source.edge_transitions.map(transition => ({
        current: { name: transition.name, ...transition.to },
        baseline: { name: transition.name, ...transition.from },
      }))
      : transitionBaselineRunId
      ? source.edge_functions.map(current => ({
        current,
        baseline: policy?.postcheck_recovery?.approved_sources
          ?.find(item => item.run_id === transitionBaselineRunId)
          ?.edge_functions?.find(item => item.name === current.name),
      }))
      : [];
    try {
      verifyRecoveryInfrastructureBaseline({
        policy,
        migrations,
        functions: currentEvidence.functions,
        expectedLatestMigration: source.expected_latest_migration,
        functionTransitions,
      });
    } catch (error) {
      deny(code, String(error?.message ?? 'recovery infrastructure baseline verification failed'));
    }
  }

  if (webControlCentersB1Recovery) {
    try {
      validateWebControlCentersB1InstalledState(
        currentEvidence.web_control_centers_b1_state,
        policy?.web_control_centers_b1_transition,
      );
    } catch (error) {
      deny(code, String(error?.message ?? 'Web Control Centers B1 recovery post-state verification failed'));
    }
  }

  const advisorItems = currentEvidence.cron_security.advisors.items;
  const recoveryExceptions = advisorExceptionsForPhase(policy, recoveryManifest, 'recovery', {
    request: recoveryRequest,
    migrations: currentEvidence.migrations,
  });
  const exceptionFingerprints = new Set(recoveryExceptions.map(item => item.advisor_fingerprint));
  const exceptionByFingerprint = new Map(recoveryExceptions.map(item => [item.advisor_fingerprint, item]));
  const presentExceptions = advisorItems.filter(item => exceptionFingerprints.has(item.fingerprint));
  const reconstructedBaselineItems = reconstructHistoricalAdvisorBaselineForRecovery({
    policy,
    migrations,
    advisorItems,
    recoveryExceptions,
    code,
  });
  let baselineCronItems = currentEvidence.cron_security.cron.items;
  const postF5Recovery = ['40324910390', '40473092474', '41243646356', '41351597413',
    '41416609819']
    .includes(source.run_id);
  if (postF5Recovery) {
    const currentCron = currentEvidence.cron_security.cron;
    const expectedJob = policy?.finance_authority_f5_transition?.cron_job;
    const matchingJobs = currentCron.items.filter(item => item.jobname === expectedJob?.jobname);
    if (matchingJobs.length !== 1) {
      deny(code, 'F5 recovery requires exactly one approved autonomous-renewal cron job');
    }
    baselineCronItems = currentCron.items.filter(item => item.jobname !== expectedJob.jobname);
    const baselineCron = { ...currentCron, count: baselineCronItems.length, items: baselineCronItems };
    try {
      verifyCronSnapshotTransition(baselineCron, currentCron, policy.finance_authority_f5_transition);
    } catch (error) {
      deny(code, String(error?.message ?? 'F5 cron recovery verification failed'));
    }
  }
  const reconstructedBaseline = {
    complete: true,
    cron: postF5Recovery
      ? projectCronBaselineItems(baselineCronItems, true)
      : baselineCronItems,
    security_findings: reconstructedBaselineItems,
  };
  if (presentExceptions.length !== exceptionFingerprints.size
    || new Set(presentExceptions.map(item => item.fingerprint)).size !== exceptionFingerprints.size
    || presentExceptions.some(item => {
      const expected = exceptionByFingerprint.get(item.fingerprint);
      return item.level !== expected?.advisor_severity || item.resource_kind !== expected?.advisor_type;
    })
    || reconstructedBaselineItems.length !== policy.security_advisor.baseline.count
    || sha256Hex(canonicalJson(reconstructedBaseline)) !== policy.security_advisor.baseline.cron_security_sha256) {
    deny(code, 'current Security Advisor set is not the historical baseline plus the exact approved exceptions', {
      expected_exception_count: exceptionFingerprints.size,
      present_exception_count: presentExceptions.length,
      current_advisor_count: advisorItems.length,
      expected_baseline_count: policy.security_advisor.baseline.count,
      reconstructed_baseline_count: reconstructedBaselineItems.length,
      expected_baseline_sha256: policy.security_advisor.baseline.cron_security_sha256,
      reconstructed_baseline_sha256: sha256Hex(canonicalJson(reconstructedBaseline)),
    });
  }

  if (canonicalJson(currentEvidence.premium_state.legacy) !== canonicalJson(source.premium_legacy)
    || currentEvidence.premium_state.relation_security.sha256 !== source.premium_relation_security_sha256) {
    deny(code, 'current Premium legacy counts or relation authority differ from the exact approved source');
  }

  const finance = currentEvidence.finance;
  const f5Recovery = postF5Recovery;
  if (finance.transactions.count < 928 || finance.ledger_entries.count < 1918
    || finance.ledger_accounts.count < 131
    || (!f5Recovery && finance.premium_transaction_count !== 0)
    || [...finance.transactions.items, ...finance.ledger_entries.items].some(item => containsReleaseIdentity(item, {
      releaseId: source.release_id,
      runId: source.run_id,
    }))) {
    deny('RELEASE_ATTRIBUTED_FINANCE', 'Finance baseline regressed or contains source-release-attributed movement');
  }
  const financeVerification = verifyFinancePostcheckFromRaw({
    before: finance,
    after: finance,
    windowRows: { complete: true, transactions: [], ledger_entries: [] },
    reconciliationResults: finance.reconciliation,
    expectedPolicy: ['40268500711', '40324910390', '40473092474', '41243646356']
      .includes(source.run_id)
      ? financePolicyShape(F4_GENERAL_FINANCE_AUTHORITY_TRANSITION.to_policy)
      : policy.supabase.finance_policy,
    releaseIdentity: { releaseId: source.release_id, runId: source.run_id, runAttempt: source.run_attempt },
  });

  return {
    schema_version: 1,
    result: 'POSTCHECK_RECOVERY_SUCCESS',
    source_run_id: source.run_id,
    source_release_id: source.release_id,
    source_sha: source.source_sha,
    current_sha: recoveryRequest.approvedSha,
    manifest_sha256: source.manifest_sha256,
    source_artifact_digests: {
      gate: source.gate_artifact.digest,
      release: source.release_artifact.digest,
    },
    current_evidence_sha256: currentEvidence.evidence_sha256,
    security_advisor: {
      baseline_count: reconstructedBaselineItems.length,
      baseline_sha256: policy.security_advisor.baseline.cron_security_sha256,
      exception_count: presentExceptions.length,
      exception_fingerprints: [...exceptionFingerprints].sort(),
      current_count: advisorItems.length,
    },
    functions: {
      count: currentEvidence.functions.count,
      inventory_sha256: currentEvidence.functions.sha256,
      items: edgeAttestations,
    },
    migrations: {
      count: migrations.count,
      latest: migrations.latest,
      inventory_sha256: migrations.sha256,
    },
    finance: {
      integrity: financeVerification.finance.integrity,
      policy: financePolicyShape(finance.policy),
      counts: {
        transactions: finance.transactions.count,
        ledger_entries: finance.ledger_entries.count,
        ledger_accounts: finance.ledger_accounts.count,
      },
      reconciliation: finance.reconciliation,
      premium_transaction_count: finance.premium_transaction_count,
    },
    premium_state: currentEvidence.premium_state,
    ...(storiesB1Recovery ? { stories_b1_state: currentEvidence.stories_b1_state } : {}),
    ...(adminRecoveryTransitionKey === 'superuser_control_center_transition'
      ? { superuser_control_center_state: currentEvidence.superuser_control_center_state }
      : {}),
    ...(adminRecoveryTransitionKey === 'superuser_qa_perf_c1_transition'
      ? { superuser_qa_perf_c1_state: currentEvidence.superuser_qa_perf_c1_state }
      : {}),
    ...(webControlCentersB1Recovery
      ? { web_control_centers_b1_state: currentEvidence.web_control_centers_b1_state }
      : {}),
  };
}

export function verifyAdminRecoveryPostcheckChainProvenance(options) {
  try { return verifyAdminRecoveryPostcheckChainProvenanceInternal(options); }
  catch (error) { if (options.authorityContext || options.verifiedB2Source) b2RecoveryReject(); throw error; }
}

function verifyAdminRecoveryPostcheckChainProvenanceInternal({
  policy,
  policySha256,
  recoveryRequest,
  recoveryManifest,
  run,
  artifacts,
  releaseBundle,
  gateEvidence,
  recoveryEvidence,
  adapterSourceSha256,
  authorityContext, verifiedB2Source, chainProvenance,
}) {
  const code = 'ADMIN_RECOVERY_POSTCHECK_CHAIN_MISMATCH';
  const recoveryRunId = String(recoveryRequest?.recoverySourceRunId ?? '');
  const recoveryRunAttempt = Number(run?.run_attempt);
  if (recoveryRequest?.actor !== policy.owner || recoveryRequest?.triggeringActor !== policy.owner
    || recoveryRequest?.repository !== policy.repository
    || recoveryRequest?.ref !== `refs/heads/${policy.default_branch}`
    || recoveryRequest?.workflowRef !== `${policy.repository}/${policy.workflow_path}@refs/heads/${policy.default_branch}`
    || recoveryRequest?.approvedSha !== recoveryRequest?.mainSha
    || recoveryRequest?.mode !== 'admin_recovery'
    || recoveryRequest?.scopeConfirmation !== policy.scope_confirmations?.admin_recovery
    || recoveryManifest?.identity?.mode !== 'admin_recovery'
    || recoveryManifest?.identity?.approved_sha !== recoveryRequest.approvedSha
    || recoveryManifest?.recovery?.kind !== 'admin_cloudflare_forward_completion'
    || recoveryManifest?.recovery?.source_run_id !== recoveryRunId
    || canonicalJson(recoveryManifest?.resources) !== canonicalJson({
      config_changed: false, function_contracts: [], functions: [], migrations: [],
    })) {
    deny(code, 'Admin recovery request and zero-resource manifest are not exactly bound');
  }
  if (!run || String(run.id) !== recoveryRunId
    || !Number.isSafeInteger(recoveryRunAttempt) || recoveryRunAttempt < 1
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.event !== 'workflow_dispatch' || run.head_branch !== policy.default_branch
    || run.head_sha !== recoveryRequest.approvedSha || run.path !== policy.workflow_path
    || run.repository?.full_name !== policy.repository) {
    deny(code, 'declared Admin recovery source is not the exact successful postcheck recovery run');
  }
  const names = {
    release: `nelyon-release-${recoveryRunId}-${recoveryRunAttempt}`,
    gate: `nelyon-gate-evidence-${recoveryRunId}-${recoveryRunAttempt}`,
    recovery: `nelyon-postcheck-recovery-${recoveryRunId}-${recoveryRunAttempt}`,
  };
  const selectedArtifacts = requireExactRunArtifactMetadata({ artifacts, names, code });
  const b2State = verifiedB2Source ? b2SourceState(verifiedB2Source) : null;
  let authenticatedChain = null;
  if (b2State?.provenance.authorizationSha256) {
    authenticatedChain = readTrustedB2ChainProvenance(chainProvenance, b2State.recoveryProvenance);
    const exact = authenticatedChain.chain;
    if (policySha256 !== b2State.provenance.policySha256 || recoveryRunId !== exact.run_id
      || recoveryRunAttempt !== exact.run_attempt || run.head_sha !== exact.source_sha
      || ['release', 'gate', 'recovery'].some(kind => canonicalJson(selectedArtifacts[kind])
        !== canonicalJson(exact[`${kind}_artifact`]))) b2RecoveryReject();
  }
  const releaseDirectory = resolve(releaseBundle?.directory ?? '');
  const gateDirectory = resolve(gateEvidence?.directory ?? '');
  const recoveryDirectory = resolve(recoveryEvidence?.directory ?? '');
  assertSafeRecoveryDirectory(releaseDirectory, RECOVERY_RELEASE_FILES,
    ['bundle', 'remote-evidence.json', 'request.json'], code);
  assertSafeRecoveryDirectory(gateDirectory, RECOVERY_GATE_FILES, ['gate-proof.json'], code);
  assertSafeRecoveryDirectory(recoveryDirectory, POSTCHECK_RECOVERY_FILES, POSTCHECK_RECOVERY_FILES, code);
  const bundleDirectory = join(releaseDirectory, 'bundle');
  assertSafeRecoveryDirectory(bundleDirectory, BUNDLE_FILES, BUNDLE_FILES, code);
  if (authenticatedChain) {
    assertB2ArchiveFiles(releaseDirectory, authenticatedChain.fileDigests.release, true);
    assertB2ArchiveFiles(gateDirectory, authenticatedChain.fileDigests.gate);
    assertB2ArchiveFiles(recoveryDirectory, authenticatedChain.fileDigests.recovery);
  }

  const chainManifestBytes = readFileSync(join(bundleDirectory, 'manifest.json'), 'utf8');
  const chainManifest = readFixedJson(bundleDirectory, 'manifest.json', code);
  const chainManifestSha256 = sha256Hex(chainManifestBytes);
  const chainRequest = readFixedJson(releaseDirectory, 'request.json', code);
  if (canonicalJson(chainManifest) !== chainManifestBytes
    || readFileSync(join(bundleDirectory, 'manifest.sha256'), 'utf8').trim() !== chainManifestSha256) {
    deny(code, 'postcheck recovery manifest bytes or digest are invalid');
  }
  const sourceRunId = String(chainRequest.recoverySourceRunId ?? '');
  const source = authenticatedChain
    ? readTrustedB2RecoveryProvenance(b2State.recoveryProvenance).source
    : policy?.postcheck_recovery?.approved_sources?.find(item => item.run_id === sourceRunId);
  if (authenticatedChain && (source.run_id !== sourceRunId
    || chainManifestSha256 !== authenticatedChain.chain.manifest_sha256
    || chainManifest.runtime_closure?.closure_sha256 !== authenticatedChain.chain.runtime_closure_sha256)) b2RecoveryReject();
  if (!source || chainRequest.actor !== policy.owner || chainRequest.triggeringActor !== policy.owner
    || chainRequest.mode !== 'postcheck_recovery'
    || chainRequest.scopeConfirmation !== policy.scope_confirmations?.postcheck_recovery
    || chainRequest.repository !== policy.repository
    || chainRequest.ref !== policy.admin_recovery.source_ref
    || chainRequest.workflowRef !== `${policy.repository}/${policy.workflow_path}@${policy.admin_recovery.source_ref}`
    || chainRequest.approvedSha !== recoveryRequest.approvedSha
    || chainRequest.mainSha !== recoveryRequest.approvedSha
    || String(chainRequest.runId) !== recoveryRunId
    || chainRequest.runAttempt !== recoveryRunAttempt
    || !Array.isArray(chainRequest.productiveResources) || chainRequest.productiveResources.length !== 0
    || chainManifest.identity?.mode !== 'postcheck_recovery'
    || chainManifest.identity?.approved_sha !== recoveryRequest.approvedSha
    || chainManifest.identity?.release_id !== chainRequest.releaseId
    || String(chainManifest.identity?.run_id) !== recoveryRunId
    || chainManifest.identity?.run_attempt !== recoveryRunAttempt
    || chainManifest.compiler?.snapshot_adapter_sha256 !== adapterSourceSha256
    || canonicalJson(chainManifest.resources) !== canonicalJson({
      config_changed: false, function_contracts: [], functions: [], migrations: [],
    })) {
    deny(code, 'postcheck recovery request, manifest, or original release authority is invalid');
  }

  const gateProof = readFixedJson(gateDirectory, 'gate-proof.json', code);
  if (!/^[0-9a-f]{64}$/.test(policySha256 ?? '')
    || gateProof?.schema_version !== 1 || gateProof?.result !== 'GATE_VERIFIED'
    || String(gateProof.run_id) !== recoveryRunId || gateProof.run_attempt !== recoveryRunAttempt
    || gateProof.release_id !== chainRequest.releaseId
    || gateProof.approved_sha !== recoveryRequest.approvedSha
    || gateProof.policy_sha256 !== policySha256
    || gateProof.manifest_sha256 !== chainManifestSha256
    || gateProof.authorization_mode !== policy.environment?.authorization_mode) {
    deny(code, 'postcheck recovery gate proof is not exact');
  }

  const verifiedSource = readFixedJson(recoveryDirectory, 'verified-source.json', code);
  const currentEvidence = readFixedJson(recoveryDirectory, 'production-recovery.json', code);
  const storedResult = readFixedJson(recoveryDirectory, 'postcheck-recovery-result.json', code);
  if (!verifiedSource?.source_manifest || typeof verifiedSource.source_manifest !== 'object'
    || !verifiedSource.source_request || typeof verifiedSource.source_request !== 'object'
    || !verifiedSource.source_observation || typeof verifiedSource.source_observation !== 'object'
    || !verifiedSource.source_artifact_digests || typeof verifiedSource.source_artifact_digests !== 'object') {
    deny(code, 'postcheck recovery verified source is incomplete');
  }
  const sourceManifestSha256 = sha256Hex(canonicalJson(verifiedSource?.source_manifest));
  const sourceRequest = verifiedSource?.source_request;
  if (verifiedSource?.schema_version !== 1 || verifiedSource?.result !== 'RECOVERY_SOURCE_VERIFIED'
    || verifiedSource.source_run_id !== source.run_id
    || verifiedSource.source_release_id !== source.release_id
    || verifiedSource.source_sha !== source.source_sha
    || verifiedSource.manifest_sha256 !== source.manifest_sha256
    || sourceManifestSha256 !== source.manifest_sha256
    || canonicalJson(verifiedSource.source_artifact_digests) !== canonicalJson({
      gate: source.gate_artifact.digest,
      release: source.release_artifact.digest,
    })
    || sourceRequest?.mode !== 'release'
    || sourceRequest?.recoverySourceRunId != null
    || sourceRequest?.approvedSha !== source.source_sha
    || sourceRequest?.mainSha !== source.source_sha
    || sourceRequest?.releaseId !== source.release_id
    || String(sourceRequest?.runId) !== source.run_id
    || sourceRequest?.runAttempt !== source.run_attempt
    || verifiedSource.source_manifest?.identity?.mode !== 'release'
    || verifiedSource.source_observation?.result !== 'INCOMPLETE_OR_FAILED') {
    deny(code, 'postcheck recovery verified source is not the exact original release');
  }
  let recomputedResult;
  const b2 = Boolean(verifiedSource.source_manifest?.resources?.web_control_centers_b2_transition);
  try {
    if (b2) {
      b2Exact(verifiedSource, ['schema_version', 'result', 'source_run_id', 'source_release_id', 'source_sha',
        'manifest_sha256', 'source_artifact_digests', 'source_manifest', 'source_request', 'source_observation', 'authorityReceipt']);
      projectB2RecoverySourceParts({ manifest: verifiedSource.source_manifest, request: verifiedSource.source_request,
        observation: verifiedSource.source_observation });
      const sourceState = assertB2SourceArtifacts(verifiedB2Source, { source });
      if (canonicalJson(verifiedSource) !== canonicalJson({ schema_version: 1, result: 'RECOVERY_SOURCE_VERIFIED', ...sourceState.publicSource })) b2RecoveryReject();
      const original = b2HistoricalSnapshotBinding({ verifiedSource: verifiedB2Source, authorityContext });
      if (canonicalJson(original.manifest) !== canonicalJson(verifiedSource.source_manifest)
        || !b2VerifiedSources.has(verifiedB2Source)) b2RecoveryReject();
      const receipt = publicAuthorityReceipt(authorityContext);
      assertAuthorityReceiptMatch(receipt, gateProof.authorityReceipt);
      assertAuthorityReceiptMatch(receipt, verifiedSource.authorityReceipt);
      // These two closed records came from the exact-attempt authenticated
      // recovery artifact. They attest its historical verification; they do
      // not reconstruct private observations or authorize the current mutation.
      for (const value of [currentEvidence, storedResult]) {
        b2Exact(value, ['schemaVersion', 'stage', 'result', 'receipt', 'checks']);
        assertAuthorityReceiptMatch(receipt, value.receipt);
        b2Exact(value.checks, ['catalog', 'securityAdvisor', 'backup', 'finance', 'manifest', 'functionInventory', 'sourceParity']);
        if (value.schemaVersion !== 1 || value.stage !== 'recovery' || value.result !== 'VERIFIED'
          || Object.values(value.checks).some(check => check !== true)) b2RecoveryReject();
      }
      recomputedResult = currentEvidence;
    } else recomputedResult = verifyPostcheckRecovery({
      policy,
      recoveryRequest: chainRequest,
      recoveryManifest: chainManifest,
      sourceManifest: verifiedSource.source_manifest,
      sourceObservation: verifiedSource.source_observation,
      currentEvidence,
      adapterSourceSha256,
    });
  } catch (error) {
    if (b2) b2RecoveryReject();
    deny(code, `postcheck recovery evidence could not be recomputed: ${error?.code ?? error?.message ?? 'invalid evidence'}`);
  }
  if (canonicalJson(storedResult) !== canonicalJson(recomputedResult)) {
    deny(code, 'stored postcheck recovery result differs from recomputed evidence');
  }
  const result = {
    schema_version: 1,
    result: 'ADMIN_RECOVERY_POSTCHECK_CHAIN_VERIFIED',
    recovery_run_id: recoveryRunId,
    recovery_run_attempt: recoveryRunAttempt,
    recovery_release_id: chainRequest.releaseId,
    current_sha: recoveryRequest.approvedSha,
    source_run_id: source.run_id,
    source_run_attempt: source.run_attempt,
    source_release_id: source.release_id,
    source_sha: source.source_sha,
    source_manifest_sha256: source.manifest_sha256,
    source_observation_sha256: sha256Hex(canonicalJson(verifiedSource.source_observation)),
    source_artifact_digests: verifiedSource.source_artifact_digests,
    recovery_artifacts: selectedArtifacts,
    recovered_evidence_sha256: b2 ? sha256Hex(canonicalJson(currentEvidence)) : recomputedResult.current_evidence_sha256,
    recovered_result_sha256: sha256Hex(canonicalJson(recomputedResult)),
  };
  if (b2) {
    result.authorityReceipt = publicAuthorityReceipt(authorityContext);
    b2VerifiedSources.set(result, b2VerifiedSources.get(verifiedB2Source));
    b2VerifiedSourceRuns.set(result, [source.run_id, recoveryRunId]);
    b2VerifiedSourceOutputs.set(result, canonicalJson(result));
  }
  return result;
}

export function verifyAdminRecoveryBuildBinding({
  recoveryRequest,
  recoveryManifest,
  verifiedSource,
  currentAdminManifest,
  currentBuild,
  authorityContext,
}) {
  if (verifiedSource?.authorityReceipt || authorityContext) {
    b2HistoricalSnapshotBinding({ verifiedSource, authorityContext });
  }
  const code = 'ADMIN_RECOVERY_POSTCHECK_FAILED';
  const exactSource = currentAdminManifest?.source?.sha256 === verifiedSource?.source_admin_source_sha256;
  const sourceFiles = verifiedSource?.source_admin_files;
  const currentFiles = currentAdminManifest?.source?.files;
  let protectedRecoveryEvolution = false;
  if (!exactSource && Array.isArray(sourceFiles) && Array.isArray(currentFiles)
    && sourceFiles.length === currentFiles.length) {
    const validateFiles = files => files.every(item => item && typeof item.path === 'string'
      && Number.isSafeInteger(item.bytes) && item.bytes >= 0
      && /^[0-9a-f]{64}$/.test(item.sha256 ?? ''))
      && new Set(files.map(item => item.path)).size === files.length;
    const sourceByPath = new Map(sourceFiles.map(item => [item.path, item]));
    const currentByPath = new Map(currentFiles.map(item => [item.path, item]));
    const pathsEqual = sourceByPath.size === currentByPath.size
      && [...sourceByPath.keys()].every(path => currentByPath.has(path));
    const changedPaths = pathsEqual ? [...sourceByPath.keys()].filter(path => (
      canonicalJson(sourceByPath.get(path)) !== canonicalJson(currentByPath.get(path))
    )) : [];
    const allowedChangedPaths = new Set([
      '.github/workflows/nelyon-production-release.yml',
      'scripts/nelyon-admin-production-release.mjs',
    ]);
    // Exact Git-LF tuples from the sanitized Admin manifests verified in runs 41278629319 and 41278783775.
    const noTransformWorkerEvolution = new Map([
      ['apps/admin-web/deployment/tests/worker.test.mjs', {
        source: { bytes: 4201,
          sha256: 'c8c35cc79f24525d4c97b24e28bb7e8b63637d47fab2b5b64a579c633be144a6' },
        current: { bytes: 4298,
          sha256: 'a2f86e889c200343248ffa539160dd89f66c0c318ec3e1a3465739376e327cf1' },
      }],
      ['apps/admin-web/deployment/worker.mjs', {
        source: { bytes: 1019,
          sha256: '8f6e5a9e09340f2085c651130d718387678293512ee6da44de94e97f728191b8' },
        current: { bytes: 1033,
          sha256: 'a11a8ddb4341cbe15fe32691c0ee9efe2ecaebd2c192c5fbde2b56648fffee62' },
      }],
    ]);
    const authorityOnlyEvolution = changedPaths.length === allowedChangedPaths.size
      && changedPaths.every(path => allowedChangedPaths.has(path));
    const noTransformChangedPaths = new Set([
      ...allowedChangedPaths,
      ...noTransformWorkerEvolution.keys(),
    ]);
    const exactNoTransformEvolution = changedPaths.length === noTransformChangedPaths.size
      && changedPaths.every(path => noTransformChangedPaths.has(path))
      && [...noTransformWorkerEvolution].every(([path, transition]) => (
        canonicalJson(sourceByPath.get(path)) === canonicalJson({ path, ...transition.source })
        && canonicalJson(currentByPath.get(path)) === canonicalJson({ path, ...transition.current })
      ));
    protectedRecoveryEvolution = validateFiles(sourceFiles) && validateFiles(currentFiles)
      && pathsEqual
      && sha256Hex(canonicalJson(sourceFiles).trimEnd()) === verifiedSource.source_admin_source_sha256
      && sha256Hex(canonicalJson(currentFiles).trimEnd()) === currentAdminManifest.source.sha256
      && (authorityOnlyEvolution || exactNoTransformEvolution);
  }
  if (verifiedSource?.result !== 'ADMIN_RECOVERY_SOURCE_VERIFIED'
    || verifiedSource.source_run_id !== String(recoveryRequest?.recoverySourceRunId ?? '')
    || verifiedSource.source_sha !== recoveryRequest?.approvedSha
    || recoveryManifest?.recovery?.source_run_id !== verifiedSource.source_run_id
    || currentAdminManifest?.enabled !== true || currentAdminManifest?.release?.mode !== 'admin_recovery'
    || currentAdminManifest?.release?.recovery_source_run_id !== verifiedSource.source_run_id
    || currentAdminManifest?.release?.approved_sha !== recoveryRequest?.approvedSha
    || (!exactSource && !protectedRecoveryEvolution)
    || currentBuild?.approved_sha !== recoveryRequest?.approvedSha
    || currentBuild?.source_manifest_sha256 !== sha256Hex(canonicalJson(currentAdminManifest).trimEnd())
    || !/^[0-9a-f]{64}$/.test(currentBuild?.dist_sha256 ?? '')
    || (verifiedSource.source_build_sha256 !== null
      && currentBuild.dist_sha256 !== verifiedSource.source_build_sha256)) {
    deny(code, 'Admin recovery source, rebuilt bytes, or current recovery identity drifted');
  }
  return true;
}

export function verifyAdminRecoveryPostcheck({
  policy,
  recoveryRequest,
  recoveryManifest,
  verifiedSource,
  currentEvidence,
  currentAdminManifest,
  currentBuild,
  adapterSourceSha256,
  authorityContext, currentGate, requestedAt = new Date().toISOString(),
}) {
  if (verifiedSource?.source_manifest?.resources?.web_control_centers_b2_transition || authorityContext) {
    try {
      verifyB2RecoveryOperation({ recoveryRequest, recoveryManifest, verifiedSource, authorityContext,
        currentGate, backup: currentEvidence?.backup, policy, requestedAt });
      verifyAdminRecoveryBuildBinding({ recoveryRequest, recoveryManifest, verifiedSource, currentAdminManifest, currentBuild, authorityContext });
      return verifyProductionAdminRecoverySnapshot({ post: currentEvidence, policy, request: recoveryRequest,
        manifest: recoveryManifest, adapterSourceSha256, authorityContext, requestedAt,
        recoveryAuthorization: { verifiedSource, currentGate } });
    } catch { b2RecoveryReject(); }
  }
  verifyAdminRecoveryBuildBinding({
    recoveryRequest,
    recoveryManifest,
    verifiedSource,
    currentAdminManifest,
    currentBuild,
  });
  const snapshot = verifyProductionAdminRecoverySnapshot({
    post: currentEvidence,
    policy,
    request: recoveryRequest,
    manifest: recoveryManifest,
    adapterSourceSha256,
    transitionKey: verifiedSource.source_transition_key,
  });
  return {
    schema_version: 1,
    result: 'ADMIN_RECOVERY_POSTCHECK_VERIFIED',
    source_run_id: verifiedSource.source_run_id,
    source_build_sha256: verifiedSource.source_build_sha256,
    recovery_build_sha256: currentBuild.dist_sha256,
    production_evidence_sha256: snapshot.evidence_sha256,
  };
}

export function validateReleaseHistory({ releaseId, pages, policy }) {
  if (!pages || pages.complete !== true || !Array.isArray(pages.pages)) {
    deny('INCOMPLETE_RELEASE_HISTORY', 'workflow release history pagination is incomplete');
  }
  const records = [];
  for (const page of pages.pages) {
    if (!page || !Array.isArray(page.items)) deny('INCOMPLETE_RELEASE_HISTORY', 'workflow history page is incomplete');
    records.push(...page.items);
  }
  records.push(...(policy.release_history ?? []));
  if (records.some(record => record?.release_id === releaseId || record?.releaseId === releaseId)) {
    deny('RELEASE_ID_REPLAY', `release ID ${releaseId} has already been used`);
  }
  return true;
}

function requireUnsignedInteger(value, code, label, { positive = false } = {}) {
  const text = String(value ?? '');
  if (!/^(0|[1-9][0-9]*)$/.test(text) || (positive && BigInt(text) === 0n)) {
    deny(code, `${label} must be a ${positive ? 'positive ' : ''}unsigned integer`);
  }
  return text;
}

function requireTokenPart(value, code, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value)) {
    deny(code, `${label} contains unsupported token characters`);
  }
  return value;
}

function flattenCompletePages(envelope, code, label) {
  if (!envelope || envelope.complete !== true || !Array.isArray(envelope.pages)) {
    deny(code, `${label} pagination is incomplete`);
  }
  const records = [];
  for (const page of envelope.pages) {
    if (!page || !Array.isArray(page.items)) deny(code, `${label} page is incomplete`);
    records.push(...page.items);
  }
  return records;
}

export function buildApprovalToken(input) {
  const runId = requireUnsignedInteger(input?.runId, 'INVALID_APPROVAL_TOKEN', 'run ID', { positive: true });
  const runAttempt = requireUnsignedInteger(input?.runAttempt, 'INVALID_APPROVAL_TOKEN', 'run attempt', { positive: true });
  const environmentId = requireUnsignedInteger(input?.environmentId, 'INVALID_APPROVAL_TOKEN', 'environment ID', { positive: true });
  const releaseId = requireTokenPart(input?.releaseId, 'INVALID_APPROVAL_TOKEN', 'release ID');
  if (!SHA_PATTERN.test(input?.approvedSha ?? '')) deny('INVALID_APPROVAL_TOKEN', 'approved SHA must be a full lowercase commit ID');
  if (!/^[0-9a-f]{64}$/.test(input?.manifestDigest ?? '')) deny('INVALID_APPROVAL_TOKEN', 'manifest digest must be lowercase SHA-256');
  const prefix = `NELYON-APPROVE run=${runId} attempt=${runAttempt} env=${environmentId} release=${releaseId} sha=${input.approvedSha} manifest=${input.manifestDigest}`;
  if (!['gate_proof', 'release'].includes(input?.mode)) deny('INVALID_APPROVAL_TOKEN', 'approval mode must be gate_proof or release');
  return prefix;
}

export function verifyEnvironmentSnapshot({ environment, branchPolicies, expected }) {
  const fail = message => deny('UNSAFE_ENVIRONMENT', message);
  if (!environment || String(environment.id) !== String(expected?.id) || environment.name !== expected?.name) {
    fail('the Environment identity does not match the current release');
  }
  if (environment.can_admins_bypass !== false) fail('Environment administrative bypass must be disabled');
  if (environment.deployment_branch_policy?.protected_branches !== false
    || environment.deployment_branch_policy?.custom_branch_policies !== true) {
    fail('Environment must use a main-only custom deployment branch policy');
  }
  const authorizationMode = expected?.authorizationMode ?? 'manual';
  const protectionRules = environment.protection_rules ?? [];
  const reviewerRules = protectionRules.filter(rule => rule?.type === 'required_reviewers');
  if (authorizationMode === 'automatic') {
    const interactiveRules = protectionRules.filter(rule => rule?.type !== 'branch_policy');
    if (interactiveRules.length !== 0) {
      fail('automatic Environment authorization must not contain human or timed protection rules');
    }
  } else if (authorizationMode === 'manual') {
    if (reviewerRules.length !== 1) fail('Environment must have exactly one required-reviewers rule');
    const rule = reviewerRules[0];
    const reviewers = rule?.reviewers ?? [];
    if (rule?.prevent_self_review !== false
      || reviewers.length !== 1
      || reviewers[0]?.type !== 'User'
      || reviewers[0]?.reviewer?.login !== expected?.owner) {
      fail('Environment reviewer must be the sole owner with self-review enabled');
    }
  } else {
    fail('Environment authorization mode is unsupported');
  }
  const policies = flattenCompletePages(branchPolicies, 'UNSAFE_ENVIRONMENT', 'Environment branch-policy');
  if (policies.length !== 1 || policies[0]?.name !== expected?.branch) {
    fail('Environment must allow deployments from main only');
  }
  return true;
}

export function verifyApprovalHistory({
  approvals,
  expectedToken,
  owner,
  environmentId,
  environmentName,
  expectedRunId,
  expectedRunAttempt,
}) {
  const records = flattenCompletePages(approvals, 'INCOMPLETE_APPROVAL_HISTORY', 'deployment approval');
  if (String(approvals.sourceRunId) !== String(expectedRunId)
    || Number(approvals.sourceRunAttempt) !== Number(expectedRunAttempt)) {
    deny('INVALID_CURRENT_APPROVAL', 'approval evidence was not fetched for the current workflow attempt');
  }
  const matching = records.filter(record => {
    const environments = Array.isArray(record?.environments) ? record.environments : [];
    return record?.state === 'approved'
      && record?.comment === expectedToken
      && record?.user?.login === owner
      && environments.length === 1
      && String(environments[0]?.id) === String(environmentId)
      && environments[0]?.name === environmentName;
  });
  if (matching.length !== 1 || records.length !== 1) {
    deny('INVALID_CURRENT_APPROVAL', 'exactly one owner approval bound to the current attempt is required');
  }
  return true;
}

export function verifyAutomaticAuthorizationHistory({
  approvals,
  expectedRunId,
  expectedRunAttempt,
}) {
  const records = flattenCompletePages(approvals, 'INCOMPLETE_APPROVAL_HISTORY', 'deployment approval');
  if (String(approvals.sourceRunId) !== String(expectedRunId)
    || Number(approvals.sourceRunAttempt) !== Number(expectedRunAttempt)
    || records.length !== 0) {
    deny('INVALID_AUTOMATIC_AUTHORIZATION', 'automatic authorization requires current empty deployment approval history');
  }
  return true;
}

export function verifyConcurrency({ runs, currentRunId, complete }) {
  const envelope = complete === undefined ? runs : { pages: runs, complete };
  const records = flattenCompletePages(envelope, 'INCOMPLETE_RUN_HISTORY', 'workflow run');
  const active = new Set(['in_progress', 'pending', 'queued', 'requested', 'waiting']);
  if (records.some(run => active.has(run?.status) && String(run?.id) !== String(currentRunId))) {
    deny('CONCURRENT_RELEASE', 'another production release workflow is active');
  }
  return true;
}

export function requiredSecretsForMode(mode, secrets) {
  if (mode === 'plan_only' || mode === 'gate_proof' || mode === 'postcheck_recovery') return [];
  if (mode !== 'release' && mode !== 'admin_recovery') deny('INVALID_MODE', 'unsupported release mode');
  const required = ['SUPABASE_ACCESS_TOKEN'];
  const missing = required.filter(name => typeof secrets?.[name] !== 'string' || secrets[name].length === 0);
  if (missing.length > 0) deny('MISSING_SECRETS', 'required Environment deployment secrets are unavailable', { missing });
  return required;
}

function assertCompleteBaselineSection(section, label, { arrayKey } = {}) {
  if (!section || section.complete !== true || (arrayKey && !Array.isArray(section[arrayKey]))) {
    deny('INCOMPLETE_BASELINE_EVIDENCE', `${label} evidence is incomplete`);
  }
}

function baselineEvidencePayload(evidence) {
  const { evidence_sha256: ignored, verification: ignoredVerification, ...payload } = evidence;
  return payload;
}

function assertBaselineEvidenceDigest(evidence) {
  if (!evidence || !/^[0-9a-f]{64}$/.test(evidence.evidence_sha256 ?? '')) {
    deny('BASELINE_EVIDENCE_MISMATCH', 'baseline evidence digest is missing');
  }
  const actual = sha256Hex(canonicalJson(baselineEvidencePayload(evidence)));
  if (actual !== evidence.evidence_sha256) deny('BASELINE_EVIDENCE_MISMATCH', 'baseline evidence bytes do not match their digest');
}

export function buildBaselineEvidence(snapshot) {
  if (!snapshot || (snapshot.source !== undefined && snapshot.source !== 'owner-control-plane') || snapshot.workflow_runtime === true) {
    deny('INVALID_BASELINE_AUTHORITY', 'baseline evidence must come from the owner control plane outside a workflow runtime');
  }
  if (snapshot.complete !== true
    || snapshot.source !== 'owner-control-plane'
    || snapshot.workflow_runtime !== false
    || !SHA_PATTERN.test(snapshot.candidate_sha ?? '')
    || typeof snapshot.project_ref !== 'string'
    || !Number.isFinite(Date.parse(snapshot.observed_at))
    || !/^[0-9a-f]{64}$/.test(snapshot.reviewed_policy_sha256 ?? '')) {
    deny('INCOMPLETE_BASELINE_EVIDENCE', 'baseline identity evidence is incomplete');
  }
  assertCompleteBaselineSection(snapshot.migrations, 'migration', { arrayKey: 'items' });
  assertCompleteBaselineSection(snapshot.functions, 'function', { arrayKey: 'managed' });
  if (!Array.isArray(snapshot.functions.unmanaged)) deny('INCOMPLETE_BASELINE_EVIDENCE', 'unmanaged function inventory is incomplete');
  assertCompleteBaselineSection(snapshot.config, 'config and verify_jwt', { arrayKey: 'managed_functions' });
  assertCompleteBaselineSection(snapshot.cron_security, 'cron and security', { arrayKey: 'cron' });
  assertCompleteBaselineSection(snapshot.finance, 'finance');
  assertCompleteBaselineSection(snapshot.health, 'project health');
  const prior = snapshot.prior_release;
  if (!prior || !['bootstrap', 'post-release'].includes(prior.kind)
    || !/^[0-9a-f]{64}$/.test(prior.postcheck_evidence_sha256 ?? '')
    || (prior.kind === 'post-release' && (!RELEASE_ID_PATTERN.test(prior.release_id ?? '')
      || !/^[0-9a-f]{64}$/.test(prior.manifest_sha256 ?? '')))) {
    deny('INCOMPLETE_BASELINE_EVIDENCE', 'prior release authority evidence is incomplete');
  }
  const managed = [...snapshot.functions.managed].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const unmanaged = [...snapshot.functions.unmanaged].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const blockedResources = managed.filter(item => item.source_parity !== true).map(item => item.name).sort();
  const digestOf = value => sha256Hex(canonicalJson(value));
  const baselineUsesRawCronIdentity = snapshot.migrations.latest
    >= '20261026072512_creator_premium_f5_autonomous_subscriptions';
  const cronSecurity = {
    ...snapshot.cron_security,
    cron: projectCronBaselineItems(snapshot.cron_security.cron, baselineUsesRawCronIdentity),
  };
  const baselineFinance = projectProductionBaselineFinance(
    snapshot.finance,
    snapshot.migrations.latest,
  );
  const payload = {
    schema_version: 1,
    complete: true,
    source: snapshot.source,
    observed_at: snapshot.observed_at,
    project_ref: snapshot.project_ref,
    candidate_sha: snapshot.candidate_sha,
    workflow_runtime: false,
    reviewed_policy_sha256: snapshot.reviewed_policy_sha256,
    migrations: {
      count: snapshot.migrations.items.length,
      latest: snapshot.migrations.latest,
      items: [...snapshot.migrations.items],
    },
    functions: { managed, unmanaged },
    config: snapshot.config,
    cron_security: cronSecurity,
    finance: snapshot.finance,
    health: snapshot.health,
    prior_release: prior,
    blocked_resources: blockedResources,
    digests: {
      migrations: digestOf(snapshot.migrations.items),
      managed_functions: digestOf(managed.map(item => ({ name: item.name, version: item.version, verify_jwt: item.verify_jwt }))),
      unmanaged_functions: digestOf(unmanaged),
      function_source_parity: digestOf(managed.map(item => ({ name: item.name, source_sha256: item.source_sha256, source_parity: item.source_parity }))),
      config_verify_jwt: digestOf(snapshot.config),
      cron_security: digestOf(cronSecurity),
      finance: digestOf(baselineFinance),
    },
  };
  return { ...payload, evidence_sha256: digestOf(payload) };
}

export function verifyBaselineEvidence({ candidate, evidence, expected }) {
  assertBaselineEvidenceDigest(evidence);
  if (candidate?.state !== 'candidate'
    || candidate.sha !== expected?.sha
    || evidence.complete !== true
    || evidence.source !== 'owner-control-plane'
    || evidence.workflow_runtime !== false
    || evidence.project_ref !== expected?.projectRef
    || evidence.candidate_sha !== expected?.sha
    || evidence.migrations?.count !== expected?.migrationCount
    || evidence.migrations?.latest !== expected?.latestMigration
    || evidence.health?.complete !== true
    || evidence.health?.status !== 'ACTIVE_HEALTHY') {
    deny('BASELINE_EVIDENCE_MISMATCH', 'baseline identity, migration, or project-health evidence does not match');
  }
  const managedNames = (evidence.functions?.managed ?? []).map(item => item.name).sort();
  const expectedManaged = [...(expected?.managedFunctions ?? [])].sort();
  if (managedNames.length !== expectedManaged.length
    || managedNames.some((name, index) => name !== expectedManaged[index])
    || managedNames.length + (evidence.functions?.unmanaged ?? []).length !== expected?.remoteFunctionCount) {
    deny('BASELINE_EVIDENCE_MISMATCH', 'remote function inventory does not match the controlled scope');
  }
  const activeF4Baseline = expected?.latestMigration
    >= '20261026030000_creator_premium_f4_general_bdag_activation';
  if (canonicalJson(financePolicyShape(evidence.finance?.policy)) !== canonicalJson(expected?.financePolicy)
    || (!activeF4Baseline && evidence.finance?.premium_transaction_count !== 0)
    || (activeF4Baseline && (!Number.isInteger(evidence.finance?.premium_transaction_count)
      || evidence.finance.premium_transaction_count < 0))
    || evidence.finance?.c2_attributed_bdag_movement !== 0) {
    deny('BASELINE_EVIDENCE_MISMATCH', 'finance baseline does not match its exact phase policy and movement contract');
  }
  const reviewedPolicySha256 = expected?.reviewedPolicyBytes !== undefined
    ? sha256Hex(expected.reviewedPolicyBytes)
    : expected?.reviewedPolicySha256;
  if (!/^[0-9a-f]{64}$/.test(reviewedPolicySha256 ?? '')
    || evidence.reviewed_policy_sha256 !== reviewedPolicySha256) {
    deny('BASELINE_EVIDENCE_MISMATCH', 'reviewed policy bytes do not match the independent digest');
  }
  if (canonicalJson(evidence.digests) !== canonicalJson(expected?.evidenceDigests)
    || canonicalJson(evidence.blocked_resources) !== canonicalJson(expected?.blockedResources)) {
    deny('BASELINE_EVIDENCE_MISMATCH', 'baseline section digests or blocked resources do not match owner-reviewed evidence');
  }
  return {
    ...evidence,
    verification: {
      state: 'verified',
      source: 'owner-control-plane',
      reviewed_policy_sha256: reviewedPolicySha256,
      evidence_sha256: evidence.evidence_sha256,
    },
  };
}

export function proposeVerifiedBaseline({ policy, evidence, owner, source = 'owner-control-plane' }) {
  if (owner !== 'andressan101989'
    || source !== 'owner-control-plane'
    || policy?.baseline_authority?.workflow_may_promote !== false
    || policy?.baseline_authority?.requires_separate_policy_commit !== true
    || evidence?.verification?.state !== 'verified'
    || evidence?.workflow_runtime !== false) {
    deny('INVALID_BASELINE_AUTHORITY', 'only the owner control plane may propose a separately committed baseline');
  }
  assertBaselineEvidenceDigest(evidence);
  const proposed = structuredClone(policy);
  proposed.baseline = {
    ...proposed.baseline,
    state: 'verified',
    sha: evidence.candidate_sha,
    migration_count: evidence.migrations.count,
    latest_migration: evidence.migrations.latest,
    evidence: evidence.evidence_sha256,
    evidence_digests: evidence.digests,
    blocked_resources: evidence.blocked_resources,
    reviewed_policy_sha256: evidence.reviewed_policy_sha256,
    prior_release: evidence.prior_release,
    verified_by: owner,
    verified_at: evidence.observed_at,
    authority_source: source,
    requires_separate_policy_commit: true,
  };
  const bytes = canonicalJson(proposed);
  return { bytes, digest: sha256Hex(bytes), policy: proposed };
}

const FINANCE_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'reversed']);
const FINANCE_TERMINAL_STATUSES = new Set(['completed', 'failed', 'reversed']);
const FINANCE_ALLOWED_TRANSITIONS = new Set([
  'pending:processing',
  'pending:completed',
  'pending:failed',
  'pending:reversed',
  'processing:completed',
  'processing:failed',
  'processing:reversed',
]);

function uniqueRecords(records, label, code = 'INVALID_FINANCE_SNAPSHOT') {
  const map = new Map();
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || record.id.length === 0 || map.has(record.id)) {
      deny(code, `${label} contains a missing or duplicate ID`);
    }
    map.set(record.id, record);
  }
  return map;
}

function compareWatermark(left, right) {
  const timestamp = String(left.created_at).localeCompare(String(right.created_at));
  return timestamp || String(left.id).localeCompare(String(right.id));
}

function financePolicyShape(policy) {
  return {
    purchase_enabled: policy?.purchase_enabled,
    subscription_enabled: policy?.subscription_enabled,
    refunds_enabled: policy?.refunds_enabled,
    platform_fee_bps: policy?.platform_fee_bps,
  };
}

export function validateFinanceSnapshot(snapshot) {
  if (!snapshot || snapshot.complete !== true || !Number.isFinite(Date.parse(snapshot.database_time))) {
    deny('INVALID_FINANCE_SNAPSHOT', 'finance snapshot identity is incomplete');
  }
  const policy = financePolicyShape(snapshot.policy);
  if (typeof policy.purchase_enabled !== 'boolean'
    || typeof policy.subscription_enabled !== 'boolean'
    || typeof policy.refunds_enabled !== 'boolean'
    || !Number.isInteger(policy.platform_fee_bps)) {
    deny('INVALID_FINANCE_SNAPSHOT', 'finance policy snapshot is malformed');
  }
  for (const [key, label] of [['transactions', 'transaction'], ['ledger_entries', 'ledger entry']]) {
    const inventory = snapshot[key];
    if (!inventory || inventory.complete !== true || !Array.isArray(inventory.items) || inventory.count !== inventory.items.length) {
      deny('INVALID_FINANCE_SNAPSHOT', `${label} inventory is incomplete`);
    }
    uniqueRecords(inventory.items, label);
  }
  const transactions = snapshot.transactions.items;
  const ordered = [...transactions].sort(compareWatermark);
  const last = ordered.at(-1);
  if ((!last && snapshot.watermark !== null)
    || (last && (!snapshot.watermark
      || snapshot.watermark.created_at !== last.created_at
      || snapshot.watermark.id !== last.id))) {
    deny('INVALID_FINANCE_SNAPSHOT', 'transaction watermark does not match the complete inventory');
  }
  const databaseTime = Date.parse(snapshot.database_time);
  for (const transaction of transactions) {
    if (!FINANCE_STATUSES.has(transaction.status)
      || transaction.currency !== 'BDAG'
      || !Number.isFinite(Date.parse(transaction.created_at))
      || Date.parse(transaction.created_at) > databaseTime
      || (transaction.blockchain_txid_sha256 !== null
        && transaction.blockchain_txid_sha256 !== undefined
        && !/^[0-9a-f]{64}$/.test(transaction.blockchain_txid_sha256))) {
      deny('INVALID_FINANCE_SNAPSHOT', `transaction ${transaction.id} has invalid canonical fields`);
    }
  }
  return true;
}

function decimalUnits(value) {
  const text = String(value);
  const match = /^(-?)([0-9]+)(?:\.([0-9]{1,18}))?$/.exec(text);
  if (!match) deny('FINANCE_RECONCILIATION_FAILED', `invalid numeric value ${text}`);
  const units = BigInt(`${match[2]}${(match[3] ?? '').padEnd(18, '0')}`);
  return match[1] ? -units : units;
}

function withoutTransitionFields(transaction) {
  const {
    status: ignoredStatus,
    blockchain_txid: ignoredBlockchain,
    blockchain_txid_sha256: ignoredBlockchainDigest,
    ...stable
  } = transaction;
  return stable;
}

function validBlockchainConfirmation(previous, current) {
  const before = previous.blockchain_txid_sha256 ?? previous.blockchain_txid ?? null;
  const after = current.blockchain_txid_sha256 ?? current.blockchain_txid ?? null;
  return before === after || (before === null && typeof after === 'string' && /^[0-9a-f]{64}$/.test(after));
}

function containsReleaseIdentity(value, releaseIdentity) {
  const forbidden = [releaseIdentity?.releaseId, releaseIdentity?.runId].filter(Boolean).map(String);
  const visit = candidate => {
    if (typeof candidate === 'string') return forbidden.some(token => candidate.includes(token));
    if (Array.isArray(candidate)) return candidate.some(visit);
    if (candidate && typeof candidate === 'object') return Object.values(candidate).some(visit);
    return false;
  };
  return visit(value);
}

function assertBalancedTransaction(transaction, entries) {
  if (transaction.status !== 'completed') return;
  const debit = entries.filter(entry => entry.entry_type === 'debit');
  const credit = entries.filter(entry => entry.entry_type === 'credit');
  if (debit.length === 0 || credit.length === 0
    || entries.some(entry => !['debit', 'credit'].includes(entry.entry_type))) {
    deny('FINANCE_RECONCILIATION_FAILED', `transaction ${transaction.id} lacks canonical debit and credit legs`);
  }
  const debitTotal = debit.reduce((sum, entry) => sum + decimalUnits(entry.amount), 0n);
  const creditTotal = credit.reduce((sum, entry) => sum + decimalUnits(entry.amount), 0n);
  const amount = decimalUnits(transaction.amount);
  if (amount <= 0n || debitTotal !== amount || creditTotal !== amount
    || (transaction.from_account_id && !debit.some(entry => entry.account_id === transaction.from_account_id))
    || (transaction.to_account_id && !credit.some(entry => entry.account_id === transaction.to_account_id))) {
    deny('FINANCE_RECONCILIATION_FAILED', `transaction ${transaction.id} ledger legs do not reconcile`);
  }
}

export function classifyFinanceWindow({ before, after, transactions, ledgerEntries, releaseIdentity }) {
  validateFinanceSnapshot(before);
  validateFinanceSnapshot(after);
  if (!Array.isArray(transactions) || !Array.isArray(ledgerEntries)) deny('INVALID_FINANCE_WINDOW', 'finance window rows are incomplete');
  const queriedTransactions = uniqueRecords(transactions, 'window transaction', 'INVALID_FINANCE_WINDOW');
  const queriedLedger = uniqueRecords(ledgerEntries, 'window ledger entry', 'INVALID_FINANCE_WINDOW');
  if ([...queriedTransactions.values(), ...queriedLedger.values()].some(record => containsReleaseIdentity(record, releaseIdentity))) {
    deny('RELEASE_ATTRIBUTED_FINANCE', 'finance activity is attributed to the current release attempt');
  }
  const beforeTransactions = uniqueRecords(before.transactions.items, 'pre-snapshot transaction');
  const afterTransactions = uniqueRecords(after.transactions.items, 'post-snapshot transaction');
  const beforeLedger = uniqueRecords(before.ledger_entries.items, 'pre-snapshot ledger entry');
  const afterLedger = uniqueRecords(after.ledger_entries.items, 'post-snapshot ledger entry');
  for (const id of beforeTransactions.keys()) {
    if (!afterTransactions.has(id)) deny('HISTORICAL_FINANCE_MUTATION', `historical transaction ${id} disappeared`);
  }
  for (const [id, entry] of beforeLedger) {
    if (!afterLedger.has(id) || canonicalJson(afterLedger.get(id)) !== canonicalJson(entry)) {
      deny('HISTORICAL_FINANCE_MUTATION', `historical ledger entry ${id} changed`);
    }
  }
  const newIds = [];
  const transitionedIds = [];
  const changedIds = [];
  for (const [id, current] of afterTransactions) {
    const previous = beforeTransactions.get(id);
    if (!previous) {
      if (before.watermark && compareWatermark(current, before.watermark) <= 0) {
        deny('INVALID_FINANCE_WINDOW', `new transaction ${id} falls outside the complete pre-snapshot watermark`);
      }
      newIds.push(id);
      changedIds.push(id);
      continue;
    }
    if (canonicalJson(current) === canonicalJson(previous)) continue;
    if (FINANCE_TERMINAL_STATUSES.has(previous.status)
      || !FINANCE_ALLOWED_TRANSITIONS.has(`${previous.status}:${current.status}`)
      || !validBlockchainConfirmation(previous, current)
      || canonicalJson(withoutTransitionFields(previous)) !== canonicalJson(withoutTransitionFields(current))) {
      deny('HISTORICAL_FINANCE_MUTATION', `historical transaction ${id} changed outside an allowed status confirmation`);
    }
    transitionedIds.push(id);
    changedIds.push(id);
  }
  const expectedChanged = [...changedIds].sort();
  const queriedIds = [...queriedTransactions.keys()].sort();
  if (canonicalJson(queriedIds) !== canonicalJson(expectedChanged)) {
    deny('INVALID_FINANCE_WINDOW', 'window transaction query does not equal the complete pre/post delta');
  }
  for (const id of queriedIds) {
    if (canonicalJson(queriedTransactions.get(id)) !== canonicalJson(afterTransactions.get(id))) {
      deny('INVALID_FINANCE_WINDOW', `window transaction ${id} does not match the post-snapshot row`);
    }
  }
  const newLedgerEntries = [...afterLedger.values()].filter(entry => !beforeLedger.has(entry.id));
  const expectedLedgerIds = newLedgerEntries.map(entry => entry.id).sort();
  if (canonicalJson([...queriedLedger.keys()].sort()) !== canonicalJson(expectedLedgerIds)) {
    deny('FINANCE_RECONCILIATION_FAILED', 'window ledger query does not equal the complete pre/post delta');
  }
  for (const entry of newLedgerEntries) {
    if (canonicalJson(queriedLedger.get(entry.id)) !== canonicalJson(entry) || !changedIds.includes(entry.txn_id)) {
      deny('FINANCE_RECONCILIATION_FAILED', `ledger entry ${entry.id} is not tied to an eligible changed transaction`);
    }
  }
  for (const id of changedIds) {
    const transaction = afterTransactions.get(id);
    if (!FINANCE_STATUSES.has(transaction.status) || transaction.currency !== 'BDAG') {
      deny('FINANCE_RECONCILIATION_FAILED', `transaction ${id} has noncanonical status or currency`);
    }
    assertBalancedTransaction(transaction, newLedgerEntries.filter(entry => entry.txn_id === id));
  }
  return {
    integrity: 'PASS',
    new_transaction_ids: newIds.sort(),
    preexisting_confirmed_after_snapshot: transitionedIds.sort(),
    count_growth: {
      transactions: after.transactions.count - before.transactions.count,
      ledger_entries: after.ledger_entries.count - before.ledger_entries.count,
    },
    findings: [],
  };
}

function exactReconciliationsZero(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(REQUIRED_FINANCE_RECONCILIATIONS)) return false;
  return REQUIRED_FINANCE_RECONCILIATIONS.every(key => Number.isFinite(value[key]) && value[key] === 0);
}

export function verifyFinancePostcheck({
  before,
  after,
  window,
  reconciliationResults,
  expectedPolicy,
  expectedBeforePolicy = expectedPolicy,
  expectedAfterPolicy = expectedPolicy,
  requireNoFinancialMovement = false,
}) {
  validateFinanceSnapshot(before);
  validateFinanceSnapshot(after);
  if (Date.parse(after.database_time) < Date.parse(before.database_time)) {
    deny('INVALID_FINANCE_WINDOW', 'post-snapshot database time precedes the pre-snapshot');
  }
  if (canonicalJson(financePolicyShape(before.policy)) !== canonicalJson(expectedBeforePolicy)
    || canonicalJson(financePolicyShape(after.policy)) !== canonicalJson(expectedAfterPolicy)) {
    deny('FINANCE_POLICY_CHANGED', 'Premium Finance switches or platform fee changed');
  }
  if (window?.integrity !== 'PASS' || !exactReconciliationsZero(reconciliationResults)) {
    deny('FINANCE_RECONCILIATION_FAILED', 'canonical finance reconciliation reported a mismatch');
  }
  const growth = {
    transactions: after.transactions.count - before.transactions.count,
    ledger_entries: after.ledger_entries.count - before.ledger_entries.count,
  };
  if (growth.transactions < 0 || growth.ledger_entries < 0 || canonicalJson(growth) !== canonicalJson(window.count_growth)) {
    deny('FINANCE_RECONCILIATION_FAILED', 'reported finance growth does not match complete snapshots');
  }
  if (requireNoFinancialMovement && (growth.transactions !== 0 || growth.ledger_entries !== 0
    || window.new_transaction_ids.length !== 0
    || window.preexisting_confirmed_after_snapshot.length !== 0)) {
    deny('FINANCE_MOVEMENT_DURING_POLICY_ACTIVATION', 'F4 activation requires a zero-movement finance window');
  }
  return {
    integrity: 'PASS',
    count_growth: growth,
    concurrent_activity: growth.transactions > 0 || window.preexisting_confirmed_after_snapshot.length > 0,
    ...(expectedBeforePolicy !== expectedAfterPolicy
      ? { policy_transition: { before: expectedBeforePolicy, after: expectedAfterPolicy } }
      : {}),
  };
}

export function verifyFinancePostcheckFromRaw({
  before,
  after,
  windowRows,
  reconciliationResults,
  expectedPolicy,
  expectedBeforePolicy = expectedPolicy,
  expectedAfterPolicy = expectedPolicy,
  requireNoFinancialMovement = false,
  releaseIdentity,
}) {
  if (!windowRows || windowRows.complete !== true
    || !Array.isArray(windowRows.transactions)
    || !Array.isArray(windowRows.ledger_entries)) {
    deny('INVALID_FINANCE_WINDOW', 'raw finance window rows are incomplete');
  }
  const window = classifyFinanceWindow({
    before,
    after,
    transactions: windowRows.transactions,
    ledgerEntries: windowRows.ledger_entries,
    releaseIdentity,
  });
  const finance = verifyFinancePostcheck({
    before,
    after,
    window,
    reconciliationResults,
    expectedPolicy,
    expectedBeforePolicy,
    expectedAfterPolicy,
    requireNoFinancialMovement,
  });
  return { finance, window };
}

function parseCliArguments(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`invalid CLI argument near ${flag ?? '<end>'}`);
    }
    values[flag.slice(2)] = value;
  }
  return { command, values };
}

function cliOutputSink(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)) throw new Error('invalid CLI runtime options');
  let current = value;
  let descriptor;
  while (current && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(current, 'write');
    current = Object.getPrototypeOf(current);
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function'
    || types.isProxy(descriptor.value)) throw new Error('invalid CLI runtime options');
  return Object.freeze({ write: descriptor.value.bind(value) });
}

function trustedCliRuntimeOptions(value) {
  if (value === undefined) return Object.freeze({
    now: () => new Date().toISOString(),
    stdout: cliOutputSink(process.stdout),
    stderr: cliOutputSink(process.stderr),
  });
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid CLI runtime options');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.length !== 3 || !['now', 'stdout', 'stderr'].every(key => Object.hasOwn(descriptors, key))
    || keys.some(key => !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) {
    throw new Error('invalid CLI runtime options');
  }
  const now = descriptors.now.value;
  if (typeof now !== 'function' || types.isProxy(now)) throw new Error('invalid CLI runtime options');
  return Object.freeze({
    now: () => {
      const sampled = now();
      if (typeof sampled !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(sampled)
        || !Number.isFinite(Date.parse(sampled)) || new Date(sampled).toISOString() !== sampled) {
        throw new Error('invalid CLI runtime options');
      }
      return sampled;
    },
    stdout: cliOutputSink(descriptors.stdout.value),
    stderr: cliOutputSink(descriptors.stderr.value),
  });
}

function printHelp(stdout) {
  stdout.write('Usage: nelyon-production-release.mjs <plan|revalidate|verify-gate|verify-dry-run|verify-pre-snapshot|verify-function-contract|postcheck|verify-recovery-source|postcheck-recovery|verify-admin-recovery-postcheck-chain|verify-admin-recovery-source|postcheck-admin-recovery|verify-admin-recovery-cloudflare-prestate> [options]\n');
}

// Protected controllers pass an already minted context and their fresh inventory
// directly in memory. No command-line flag or evidence JSON can supply either.
export async function runCli(argv, authorityContext, inventory, recoveryRuntime, suppliedRuntimeOptions) {
  const runtime = trustedCliRuntimeOptions(suppliedRuntimeOptions);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp(runtime.stdout);
    return 0;
  }
  const { command, values } = parseCliArguments(argv);
  if (command === 'verify-admin-recovery-postcheck-chain') {
    for (const required of ['policy', 'request', 'recovery-manifest', 'run', 'artifacts', 'release-bundle', 'gate-evidence', 'postcheck-recovery-evidence', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policyBytes = readFileSync(values.policy);
    const policy = loadPolicy(values.policy);
    const adapterPath = join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs');
    const result = verifyAdminRecoveryPostcheckChainProvenance({
      authorityContext, verifiedB2Source: recoveryRuntime?.verifiedSource,
      chainProvenance: recoveryRuntime?.chainProvenance,
      policy,
      policySha256: sha256Hex(policyBytes),
      recoveryRequest: JSON.parse(readFileSync(values.request, 'utf8')),
      recoveryManifest: JSON.parse(readFileSync(values['recovery-manifest'], 'utf8')),
      run: JSON.parse(readFileSync(values.run, 'utf8')),
      artifacts: JSON.parse(readFileSync(values.artifacts, 'utf8')),
      releaseBundle: { directory: resolve(values['release-bundle']) },
      gateEvidence: { directory: resolve(values['gate-evidence']) },
      recoveryEvidence: { directory: resolve(values['postcheck-recovery-evidence']) },
      adapterSourceSha256: sha256Hex(readFileSync(adapterPath)),
    });
    writeFileSync(resolve(values.output), canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`ADMIN RECOVERY POSTCHECK CHAIN VERIFIED ${result.recovery_run_id} ${result.source_run_id}\n`);
    return 0;
  }
  if (command === 'verify-admin-recovery-source') {
    for (const required of ['policy', 'request', 'recovery-manifest', 'run', 'artifacts', 'release-bundle', 'gate-evidence', 'admin-evidence', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const recoveryRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    const result = verifyAdminRecoverySourceProvenance({
      authorityContext, verifiedB2Source: recoveryRuntime?.verifiedSource,
      policy,
      recoveryRequest,
      recoveryManifest: JSON.parse(readFileSync(values['recovery-manifest'], 'utf8')),
      run: JSON.parse(readFileSync(values.run, 'utf8')),
      artifacts: JSON.parse(readFileSync(values.artifacts, 'utf8')),
      releaseBundle: { directory: resolve(values['release-bundle']) },
      gateEvidence: { directory: resolve(values['gate-evidence']) },
      adminEvidence: { directory: resolve(values['admin-evidence']) },
      postcheckRecoveryChain: recoveryRuntime?.postcheckRecoveryChain ?? (values['postcheck-recovery-chain']
        ? JSON.parse(readFileSync(values['postcheck-recovery-chain'], 'utf8'))
        : null),
    });
    writeFileSync(resolve(values.output), canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`ADMIN RECOVERY SOURCE VERIFIED ${result.source_run_id} ${result.source_manifest_sha256}\n`);
    return 0;
  }
  if (command === 'verify-admin-recovery-cloudflare-prestate') {
    for (const required of ['verified-source', 'previous', 'routes', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const result = verifyAdminRecoveryCloudflarePrestate({
      verifiedSource: recoveryRuntime?.verifiedSource ?? JSON.parse(readFileSync(values['verified-source'], 'utf8')),
      authorityContext,
      currentPrevious: JSON.parse(readFileSync(values.previous, 'utf8')),
      currentRoutes: JSON.parse(readFileSync(values.routes, 'utf8')),
    });
    writeFileSync(resolve(values.output), canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`ADMIN RECOVERY CLOUDFLARE PRESTATE VERIFIED ${result.active_version_id} ${result.routes_sha256}\n`);
    return 0;
  }
  if (command === 'postcheck-admin-recovery') {
    for (const required of ['policy', 'request', 'recovery-manifest', 'verified-source', 'current-snapshot', 'admin-manifest', 'build', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const recoveryRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(recoveryRequest, policy);
    const adapterPath = join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs');
    const result = verifyAdminRecoveryPostcheck({
      authorityContext, currentGate: recoveryRuntime?.currentGate,
      requestedAt: runtime.now(),
      policy,
      recoveryRequest,
      recoveryManifest: JSON.parse(readFileSync(values['recovery-manifest'], 'utf8')),
      verifiedSource: recoveryRuntime?.verifiedSource ?? JSON.parse(readFileSync(values['verified-source'], 'utf8')),
      currentEvidence: JSON.parse(readFileSync(values['current-snapshot'], 'utf8')),
      currentAdminManifest: JSON.parse(readFileSync(values['admin-manifest'], 'utf8')),
      currentBuild: JSON.parse(readFileSync(values.build, 'utf8')),
      adapterSourceSha256: sha256Hex(readFileSync(adapterPath)),
    });
    const bytes = canonicalJson(result);
    writeFileSync(resolve(values.output), bytes, { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`ADMIN RECOVERY POSTCHECK SUCCESS ${sha256Hex(bytes)}\n`);
    return 0;
  }
  if (command === 'verify-recovery-source') {
    for (const required of ['policy', 'recovery-source-run', 'run', 'artifacts', 'release-bundle', 'gate-evidence', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const source = policy.postcheck_recovery.approved_sources.find(item => item.run_id === values['recovery-source-run']);
    let authenticatedSource = null;
    if (!source && recoveryRuntime?.verifiedSource && recoveryRuntime?.recoveryProvenance) {
      const state = b2SourceState(recoveryRuntime.verifiedSource);
      if (!state.provenance.authorizationSha256 || state.provenance.policySha256 !== sha256Hex(readFileSync(values.policy))
        || state.publicSource.source_run_id !== values['recovery-source-run']
        || state.recoveryProvenance !== recoveryRuntime.recoveryProvenance) b2RecoveryReject();
      b2HistoricalSnapshotBinding({ verifiedSource: recoveryRuntime.verifiedSource, authorityContext });
      authenticatedSource = state.publicSource;
    }
    if (!source && !authenticatedSource) deny('INVALID_RECOVERY_SOURCE', 'requested recovery source is not approved by policy');
    const common = { releaseBundle: { directory: resolve(values['release-bundle']) },
      gateEvidence: { directory: resolve(values['gate-evidence']) } };
    const result = recoveryRuntime?.recoveryProvenance
      ? verifyRecoveryArtifactProvenance({ recoveryProvenance: recoveryRuntime.recoveryProvenance, ...common })
      : verifyRecoveryArtifactProvenance({ source,
        run: JSON.parse(readFileSync(values.run, 'utf8')),
        artifacts: JSON.parse(readFileSync(values.artifacts, 'utf8')),
        ...common });
    if (authenticatedSource && canonicalJson(result) !== canonicalJson(authenticatedSource)) b2RecoveryReject();
    writeFileSync(resolve(values.output), canonicalJson({ schema_version: 1, result: 'RECOVERY_SOURCE_VERIFIED', ...result }), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`RECOVERY SOURCE VERIFIED ${result.source_run_id} ${result.manifest_sha256}\n`);
    return 0;
  }
  if (command === 'postcheck-recovery') {
    for (const required of ['policy', 'request', 'recovery-manifest', 'verified-source', 'current-snapshot', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const recoveryRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    if (recoveryRuntime?.verifiedSource && authorityContext) {
      validateProtectedB2RecoveryRequest({ request: recoveryRequest, policy, policyBytes: readFileSync(values.policy),
        verifiedSource: recoveryRuntime.verifiedSource, authorityContext });
    } else validateRequest(recoveryRequest, policy);
    const verifiedSource = JSON.parse(readFileSync(values['verified-source'], 'utf8'));
    if (verifiedSource?.result !== 'RECOVERY_SOURCE_VERIFIED') {
      deny('RECOVERY_SOURCE_PROVENANCE_MISMATCH', 'verified source record is missing');
    }
    const adapterPath = join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs');
    const result = verifyPostcheckRecovery({
      authorityContext, verifiedSource: recoveryRuntime?.verifiedSource, currentGate: recoveryRuntime?.currentGate,
      requestedAt: runtime.now(),
      policy,
      recoveryRequest,
      recoveryManifest: JSON.parse(readFileSync(values['recovery-manifest'], 'utf8')),
      sourceManifest: verifiedSource.source_manifest,
      sourceObservation: verifiedSource.source_observation,
      currentEvidence: JSON.parse(readFileSync(values['current-snapshot'], 'utf8')),
      adapterSourceSha256: sha256Hex(readFileSync(adapterPath)),
    });
    const bytes = canonicalJson(result);
    writeFileSync(resolve(values.output), bytes, { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`POSTCHECK RECOVERY SUCCESS ${sha256Hex(bytes)}\n`);
    return 0;
  }
  if (command === 'verify-function-contract') {
    for (const required of ['manifest', 'function']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const manifest = JSON.parse(readFileSync(values.manifest, 'utf8'));
    const currentConfig = parseFunctionConfig(readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8'));
    const baselineConfig = parseFunctionConfig(execFileSync('git', [
      'show', `${manifest?.baseline?.sha}:supabase/config.toml`,
    ], { cwd: process.cwd(), env: gitChildEnvironment(), stdio: 'pipe', encoding: 'utf8' }));
    const graph = buildFunctionGraph(collectFunctionSources(join(process.cwd(), 'supabase', 'functions'), process.cwd()));
    const result = verifyFunctionContracts({
      manifest,
      graph,
      configBefore: baselineConfig,
      configAfter: currentConfig,
      functionName: values.function,
    });
    runtime.stdout.write(`FUNCTION CONTRACT VERIFIED ${result.functions[0].name} ${result.functions[0].source_sha256}\n`);
    return 0;
  }
  if (command === 'verify-pre-snapshot') {
    for (const required of ['policy', 'request', 'manifest', 'pre-snapshot', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(releaseRequest, policy);
    const manifest = JSON.parse(readFileSync(values.manifest, 'utf8'));
    const pre = JSON.parse(readFileSync(values['pre-snapshot'], 'utf8'));
    const adapterPath = join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs');
    const result = verifyProductionPreSnapshot({
      pre,
      policy,
      request: releaseRequest,
      manifest,
      adapterSourceSha256: sha256Hex(readFileSync(adapterPath)),
      authorityContext,
      requestedAt: runtime.now(),
    });
    if (manifest.resources?.web_control_centers_b2_transition) {
      writeFileSync(resolve(values.output), canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
      runtime.stdout.write('B2 PRE SNAPSHOT VERIFIED\n');
      return 0;
    }
    writeFileSync(resolve(values.output), canonicalJson({ schema_version: 1, ...result }), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`PRODUCTION BASELINE VERIFIED ${result.evidence_sha256}\n`);
    return 0;
  }
  if (command === 'verify-dry-run') {
    for (const required of ['input', 'manifest', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const manifest = JSON.parse(readFileSync(values.manifest, 'utf8'));
    const verified = verifyMigrationDryRun({ text: readFileSync(values.input, 'utf8'), manifest });
    const result = { schema_version: 1, result: 'MIGRATION_DRY_RUN_VERIFIED', ...verified };
    writeFileSync(resolve(values.output), canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`MIGRATION DRY RUN VERIFIED ${verified.pending_versions.length}\n`);
    return 0;
  }
  if (command === 'revalidate-b2-recovery' || command === 'revalidate-b2-admin-recovery') {
    for (const required of ['policy', 'request', 'bundle', 'compiler-sha256', 'remote-evidence', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policyBytes = readFileSync(values.policy);
    const policy = loadPolicy(values.policy);
    const request = JSON.parse(readFileSync(values.request, 'utf8'));
    if (!recoveryRuntime?.verifiedSource) b2RecoveryReject();
    const admin = command === 'revalidate-b2-admin-recovery';
    if (admin) {
      validateRequest(request, policy);
      const state = b2SourceState(recoveryRuntime.verifiedSource);
      if (request.mode !== 'admin_recovery' || !state.provenance.authorizationSha256
        || state.provenance.policySha256 !== sha256Hex(policyBytes)
        || !recoveryRuntime.adminVerifiedSource
        || b2SourceState(recoveryRuntime.adminVerifiedSource) !== state
        || recoveryRuntime.adminVerifiedSource.source_run_id !== String(request.recoverySourceRunId)) b2RecoveryReject();
      b2HistoricalSnapshotBinding({ verifiedSource: recoveryRuntime.adminVerifiedSource, authorityContext });
    } else validateProtectedB2RecoveryRequest({ request, policy, policyBytes,
      verifiedSource: recoveryRuntime.verifiedSource, authorityContext });
    const digest = readFileSync(join(resolve(values.bundle), 'manifest.sha256'), 'utf8').trim();
    const verified = verifyManifestBundle({ directory: resolve(values.bundle), expected: {
      approvedSha: request.approvedSha, compilerSha256: values['compiler-sha256'],
      environmentName: policy.environment.name, manifestDigest: digest, releaseId: request.releaseId,
      runAttempt: request.runAttempt, runId: request.runId,
    } });
    let receipt;
    if (admin) {
      if (verified.manifest.result !== 'NO PRODUCTIVE CHANGES' || canonicalJson(verified.manifest.blockers) !== canonicalJson([])
        || verified.manifest.delta?.productive_change_count !== 0
        || canonicalJson(verified.manifest.resources) !== canonicalJson({ config_changed: false, function_contracts: [], functions: [], migrations: [] })
        || verified.manifest.recovery?.source_run_id !== String(request.recoverySourceRunId)) b2RecoveryReject();
      receipt = publicAuthorityReceipt(authorityContext);
    } else receipt = verifyPendingB2RecoveryAuthority({ request, policy, policyBytes, manifest: verified.manifest,
      verifiedSource: recoveryRuntime.verifiedSource, authorityContext });
    const gitState = resolveGitState({ cwd: process.cwd(), baselineSha: policy.baseline.sha,
      approvedSha: request.approvedSha, expectedRepository: policy.repository,
      runGit: args => execFileSync('git', args, { cwd: process.cwd(), env: gitChildEnvironment(),
        stdio: 'pipe', encoding: args.includes('-z') ? 'buffer' : 'utf8' }) });
    const evidence = JSON.parse(readFileSync(values['remote-evidence'], 'utf8'));
    if (evidence.compiler?.sha256 !== sha256Hex(readFileSync(join(process.cwd(), 'scripts', 'nelyon-production-release.mjs')))
      || evidence.compiler?.snapshot_adapter_sha256 !== sha256Hex(readFileSync(join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs')))
      || canonicalJson(evidence.gitState?.changes ?? []) !== canonicalJson(gitState.changes)
      || canonicalJson(evidence.runtimeClosure) !== canonicalJson(verified.manifest.runtime_closure)) {
      deny('POST_APPROVAL_DRIFT', 'protected recovery source or compiler differs from the approved plan');
    }
    const pending = admin ? undefined : parsePendingB2RecoveryRequest(request, policy);
    const regenerated = buildManifest({ ...evidence, request, policy, gitState, pendingB2Recovery: pending });
    if (canonicalJson(regenerated) !== canonicalJson(verified.manifest)) deny('POST_APPROVAL_DRIFT', 'protected recovery plan changed');
    writeFileSync(resolve(values.output), canonicalJson({ schema_version: 1, result: 'REVALIDATED',
      manifest_sha256: digest, approved_sha: request.approvedSha, authorityReceipt: receipt }), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`REVALIDATED ${digest}\n`);
    return 0;
  }
  if (command === 'revalidate' || command === 'preflight-release') {
    for (const required of ['policy', 'request', 'bundle', 'compiler-sha256', 'remote-evidence', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(releaseRequest, policy);
    const initialDigest = readFileSync(join(resolve(values.bundle), 'manifest.sha256'), 'utf8').trim();
    const initialBundle = verifyManifestBundle({ directory: resolve(values.bundle), expected: {
      approvedSha: releaseRequest.approvedSha, compilerSha256: values['compiler-sha256'],
      environmentName: policy.environment.name, manifestDigest: initialDigest, releaseId: releaseRequest.releaseId,
      runAttempt: releaseRequest.runAttempt, runId: releaseRequest.runId,
    } });
    if (command === 'preflight-release' && releaseRequest.mode !== 'release') b2AuthorityReject();
    const authorityProof = (command === 'preflight-release' ? verifyB2PreflightAuthority : verifyB2ProtectedAuthority)({ manifest: initialBundle.manifest,
      authorityContext, inventory, requestedAt: runtime.now() });
    const gitState = resolveGitState({
      cwd: process.cwd(),
      baselineSha: policy.baseline.sha,
      approvedSha: releaseRequest.approvedSha,
      expectedRepository: policy.repository,
      runGit: args => execFileSync('git', args, { cwd: process.cwd(), env: gitChildEnvironment(),
        stdio: 'pipe', encoding: args.includes('-z') ? 'buffer' : 'utf8' }),
    });
    const evidence = JSON.parse(readFileSync(values['remote-evidence'], 'utf8'));
    if (isB2Delta(gitState.changes)) {
      const localEvidence = compileLocalEvidence({ cwd: process.cwd(), policy, request: releaseRequest,
        generatedAt: evidence.generatedAt });
      for (const key of ['b2Release', 'functionContracts', 'affectedFunctions', 'migrations']) {
        if (canonicalJson(localEvidence[key]) !== canonicalJson(evidence[key])) b2Reject();
      }
    }
    const currentCompilerSha256 = sha256Hex(readFileSync(join(process.cwd(), 'scripts', 'nelyon-production-release.mjs')));
    const currentAdapterSha256 = sha256Hex(readFileSync(join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs')));
    if (evidence.compiler?.sha256 !== currentCompilerSha256
      || evidence.compiler?.snapshot_adapter_sha256 !== currentAdapterSha256) {
      deny('POST_APPROVAL_DRIFT', 'release compiler or snapshot adapter bytes differ from the approved plan');
    }
    if (canonicalJson(evidence.gitState?.changes ?? []) !== canonicalJson(gitState.changes)) {
      deny('POST_APPROVAL_DRIFT', 'regenerated Git delta differs from the approved plan');
    }
    const regenerated = buildManifest({ ...evidence, request: releaseRequest, policy, gitState });
    const digest = readFileSync(join(resolve(values.bundle), 'manifest.sha256'), 'utf8').trim();
    const verified = verifyManifestBundle({
      directory: resolve(values.bundle),
      expected: {
        approvedSha: releaseRequest.approvedSha,
        compilerSha256: values['compiler-sha256'],
        environmentName: policy.environment.name,
        manifestDigest: digest,
        releaseId: releaseRequest.releaseId,
        runAttempt: releaseRequest.runAttempt,
        runId: releaseRequest.runId,
      },
    });
    if (canonicalJson(regenerated) !== canonicalJson(verified.manifest)) {
      deny('POST_APPROVAL_DRIFT', 'regenerated manifest differs from the approved artifact');
    }
    const result = { schema_version: 1, result: command === 'preflight-release' ? 'RELEASE_PREFLIGHT_VERIFIED' : 'REVALIDATED', manifest_sha256: digest, approved_sha: releaseRequest.approvedSha,
      ...authorityProof };
    writeFileSync(resolve(values.output), canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`${result.result} ${digest}\n`);
    return 0;
  }
  if (command === 'postcheck') {
    for (const required of ['policy', 'request', 'manifest', 'pre-snapshot', 'post-snapshot', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(releaseRequest, policy);
    const manifest = JSON.parse(readFileSync(values.manifest, 'utf8'));
    const beforeEvidence = JSON.parse(readFileSync(values['pre-snapshot'], 'utf8'));
    const afterEvidence = JSON.parse(readFileSync(values['post-snapshot'], 'utf8'));
    const adapterPath = join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs');
    const remote = verifyProductionSnapshotPair({
      pre: beforeEvidence,
      post: afterEvidence,
      policy,
      request: releaseRequest,
      manifest,
      adapterSourceSha256: sha256Hex(readFileSync(adapterPath)),
      authorityContext,
      requestedAt: runtime.now(),
    });
    const beforeTransactions = new Map(beforeEvidence.finance.transactions.items.map(item => [item.id, item]));
    const beforeLedger = new Set(beforeEvidence.finance.ledger_entries.items.map(item => item.id));
    const windowRows = {
      complete: true,
      transactions: afterEvidence.finance.transactions.items.filter(item => (
        !beforeTransactions.has(item.id)
        || canonicalJson(beforeTransactions.get(item.id)) !== canonicalJson(item)
      )),
      ledger_entries: afterEvidence.finance.ledger_entries.items.filter(item => !beforeLedger.has(item.id)),
    };
    const f4Activation = manifest?.resources?.finance_authority_transition?.to_phase === 'f4_general';
    const f5Autonomous = manifest?.resources?.finance_authority_transition?.to_phase === 'f5_autonomous';
    const publicFinancePolicy = value => ({
      platform_fee_bps: value.platform_fee_bps,
      purchase_enabled: value.purchase_enabled,
      refunds_enabled: value.refunds_enabled,
      subscription_enabled: value.subscription_enabled,
    });
    const financeVerification = verifyFinancePostcheckFromRaw({
      before: beforeEvidence.finance,
      after: afterEvidence.finance,
      windowRows,
      reconciliationResults: afterEvidence.finance.reconciliation,
      expectedPolicy: policy.supabase.finance_policy,
      ...(f4Activation ? {
        expectedBeforePolicy: publicFinancePolicy(policy.finance_authority_f4_transition.from_policy),
        expectedAfterPolicy: publicFinancePolicy(policy.finance_authority_f4_transition.to_policy),
        requireNoFinancialMovement: true,
      } : f5Autonomous ? {
        expectedBeforePolicy: publicFinancePolicy(policy.finance_authority_f5_transition.finance_policy),
        expectedAfterPolicy: publicFinancePolicy(policy.finance_authority_f5_transition.finance_policy),
        requireNoFinancialMovement: true,
      } : {}),
      releaseIdentity: {
        releaseId: releaseRequest.releaseId,
        runId: String(releaseRequest.runId),
        runAttempt: releaseRequest.runAttempt,
      },
    });
    if (manifest.resources?.web_control_centers_b2_transition) {
      writeFileSync(resolve(values.output), canonicalJson(remote), { encoding: 'utf8', flag: 'wx' });
      runtime.stdout.write('B2 POSTCHECK VERIFIED\n');
      return 0;
    }
    const result = {
      schema_version: 1,
      result: 'SUCCESS',
      release_id: releaseRequest.releaseId,
      approved_sha: releaseRequest.approvedSha,
      remote_postcheck_sha256: sha256Hex(canonicalJson(remote)),
      remote,
      finance: financeVerification.finance,
      finance_window_sha256: sha256Hex(canonicalJson(financeVerification.window)),
    };
    const bytes = canonicalJson(result);
    writeFileSync(resolve(values.output), bytes, { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`POSTCHECK SUCCESS ${sha256Hex(bytes)}\n`);
    return 0;
  }
  if (command === 'verify-b2-recovery-gate' || command === 'verify-b2-admin-recovery-gate') {
    for (const required of ['policy', 'policy-sha256', 'request', 'bundle', 'compiler-sha256', 'environment',
      'branch-policies', 'approvals', 'runs', 'auto-deploy-expected', 'revalidated', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    if (!recoveryRuntime?.verifiedSource) b2RecoveryReject();
    const policyBytes = readFileSync(values.policy);
    const policySha256 = verifyPolicyDigest({ policyBytes, expectedSha256: values['policy-sha256'] });
    const policy = loadPolicy(values.policy);
    const request = JSON.parse(readFileSync(values.request, 'utf8'));
    const admin = command === 'verify-b2-admin-recovery-gate';
    if (admin) {
      validateRequest(request, policy);
      const state = b2SourceState(recoveryRuntime.verifiedSource);
      if (request.mode !== 'admin_recovery' || !state.provenance.authorizationSha256
        || state.provenance.policySha256 !== sha256Hex(policyBytes)
        || !recoveryRuntime.adminVerifiedSource
        || b2SourceState(recoveryRuntime.adminVerifiedSource) !== state
        || recoveryRuntime.adminVerifiedSource.source_run_id !== String(request.recoverySourceRunId)) b2RecoveryReject();
      b2HistoricalSnapshotBinding({ verifiedSource: recoveryRuntime.adminVerifiedSource, authorityContext });
    } else validateProtectedB2RecoveryRequest({ request, policy, policyBytes,
      verifiedSource: recoveryRuntime.verifiedSource, authorityContext });
    const digest = readFileSync(join(resolve(values.bundle), 'manifest.sha256'), 'utf8').trim();
    const bundle = verifyManifestBundle({ directory: resolve(values.bundle), expected: {
      approvedSha: request.approvedSha, compilerSha256: values['compiler-sha256'],
      environmentName: policy.environment.name, manifestDigest: digest, releaseId: request.releaseId,
      runAttempt: request.runAttempt, runId: request.runId,
    } });
    let receipt;
    if (admin) {
      if (bundle.manifest.result !== 'NO PRODUCTIVE CHANGES' || canonicalJson(bundle.manifest.blockers) !== canonicalJson([])
        || bundle.manifest.delta?.productive_change_count !== 0
        || canonicalJson(bundle.manifest.resources) !== canonicalJson({ config_changed: false, function_contracts: [], functions: [], migrations: [] })
        || bundle.manifest.recovery?.source_run_id !== String(request.recoverySourceRunId)) b2RecoveryReject();
      receipt = publicAuthorityReceipt(authorityContext);
      requiredSecretsForMode('admin_recovery', recoveryRuntime.operationSecrets);
    } else receipt = verifyPendingB2RecoveryAuthority({ request, policy, policyBytes, manifest: bundle.manifest,
      verifiedSource: recoveryRuntime.verifiedSource, authorityContext });
    const revalidated = JSON.parse(readFileSync(values.revalidated, 'utf8'));
    b2Exact(revalidated, ['schema_version', 'result', 'manifest_sha256', 'approved_sha', 'authorityReceipt']);
    if (revalidated.schema_version !== 1 || revalidated.result !== 'REVALIDATED'
      || revalidated.manifest_sha256 !== digest || revalidated.approved_sha !== request.approvedSha) b2RecoveryReject();
    assertAuthorityReceiptMatch(receipt, revalidated.authorityReceipt);
    const gitState = resolveGitState({ cwd: process.cwd(), baselineSha: policy.baseline.sha,
      approvedSha: request.approvedSha, expectedRepository: policy.repository,
      runGit: args => execFileSync('git', args, { cwd: process.cwd(), env: gitChildEnvironment(),
        stdio: 'pipe', encoding: args.includes('-z') ? 'buffer' : 'utf8' }) });
    const files = gitState.changes.map(change => ({ file_type: change.fileType ?? null, path: change.path, status: change.status }))
      .sort((left, right) => `${left.path}:${left.status}`.localeCompare(`${right.path}:${right.status}`));
    if (canonicalJson(files) !== canonicalJson(bundle.manifest.delta?.files)
      || bundle.manifest.compiler?.sha256 !== sha256Hex(readFileSync(join(process.cwd(), 'scripts', 'nelyon-production-release.mjs')))
      || bundle.manifest.compiler?.snapshot_adapter_sha256 !== sha256Hex(readFileSync(join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs')))) {
      deny('POST_APPROVAL_DRIFT', 'protected recovery checkout differs from the verified plan');
    }
    const environment = JSON.parse(readFileSync(values.environment, 'utf8'));
    verifyEnvironmentSnapshot({ environment, branchPolicies: JSON.parse(readFileSync(values['branch-policies'], 'utf8')),
      expected: { id: policy.environment.id, name: policy.environment.name, owner: policy.owner,
        branch: policy.environment.protected_branch, authorizationMode: policy.environment.authorization_mode ?? 'manual' } });
    const autoDeployExpectation = verifyAutoDeployExpectation({ declaration: values['auto-deploy-expected'], policy: policy.auto_deploy });
    const approvals = JSON.parse(readFileSync(values.approvals, 'utf8'));
    let approvalToken = null;
    if ((policy.environment.authorization_mode ?? 'manual') === 'automatic') {
      verifyAutomaticAuthorizationHistory({ approvals, expectedRunId: request.runId, expectedRunAttempt: request.runAttempt });
    } else {
      approvalToken = buildApprovalToken({ mode: request.mode, runId: request.runId, runAttempt: request.runAttempt,
        environmentId: environment.id, environmentName: environment.name, releaseId: request.releaseId,
        approvedSha: request.approvedSha, manifestDigest: digest });
      verifyApprovalHistory({ approvals, expectedToken: approvalToken, owner: policy.owner, environmentId: environment.id,
        environmentName: environment.name, expectedRunId: request.runId, expectedRunAttempt: request.runAttempt });
    }
    verifyConcurrency({ runs: JSON.parse(readFileSync(values.runs, 'utf8')), currentRunId: request.runId });
    const proof = { schema_version: 1, result: 'GATE_VERIFIED', run_id: request.runId, run_attempt: request.runAttempt,
      environment: { id: environment.id, name: environment.name }, release_id: request.releaseId,
      approved_sha: request.approvedSha, policy_sha256: policySha256, manifest_sha256: digest,
      authorization_mode: policy.environment.authorization_mode ?? 'manual', auto_deploy_expectation: autoDeployExpectation,
      approval_token_sha256: approvalToken ? sha256Hex(approvalToken) : null, authorityReceipt: receipt };
    writeFileSync(resolve(values.output), canonicalJson(proof), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`GATE VERIFIED ${digest}\n`);
    return 0;
  }
  if (command === 'verify-gate' || command === 'authorize-refresh') {
    for (const required of ['policy', 'policy-sha256', 'request', 'bundle', 'compiler-sha256', 'environment', 'branch-policies', 'approvals', 'runs', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policySha256 = verifyPolicyDigest({
      policyBytes: readFileSync(values.policy),
      expectedSha256: values['policy-sha256'],
    });
    const policy = loadPolicy(values.policy);
    const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(releaseRequest, policy);
    const digest = readFileSync(join(resolve(values.bundle), 'manifest.sha256'), 'utf8').trim();
    const verifiedBundle = verifyManifestBundle({
      directory: resolve(values.bundle),
      expected: {
        approvedSha: releaseRequest.approvedSha,
        compilerSha256: values['compiler-sha256'],
        environmentName: policy.environment.name,
        manifestDigest: digest,
        releaseId: releaseRequest.releaseId,
        runAttempt: releaseRequest.runAttempt,
        runId: releaseRequest.runId,
      },
    });
    if (command === 'authorize-refresh' && releaseRequest.mode !== 'release') b2AuthorityReject();
    const authorityProof = (command === 'authorize-refresh' ? verifyB2PreflightAuthority : verifyB2ProtectedAuthority)({ manifest: verifiedBundle.manifest,
      authorityContext, inventory, requestedAt: runtime.now() });
    if (verifiedBundle.manifest.compiler?.sha256 !== sha256Hex(readFileSync(join(process.cwd(), 'scripts', 'nelyon-production-release.mjs')))
      || verifiedBundle.manifest.compiler?.snapshot_adapter_sha256 !== sha256Hex(readFileSync(join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs')))) {
      deny('ARTIFACT_PROVENANCE_MISMATCH', 'current release authority bytes differ from the approved artifact');
    }
    const environment = JSON.parse(readFileSync(values.environment, 'utf8'));
    const branchPolicies = JSON.parse(readFileSync(values['branch-policies'], 'utf8'));
    verifyEnvironmentSnapshot({
      environment,
      branchPolicies,
      expected: {
        id: policy.environment.id,
        name: policy.environment.name,
        owner: policy.owner,
        branch: policy.environment.protected_branch,
        authorizationMode: policy.environment.authorization_mode ?? 'manual',
      },
    });
    const autoDeployExpectation = verifyAutoDeployExpectation({
      declaration: values['auto-deploy-expected'],
      policy: policy.auto_deploy,
    });
    const approvals = JSON.parse(readFileSync(values.approvals, 'utf8'));
    const authorizationMode = policy.environment.authorization_mode ?? 'manual';
    let approvalToken = null;
    if (authorizationMode === 'automatic') {
      verifyAutomaticAuthorizationHistory({
        approvals,
        expectedRunId: releaseRequest.runId,
        expectedRunAttempt: releaseRequest.runAttempt,
      });
    } else {
      approvalToken = buildApprovalToken({
        mode: releaseRequest.mode,
        runId: releaseRequest.runId,
        runAttempt: releaseRequest.runAttempt,
        environmentId: environment.id,
        environmentName: environment.name,
        releaseId: releaseRequest.releaseId,
        approvedSha: releaseRequest.approvedSha,
        manifestDigest: verifiedBundle.digest,
      });
      verifyApprovalHistory({
        approvals,
        expectedToken: approvalToken,
        owner: policy.owner,
        environmentId: environment.id,
        environmentName: environment.name,
        expectedRunId: releaseRequest.runId,
        expectedRunAttempt: releaseRequest.runAttempt,
      });
    }
    verifyConcurrency({
      runs: JSON.parse(readFileSync(values.runs, 'utf8')),
      currentRunId: releaseRequest.runId,
    });
    if (command !== 'authorize-refresh') requiredSecretsForMode(releaseRequest.mode,
      ['release', 'admin_recovery'].includes(releaseRequest.mode) ? process.env : {});
    const proof = {
      schema_version: 1,
      result: command === 'authorize-refresh' ? 'READ_ONLY_REFRESH_AUTHORIZED' : 'GATE_VERIFIED',
      ...(command === 'authorize-refresh' ? { supabase_access: 'read_only_inventory' } : {}),
      run_id: releaseRequest.runId,
      run_attempt: releaseRequest.runAttempt,
      environment: { id: environment.id, name: environment.name },
      release_id: releaseRequest.releaseId,
      approved_sha: releaseRequest.approvedSha,
      policy_sha256: policySha256,
      manifest_sha256: verifiedBundle.digest,
      authorization_mode: authorizationMode,
      auto_deploy_expectation: autoDeployExpectation,
      approval_token_sha256: approvalToken ? sha256Hex(approvalToken) : null,
      ...authorityProof,
    };
    writeFileSync(resolve(values.output), canonicalJson(proof), { encoding: 'utf8', flag: 'wx' });
    runtime.stdout.write(`${command === 'authorize-refresh' ? proof.result : 'GATE VERIFIED'} ${verifiedBundle.digest}\n`);
    return 0;
  }
  if (command !== 'plan') throw new Error(`command ${command} is not implemented yet`);
  for (const required of ['policy', 'request', 'history', 'output']) {
    if (!values[required]) throw new Error(`missing --${required}`);
  }
  const policy = loadPolicy(values.policy);
  const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
  let evidence = values['remote-evidence']
    ? JSON.parse(readFileSync(values['remote-evidence'], 'utf8'))
    : compileLocalEvidence({ cwd: process.cwd(), policy, request: releaseRequest });
  if (!isReadOnlyRecoveryMode(releaseRequest.mode)
    && (evidence.b2Release !== undefined || isB2Delta(evidence.gitState?.changes))) {
    b2Exact(evidence, ['b2Release', 'affectedFunctions', 'functionContracts', 'migrations', 'gitState',
      'classified', 'reproducibility', 'risk', 'runtimeClosure', 'compiler', 'generatedAt']);
    const { b2Release, ...parts } = evidence;
    evidence = { b2Release: projectB2ReleaseEvidence(b2Release, policy), ...projectB2EvidenceParts(parts) };
  }
  const history = JSON.parse(readFileSync(values.history, 'utf8'));
  let pendingB2Recovery;
  try { validateRequest(releaseRequest, policy); }
  catch (error) {
    if (error?.code !== 'INVALID_RECOVERY_SOURCE' || releaseRequest.mode !== 'postcheck_recovery') throw error;
    pendingB2Recovery = parsePendingB2RecoveryRequest(releaseRequest, policy);
  }
  if (pendingB2Recovery || releaseRequest.mode === 'admin_recovery') {
    const repositoryRoot = resolve(process.cwd());
    evidence = { ...evidence, runtimeClosure: buildPrivateRuntimeClosure({ repositoryRoot, readFile: absolutePath => {
      const member = relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
      if (!member || member.startsWith('../') || isAbsolute(member)) b2Reject();
      return execFileSync('git', ['show', `${releaseRequest.approvedSha}:${member}`], {
        cwd: repositoryRoot, env: gitChildEnvironment(), stdio: 'pipe',
      });
    } }) };
  }
  validateReleaseHistory({ releaseId: releaseRequest.releaseId, pages: history, policy });
  const manifest = buildManifest({ ...evidence, request: releaseRequest, policy, pendingB2Recovery });
  if (values['evidence-output']) writeFileSync(resolve(values['evidence-output']), canonicalJson(evidence), { encoding: 'utf8', flag: 'wx' });
  const bundle = writeManifestBundle({ manifest, outputDirectory: resolve(values.output) });
  runtime.stdout.write(`${manifest.result} ${bundle.digest}\n`);
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    error => {
      if (error instanceof GateDeniedError) {
        process.stderr.write(`DENY ${error.code}: ${error.message}\n`);
        process.exitCode = 2;
      } else {
        process.stderr.write(`ERROR: ${error.message}\n`);
        process.exitCode = 1;
      }
    },
  );
}
