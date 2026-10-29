import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  advisorExceptionsForPhase,
  F5_SECURITY_ADVISOR_RELATION_ADDITIONS,
  normalizedCronCommandSha256,
  FINANCE_POLICY_DIGESTS,
  normalizeCronCommand,
  projectCronBaselineItems,
  projectProductionBaselineFinance,
  verifyProductionPreSnapshot,
  verifyProductionRecoverySnapshot,
  verifyProductionSnapshotPair,
  verifyCronSnapshotTransition,
  verifyRecoveryInfrastructureBaseline,
} from './nelyon-production-snapshot-adapter.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
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

export const STORIES_QA_C1_RELEASE_TRANSITION = Object.freeze({"id":"stories-v2-qa-c1-question-answer-v1","from_phase":"stories_v2_safety_c2_publish_first_async_review","to_phase":"stories_v2_qa_c1_question_answer","baseline_sha":"c1c3043b24abe898a4400f858d646a2f788ee201","reviewed_source_sha":"351be882a7939be86cd9a758a78e8d514e9c5e2f","integration_base_sha":"10c549ac0dd84d28ccd832264184619ec56ba97f","approved_sha_ancestry":"verified_integration_base","migration_path":"supabase/migrations/20261029042807_stories_v2_qa_c1_question_answer_authority.sql","migration_blob":"b1f025b12f6d4e9fadf178630ee0e46c283bbd1c","migration_sha256":"7bd4afded4f6e0b36fa702c1eb83eedfed42f7b502ee9e2f97ada7121a1cf73c","migration_byte_length":24537,"productive_paths":["supabase/migrations/20261029042807_stories_v2_qa_c1_question_answer_authority.sql"],"functions":[],"config_changed":false,"helper_attestations":[{"identity":"private.story_validate_composition(jsonb)","definition_sha256":"2d16a92c6a3dd33fe85d96e14578917922be5ab68f5fe0e9c235e7c81b1b6069","owner":"postgres","volatility":"i","security_definer":false,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":false,"public":false,"service_role":false}},{"identity":"private.story_author_text_bundle_c1_v1(uuid)","definition_sha256":"28e76f502eaae19a0e74f43a96edaf29571088868e5f19fed31caf0547c52af0","owner":"postgres","volatility":"s","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":false,"public":false,"service_role":false}},{"identity":"private.story_question_answer_source_qa_c1_v1(uuid,uuid,uuid)","definition_sha256":"123f625492ac7a6b1c9480a8a1b3798a3ac6f18a895b2872c2ad01d334eadea5","owner":"postgres","volatility":"s","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":false,"public":false,"service_role":false}},{"identity":"public.prepare_story_question_answer(uuid,uuid,uuid)","definition_sha256":"8c9cf9f018d577e93c82354307bb0d6e8d0503c3a548c8fed66ad216a4d285d3","owner":"postgres","volatility":"s","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb)","definition_sha256":"4d1bfef144382ae5a67a5d1b665a1f64a559d4a45cba93aadd3b8399cf65afbd","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"private.story_check_question_answer_link_qa_c1_v1()","definition_sha256":"e4e1a93d081cf53680b5eb54c593c92d35b48bf1dc2c2bc842f1ab9b13d5470d","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":false,"public":false,"service_role":false}},{"identity":"public.create_story_with_media(uuid,jsonb,uuid)","definition_sha256":"0b204e2add3b8f2c38b29b6f1e7f33e661783abb2cdf8838d8172d54184fb3d1","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"public.create_story_with_media(uuid,jsonb,uuid,jsonb)","definition_sha256":"0171be4b3d51e3746fee472eea356306e0decbdb5d7dce35770b727a8e75901e","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"public.create_story_from_content(uuid,jsonb,uuid)","definition_sha256":"fa070316fdf7fd91770d711fefd4248c0286164899dfdcc20fbf58f1e9a78413","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}},{"identity":"public.create_story_from_content(uuid,jsonb,uuid,jsonb)","definition_sha256":"1876897fd6665ed9528acb3306ecbc41d81111599753359bfa6d882cccf84a89","owner":"postgres","volatility":"v","security_definer":true,"search_path":["search_path=\"\""],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false}}],"c2_helper_replacements":["private.story_author_text_bundle_c1_v1(uuid)","public.create_story_with_media(uuid,jsonb,uuid)","public.create_story_with_media(uuid,jsonb,uuid,jsonb)","public.create_story_from_content(uuid,jsonb,uuid)","public.create_story_from_content(uuid,jsonb,uuid,jsonb)"],"rpc_replacements":["public.create_story_with_media(uuid,jsonb,uuid)","public.create_story_with_media(uuid,jsonb,uuid,jsonb)","public.create_story_from_content(uuid,jsonb,uuid)","public.create_story_from_content(uuid,jsonb,uuid,jsonb)"],"rpc_predecessor_exception":{"advisor_fingerprint":"010c78c43ba2cb32439c48ef8433d2706776f45f128fc2aa0572eb3b15377a14","advisor_type":"authenticated_security_definer_function_executable","advisor_severity":"WARN","object":{"schema":"public","name":"create_story_from_content","argument_types":["uuid","jsonb","uuid"],"identity_arguments":"p_video_id uuid, p_composition jsonb, p_client_story_id uuid"},"attestation":{"security_definer":true,"owner":"postgres","search_path":["search_path=\"\""],"acl":[{"grantee":"authenticated","privilege_type":"EXECUTE","is_grantable":false},{"grantee":"postgres","privilege_type":"EXECUTE","is_grantable":false}],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false},"definition_sha256":"82632e1f2b891ff7e435ad4d5e80186fdf78a64b1092d549d8ab4863eb78f4fe"},"authorization":{"functional_reason":"Exposes a bounded authenticated Stories operation while retaining ownership, visibility, expiry, idempotency, moderation, and rate-limit checks server-side.","controls":["authenticated_session","domain_authority_checks","negative_authorization_tests","server_side_validation"],"negative_test_evidence_sha256":"b55e754403fdfc3b225270e105741e3dbb397817148e64c5a37cd76794b9465b"},"origin":{"migration":"20261027191918_stories_v2_safety_c2_publish_first_async_review","migration_blob":"a621158297c9d75b56fe739f1c7dd72c8b786c97","source_sha":"244d458bb55b73782f4e7a32004b764ce622702e"},"technical_approval":"verified"},"relation_attestation":{"schema":"private","name":"story_question_answer_links","owner":"postgres","rls_enabled":true,"force_rls":true,"policy_count":0,"realtime_membership_count":0,"acl":[{"grantee":"postgres","privilege_type":"DELETE","is_grantable":false},{"grantee":"postgres","privilege_type":"INSERT","is_grantable":false},{"grantee":"postgres","privilege_type":"MAINTAIN","is_grantable":false},{"grantee":"postgres","privilege_type":"REFERENCES","is_grantable":false},{"grantee":"postgres","privilege_type":"SELECT","is_grantable":false},{"grantee":"postgres","privilege_type":"TRIGGER","is_grantable":false},{"grantee":"postgres","privilege_type":"TRUNCATE","is_grantable":false},{"grantee":"postgres","privilege_type":"UPDATE","is_grantable":false}],"columns":[{"position":1,"name":"story_id","type":"uuid","not_null":true,"default":null},{"position":2,"name":"source_story_id","type":"uuid","not_null":true,"default":null},{"position":3,"name":"source_element_id","type":"uuid","not_null":true,"default":null},{"position":4,"name":"respondent_id","type":"uuid","not_null":true,"default":null},{"position":5,"name":"request_hash","type":"text","not_null":true,"default":null},{"position":6,"name":"created_at","type":"timestamp with time zone","not_null":true,"default":"clock_timestamp()"}],"constraints":[{"name":"story_question_answer_links_pkey","type":"p","definition":"PRIMARY KEY (story_id)","columns":["story_id"],"valid":true,"deferrable":false,"initially_deferred":false},{"name":"story_question_answer_links_request_hash_check","type":"c","definition":"CHECK (request_hash ~ '^[a-f0-9]{64}$'::text)","columns":["request_hash"],"valid":true,"deferrable":false,"initially_deferred":false},{"name":"story_question_answer_links_source_story_id_source_element_fkey","type":"f","definition":"FOREIGN KEY (source_story_id, source_element_id, respondent_id) REFERENCES private.story_interactive_responses(story_id, element_id, respondent_id) ON DELETE CASCADE","columns":["source_story_id","source_element_id","respondent_id"],"referenced_relation":"private.story_interactive_responses","referenced_columns":["story_id","element_id","respondent_id"],"update_action":"a","delete_action":"c","valid":true,"deferrable":false,"initially_deferred":false},{"name":"story_question_answer_links_story_id_fkey","type":"f","definition":"FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE","columns":["story_id"],"referenced_relation":"public.stories","referenced_columns":["id"],"update_action":"a","delete_action":"c","valid":true,"deferrable":false,"initially_deferred":false}],"indexes":[{"name":"story_question_answer_links_pkey","definition":"CREATE UNIQUE INDEX story_question_answer_links_pkey ON private.story_question_answer_links USING btree (story_id)","columns":["story_id"],"unique":true,"primary":true,"valid":true,"ready":true,"predicate":null,"expression":null},{"name":"story_question_answer_links_source","definition":"CREATE INDEX story_question_answer_links_source ON private.story_question_answer_links USING btree (source_story_id, source_element_id, respondent_id)","columns":["source_story_id","source_element_id","respondent_id"],"unique":false,"primary":false,"valid":true,"ready":true,"predicate":null,"expression":null}]},"trigger_attestation":{"name":"story_question_answer_link_required","table":"public.stories","function_identity":"private.story_check_question_answer_link_qa_c1_v1()","definition_sha256":"b0566debb8aa63ccc3de2c3733fb6ea4191fa580191206747e5a7fc468440ebf","tgtype":21,"enabled":"O","internal":false,"deferrable":true,"initially_deferred":true},"security_advisor":{"provider":{"source":"supabase/splinter","commit":"fccca4b1c4d8b48b8ccd69bd6b30e84adcb92975","sql_sha256":"d8d558baad3e03832e521c527907fa50a9a172fabd899dd0f5c2504a5a0e9349"},"normalized_digest":"b32e3e37e5776d90e73b1ee67ce79e74362f892ec84470cbb2b3b24f33c5c36d","introduced_exceptions":[{"advisor_fingerprint":"9cf89de2d5c962441f655087f8b3e5e89f2e7d6d94ce4196b48bd41bee29790a","advisor_type":"authenticated_security_definer_function_executable","advisor_severity":"WARN","object":{"schema":"public","name":"prepare_story_question_answer","argument_types":["uuid","uuid","uuid"],"identity_arguments":"p_source_story_id uuid, p_source_element_id uuid, p_respondent_id uuid"},"attestation":{"security_definer":true,"owner":"postgres","search_path":["search_path=\"\""],"acl":[{"grantee":"authenticated","privilege_type":"EXECUTE","is_grantable":false},{"grantee":"postgres","privilege_type":"EXECUTE","is_grantable":false}],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false},"definition_sha256":"8c9cf9f018d577e93c82354307bb0d6e8d0503c3a548c8fed66ad216a4d285d3"},"authorization":{"functional_reason":"Read-only authenticated preflight revalidates private question ownership and lifecycle server-side.","controls":["authenticated_session","negative_authorization_tests","owner_binding","read_only"],"negative_test_evidence_sha256":"5b13d971dcdcba94075d7bf8e7715e98cec2daac9c55e324611f27ec71689f66"},"origin":{"migration":"20261029042807_stories_v2_qa_c1_question_answer_authority","migration_blob":"b1f025b12f6d4e9fadf178630ee0e46c283bbd1c","source_sha":"351be882a7939be86cd9a758a78e8d514e9c5e2f"},"technical_approval":"verified"},{"advisor_fingerprint":"2195e746b4232e0a54f1fbb9fdd51dc4d87014ec20c4b8d6a6bd8b05bbc25d39","advisor_type":"authenticated_security_definer_function_executable","advisor_severity":"WARN","object":{"schema":"public","name":"create_story_question_answer_with_media","argument_types":["uuid","uuid","uuid","uuid","jsonb","uuid","jsonb"],"identity_arguments":"p_source_story_id uuid, p_source_element_id uuid, p_respondent_id uuid, p_asset_id uuid, p_composition jsonb, p_client_story_id uuid, p_interactive_definitions jsonb"},"attestation":{"security_definer":true,"owner":"postgres","search_path":["search_path=\"\""],"acl":[{"grantee":"authenticated","privilege_type":"EXECUTE","is_grantable":false},{"grantee":"postgres","privilege_type":"EXECUTE","is_grantable":false}],"execute":{"anon":false,"authenticated":true,"public":false,"service_role":false},"definition_sha256":"4d1bfef144382ae5a67a5d1b665a1f64a559d4a45cba93aadd3b8399cf65afbd"},"authorization":{"functional_reason":"Atomic authenticated QA publication reuses the canonical media, safety and publish-first authority.","controls":["authenticated_session","atomic_transaction","negative_authorization_tests","owner_binding"],"negative_test_evidence_sha256":"5b13d971dcdcba94075d7bf8e7715e98cec2daac9c55e324611f27ec71689f66"},"origin":{"migration":"20261029042807_stories_v2_qa_c1_question_answer_authority","migration_blob":"b1f025b12f6d4e9fadf178630ee0e46c283bbd1c","source_sha":"351be882a7939be86cd9a758a78e8d514e9c5e2f"},"technical_approval":"verified"},{"advisor_fingerprint":"3428d19b7577fa13fcae7ea23166d7053b98ce34804fcc5ac6f66d2339c80c64","advisor_type":"table","advisor_severity":"INFO","object":{"schema":"private","name":"story_question_answer_links"},"attestation":{"owner":"postgres","rls_enabled":true,"force_rls":true,"acl":[{"grantee":"postgres","privilege_type":"DELETE","is_grantable":false},{"grantee":"postgres","privilege_type":"INSERT","is_grantable":false},{"grantee":"postgres","privilege_type":"MAINTAIN","is_grantable":false},{"grantee":"postgres","privilege_type":"REFERENCES","is_grantable":false},{"grantee":"postgres","privilege_type":"SELECT","is_grantable":false},{"grantee":"postgres","privilege_type":"TRIGGER","is_grantable":false},{"grantee":"postgres","privilege_type":"TRUNCATE","is_grantable":false},{"grantee":"postgres","privilege_type":"UPDATE","is_grantable":false}]},"authorization":{"functional_reason":"Private forced-RLS provenance is owner-only and mediated by bounded server RPCs.","controls":["force_rls","negative_authorization_tests","owner_only_acl","private_schema"],"negative_test_evidence_sha256":"5b13d971dcdcba94075d7bf8e7715e98cec2daac9c55e324611f27ec71689f66"},"origin":{"migration":"20261029042807_stories_v2_qa_c1_question_answer_authority","migration_blob":"b1f025b12f6d4e9fadf178630ee0e46c283bbd1c","source_sha":"351be882a7939be86cd9a758a78e8d514e9c5e2f"},"technical_approval":"verified"}]},"safety":{"activation":true,"owner_approved_operating_model":true,"owner_approved_policy":false,"mode":"PUBLISH_FIRST_ASYNC_REVIEW","automatic_allow_authorized":false,"automatic_block_authorized":false,"numeric_thresholds":null,"historical_backfill":false},"finance_policy":{"platform_fee_bps":2000,"purchase_enabled":true,"refunds_enabled":true,"subscription_enabled":true},"requires_separate_baseline_promotion":true});

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
const EXACT_MODES = ['plan_only', 'gate_proof', 'release', 'postcheck_recovery'];
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
    plan_only: 'PLAN_ONLY',
    gate_proof: 'GATE_PROOF_NO_MUTATION',
    release_standard: 'RELEASE_STANDARD',
    release_high_risk: 'RELEASE_HIGH_RISK',
    postcheck_recovery: 'POSTCHECK_RECOVERY_READ_ONLY',
  };
  if (canonicalJson(confirmations) !== canonicalJson(expectedConfirmations)) {
    deny('INVALID_POLICY_CONFIRMATIONS', 'scope confirmations do not match');
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
  return null;
}

export function validateRequest(request, policy) {
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
    const source = policy.postcheck_recovery.approved_sources.find(item => (
      item.run_id === String(request.recoverySourceRunId ?? '')
    ));
    if (!source) deny('INVALID_RECOVERY_SOURCE', 'recovery source run is not an exact approved authority');
  } else if (request.recoverySourceRunId !== undefined && request.recoverySourceRunId !== null) {
    deny('INVALID_RECOVERY_SOURCE', 'recovery source run is valid only for postcheck recovery');
  }
  return Object.freeze({ ...request });
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
  if (mode === 'postcheck_recovery') return { migrations, attestation: null };
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
  if (mode === 'postcheck_recovery') return { migrations, attestation: null };
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
  if (mode === 'postcheck_recovery') return { migrations, attestation: null };
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
  if (mode === 'postcheck_recovery') return { migrations, attestation: null };
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
  if (mode === 'postcheck_recovery') return { migrations, attestation: null };
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

export function attestFinanceAuthorityTransition({ mode, policy, approvedSha, changes, migrations, affectedFunctions, runGit, cwd }) {
  if (mode === 'postcheck_recovery') return { migrations, attestation: null };
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
    if (path === '.github/nelyon-production-release-policy.json'
      || path === '.github/workflows/nelyon-production-release.yml'
      || path === 'scripts/nelyon-production-release.mjs'
      || path === 'scripts/nelyon-production-snapshot-adapter.mjs') {
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

export function compileLocalEvidence({ cwd, policy, request, generatedAt = new Date().toISOString() }) {
  const runGit = args => execFileSync('git', args, { cwd, encoding: args.includes('-z') ? 'buffer' : 'utf8' });
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
    migrations: storiesQaC1Transition.migrations,
    managedScopeTransition: transitionEvidence.attestation,
    financeAuthorityTransition: financeTransition.attestation,
    storiesB1Transition: storiesB1Transition.attestation,
    storiesSafetyC1Transition: storiesSafetyC1Transition.attestation,
    storiesSafetyC2Transition: storiesSafetyC2Transition.attestation,
    storiesQaC1Transition: storiesQaC1Transition.attestation,
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
  affectedFunctions,
  functionContracts,
  reproducibility,
  risk,
  compiler,
  generatedAt,
}) {
  validateRequest(request, policy);
  const recoveryMode = request.mode === 'postcheck_recovery';
  if (!risk || !['STANDARD', 'HIGH'].includes(risk.level) || !Array.isArray(risk.findings)) {
    deny('INVALID_RISK_CLASSIFICATION', 'manifest risk classification is incomplete');
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
  const blockers = [...(reproducibility?.findings ?? []), ...baselineBlockers]
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
    },
    risk: stableCopy(risk),
    blockers,
    compiler: {
      path: compiler.path,
      sha256: compiler.sha256,
      snapshot_adapter_path: compiler.snapshot_adapter_path,
      snapshot_adapter_sha256: compiler.snapshot_adapter_sha256,
    },
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
  'gate-proof.json',
  'migration-dry-run.json',
  'postcheck-result.json',
  'pre-function-revalidation.json',
  'pre-migration-revalidation.json',
  'pre-snapshot-verification.json',
  'revalidation.json',
  'release-observation.json',
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

export function verifyRecoveryArtifactProvenance({ source, run, artifacts, releaseBundle, gateEvidence }) {
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

  const manifestBytes = readFileSync(join(bundleDirectory, 'manifest.json'), 'utf8');
  const actualManifestSha256 = sha256Hex(Buffer.from(manifestBytes, 'utf8'));
  const claimedManifestSha256 = readFileSync(join(bundleDirectory, 'manifest.sha256'), 'utf8').trim();
  if (actualManifestSha256 !== source.manifest_sha256
    || claimedManifestSha256 !== actualManifestSha256
    || !/^[0-9a-f]{64}$/.test(claimedManifestSha256)) {
    deny(code, 'source manifest bytes do not match the approved digest');
  }
  const manifest = readFixedJson(bundleDirectory, 'manifest.json', code);
  if (canonicalJson(manifest) !== manifestBytes) deny(code, 'source manifest is not canonical');
  const sourceRequest = readFixedJson(releaseDirectory, 'request.json', code);
  const observation = readFixedJson(gateDirectory, 'release-observation.json', code);
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
  return {
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
}

export function verifyPostcheckRecovery({
  policy,
  recoveryRequest,
  recoveryManifest,
  sourceManifest,
  sourceObservation,
  currentEvidence,
  adapterSourceSha256,
}) {
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
  if (['40166468648', '40268500711', '40324910390', '40473092474'].includes(source.run_id)) {
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

  const advisorItems = currentEvidence.cron_security.advisors.items;
  const recoveryExceptions = advisorExceptionsForPhase(policy, recoveryManifest, 'recovery', {
    request: recoveryRequest,
    migrations: currentEvidence.migrations,
  });
  const exceptionFingerprints = new Set(recoveryExceptions.map(item => item.advisor_fingerprint));
  const exceptionByFingerprint = new Map(recoveryExceptions.map(item => [item.advisor_fingerprint, item]));
  const presentExceptions = advisorItems.filter(item => exceptionFingerprints.has(item.fingerprint));
  const baselineItems = advisorItems.filter(item => !exceptionFingerprints.has(item.fingerprint));
  const storiesB1Recovery = source.run_id === '40473092474';
  const storiesAdvisorTransition = storiesB1Recovery
    ? policy?.stories_b1_transition?.security_advisor
    : null;
  const removedStoriesFindings = storiesB1Recovery
    ? storiesAdvisorTransition?.removed_findings?.map(item => ({
      fingerprint: item.fingerprint,
      level: item.level,
      resource_kind: item.resource_kind,
    }))
    : [];
  if (storiesB1Recovery && (!Array.isArray(storiesAdvisorTransition?.introduced_exceptions)
    || storiesAdvisorTransition.introduced_exceptions.length !== 15
    || !Array.isArray(removedStoriesFindings) || removedStoriesFindings.length !== 2
    || removedStoriesFindings.some(item => advisorItems.some(current => current.fingerprint === item.fingerprint)))) {
    deny(code, 'Stories B1 Advisor transition is incomplete or a replaced finding is still present');
  }
  const reconstructedBaselineItems = [...baselineItems, ...removedStoriesFindings]
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  let baselineCronItems = currentEvidence.cron_security.cron.items;
  const postF5Recovery = ['40324910390', '40473092474'].includes(source.run_id);
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
    deny(code, 'current Security Advisor set is not the historical baseline plus the exact approved exceptions');
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
    expectedPolicy: ['40268500711', '40324910390', '40473092474'].includes(source.run_id)
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
  if (mode !== 'release') deny('INVALID_MODE', 'unsupported release mode');
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

function printHelp() {
  process.stdout.write('Usage: nelyon-production-release.mjs <plan|revalidate|verify-gate|verify-dry-run|verify-pre-snapshot|verify-function-contract|postcheck|verify-recovery-source|postcheck-recovery> [options]\n');
}

async function runCli(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return 0;
  }
  const { command, values } = parseCliArguments(argv);
  if (command === 'verify-recovery-source') {
    for (const required of ['policy', 'recovery-source-run', 'run', 'artifacts', 'release-bundle', 'gate-evidence', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const source = policy.postcheck_recovery.approved_sources.find(item => item.run_id === values['recovery-source-run']);
    if (!source) deny('INVALID_RECOVERY_SOURCE', 'requested recovery source is not approved by policy');
    const result = verifyRecoveryArtifactProvenance({
      source,
      run: JSON.parse(readFileSync(values.run, 'utf8')),
      artifacts: JSON.parse(readFileSync(values.artifacts, 'utf8')),
      releaseBundle: { directory: resolve(values['release-bundle']) },
      gateEvidence: { directory: resolve(values['gate-evidence']) },
    });
    writeFileSync(resolve(values.output), canonicalJson({ schema_version: 1, result: 'RECOVERY_SOURCE_VERIFIED', ...result }), { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`RECOVERY SOURCE VERIFIED ${result.source_run_id} ${result.manifest_sha256}\n`);
    return 0;
  }
  if (command === 'postcheck-recovery') {
    for (const required of ['policy', 'request', 'recovery-manifest', 'verified-source', 'current-snapshot', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const recoveryRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(recoveryRequest, policy);
    const verifiedSource = JSON.parse(readFileSync(values['verified-source'], 'utf8'));
    if (verifiedSource?.result !== 'RECOVERY_SOURCE_VERIFIED') {
      deny('RECOVERY_SOURCE_PROVENANCE_MISMATCH', 'verified source record is missing');
    }
    const adapterPath = join(process.cwd(), 'scripts', 'nelyon-production-snapshot-adapter.mjs');
    const result = verifyPostcheckRecovery({
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
    process.stdout.write(`POSTCHECK RECOVERY SUCCESS ${sha256Hex(bytes)}\n`);
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
    ], { cwd: process.cwd(), encoding: 'utf8' }));
    const graph = buildFunctionGraph(collectFunctionSources(join(process.cwd(), 'supabase', 'functions'), process.cwd()));
    const result = verifyFunctionContracts({
      manifest,
      graph,
      configBefore: baselineConfig,
      configAfter: currentConfig,
      functionName: values.function,
    });
    process.stdout.write(`FUNCTION CONTRACT VERIFIED ${result.functions[0].name} ${result.functions[0].source_sha256}\n`);
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
    });
    writeFileSync(resolve(values.output), canonicalJson({ schema_version: 1, ...result }), { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`PRODUCTION BASELINE VERIFIED ${result.evidence_sha256}\n`);
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
    process.stdout.write(`MIGRATION DRY RUN VERIFIED ${verified.pending_versions.length}\n`);
    return 0;
  }
  if (command === 'revalidate') {
    for (const required of ['policy', 'request', 'bundle', 'compiler-sha256', 'remote-evidence', 'output']) {
      if (!values[required]) throw new Error(`missing --${required}`);
    }
    const policy = loadPolicy(values.policy);
    const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
    validateRequest(releaseRequest, policy);
    const gitState = resolveGitState({
      cwd: process.cwd(),
      baselineSha: policy.baseline.sha,
      approvedSha: releaseRequest.approvedSha,
      expectedRepository: policy.repository,
      runGit: args => execFileSync('git', args, { cwd: process.cwd(), encoding: args.includes('-z') ? 'buffer' : 'utf8' }),
    });
    const evidence = JSON.parse(readFileSync(values['remote-evidence'], 'utf8'));
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
    const result = { schema_version: 1, result: 'REVALIDATED', manifest_sha256: digest, approved_sha: releaseRequest.approvedSha };
    writeFileSync(resolve(values.output), canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`REVALIDATED ${digest}\n`);
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
    process.stdout.write(`POSTCHECK SUCCESS ${sha256Hex(bytes)}\n`);
    return 0;
  }
  if (command === 'verify-gate') {
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
    requiredSecretsForMode(releaseRequest.mode, releaseRequest.mode === 'release' ? process.env : {});
    const proof = {
      schema_version: 1,
      result: 'GATE_VERIFIED',
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
    };
    writeFileSync(resolve(values.output), canonicalJson(proof), { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`GATE VERIFIED ${verifiedBundle.digest}\n`);
    return 0;
  }
  if (command !== 'plan') throw new Error(`command ${command} is not implemented yet`);
  for (const required of ['policy', 'request', 'history', 'output']) {
    if (!values[required]) throw new Error(`missing --${required}`);
  }
  const policy = loadPolicy(values.policy);
  const releaseRequest = JSON.parse(readFileSync(values.request, 'utf8'));
  const evidence = values['remote-evidence']
    ? JSON.parse(readFileSync(values['remote-evidence'], 'utf8'))
    : compileLocalEvidence({ cwd: process.cwd(), policy, request: releaseRequest });
  if (values['evidence-output']) writeFileSync(resolve(values['evidence-output']), canonicalJson(evidence), { encoding: 'utf8', flag: 'wx' });
  const history = JSON.parse(readFileSync(values.history, 'utf8'));
  validateRequest(releaseRequest, policy);
  validateReleaseHistory({ releaseId: releaseRequest.releaseId, pages: history, policy });
  const manifest = buildManifest({ ...evidence, request: releaseRequest, policy });
  const bundle = writeManifestBundle({ manifest, outputDirectory: resolve(values.output) });
  process.stdout.write(`${manifest.result} ${bundle.digest}\n`);
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
