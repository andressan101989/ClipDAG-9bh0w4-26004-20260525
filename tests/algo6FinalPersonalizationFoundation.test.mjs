import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_algo6_personalization_foundation.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';
const serviceUrl = new URL('../services/personalizationService.ts', import.meta.url);
const onboardingUrl = new URL('../app/onboarding/personalization.tsx', import.meta.url);
const service = existsSync(serviceUrl) ? readFileSync(serviceUrl, 'utf8') : '';
const onboarding = existsSync(onboardingUrl) ? readFileSync(onboardingUrl, 'utf8') : '';
const gate = readFileSync(new URL('../components/feature/PersonalizationGate.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const login = readFileSync(new URL('../app/login.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../app/settings.tsx', import.meta.url), 'utf8');
const semanticWorker = readFileSync(
  new URL('../supabase/functions/video-semantic-index/index.ts', import.meta.url),
  'utf8',
) + readFileSync(
  new URL('../supabase/functions/video-semantic-index/embeddingPipeline.mjs', import.meta.url),
  'utf8',
);

test('foundation is one CLI-named migration with exactly three personalization tables', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migrationNames[0], /^\d{14}_algo6_personalization_foundation\.sql$/);
  const tables = [...migrationSql.matchAll(/create\s+table\s+private\.([a-z0-9_]+)/gi)]
    .map(match => match[1])
    .filter(name => name.includes('personalization'));
  assert.deepEqual(tables.sort(), [
    'personalization_interest_taxonomy',
    'user_personalization_interests',
    'user_personalization_profiles',
  ]);
  assert.doesNotMatch(migrationSql, /behavior(?:al)?_(?:events|ledger|interests)|user_(?:semantic_)?vector/i);
});

test('all personalization authorities are private, FORCE RLS, and browser-table inaccessible', () => {
  for (const table of [
    'personalization_interest_taxonomy',
    'user_personalization_profiles',
    'user_personalization_interests',
  ]) {
    assert.match(migrationSql, new RegExp(`alter table private\\.${table} enable row level security`, 'i'));
    assert.match(migrationSql, new RegExp(`alter table private\\.${table} force row level security`, 'i'));
    assert.match(migrationSql, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated`, 'i'));
  }
});

test('taxonomy uses safe stable hierarchy, localized labels, and canonical BGE-M3 vectors', () => {
  for (const slug of [
    'sports', 'music', 'movies_tv', 'comedy', 'technology', 'gaming',
    'cars_motorsport', 'food', 'travel', 'fashion_style', 'fitness_wellness',
    'beauty', 'art_design', 'science_education', 'pets_nature',
    'business_entrepreneurship', 'football_soccer', 'reggaeton',
    'artificial_intelligence', 'formula_one', 'street_food',
  ]) assert.match(migrationSql, new RegExp(`'${slug}'`, 'i'));
  for (const locale of ['es', 'en', 'pt', 'fr']) {
    assert.match(migrationSql, new RegExp(`'${locale}'`, 'i'));
  }
  assert.match(migrationSql, /cloudflare_workers_ai/i);
  assert.match(migrationSql, /@cf\/baai\/bge-m3/i);
  assert.match(migrationSql, /vector\s*\(\s*1024\s*\)/i);
  assert.match(migrationSql, /minor_safe/i);
  assert.match(migrationSql, /ads_eligible/i);
  assert.doesNotMatch(migrationSql,
    /political|religion|sexual_orientation|race|ethnicity|medical_condition|criminal_history|union_membership/i);
});

test('authenticated onboarding RPC contract is narrow and service embedding RPCs are bounded', () => {
  for (const fn of [
    'get_my_personalization_onboarding_v1',
    'get_personalization_onboarding_catalog_v1',
    'save_my_personalization_preferences_v1',
    'complete_my_personalization_onboarding_v1',
    'get_my_onboarding_creator_recommendations_v1',
  ]) {
    assert.match(migrationSql, new RegExp(`function public\\.${fn}\\(`, 'i'));
    assert.match(migrationSql, new RegExp(`grant execute on function public\\.${fn}\\([^;]*\\) to authenticated`, 'i'));
  }
  for (const fn of [
    'claim_personalization_taxonomy_embedding_jobs_v1',
    'complete_personalization_taxonomy_embedding_job_v1',
    'fail_personalization_taxonomy_embedding_job_v1',
  ]) {
    assert.match(migrationSql, new RegExp(`function public\\.${fn}\\(`, 'i'));
    assert.match(migrationSql, new RegExp(`grant execute on function public\\.${fn}\\([^;]*\\) to service_role`, 'i'));
  }
  assert.match(migrationSql, /between 1 and 25/i);
  assert.match(migrationSql, /preferences_updated_at/i);
  assert.match(migrationSql, /private\.user_age_eligibility/i);
  assert.match(migrationSql, /public\.follows/i);
  assert.match(migrationSql, /public\.blocked_users/i);
});

test('client has one server-backed four-step onboarding and editable settings path', () => {
  assert.ok(existsSync(serviceUrl));
  assert.ok(existsSync(onboardingUrl));
  for (const name of [
    'getPersonalizationOnboarding', 'getPersonalizationCatalog',
    'savePersonalizationPreferences', 'completePersonalizationOnboarding',
    'getOnboardingCreatorRecommendations',
  ]) assert.match(service, new RegExp(name));
  assert.match(onboarding, /currentStep|step/i);
  assert.match(onboarding, /primaryLanguage|additionalLanguages/i);
  assert.match(onboarding, /contentRegion/i);
  assert.match(onboarding, /selectedParent|selectedInterest/i);
  assert.match(onboarding, /selectedCreator/i);
  assert.match(layout, /PersonalizationGate|personalization/i);
  assert.match(gate, /awaitingAuthenticatedCheck/);
  assert.match(gate, /router\.replace\('\/onboarding\/personalization'\)/);
  assert.match(gate, /Fail open/i);
  assert.match(login, /onboarding\/personalization/i);
  assert.match(settings, /Personalizaci[oó]n del feed|personalization/i);
});

test('existing semantic worker owns taxonomy mode and no second embedding function exists', () => {
  assert.match(semanticWorker, /process_taxonomy/i);
  assert.match(semanticWorker, /claim_personalization_taxonomy_embedding_jobs_v1/i);
  assert.match(semanticWorker, /complete_personalization_taxonomy_embedding_job_v1/i);
  const semanticFunctionDirs = readdirSync(new URL('../supabase/functions/', import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /semantic|embedding/i.test(entry.name))
    .map(entry => entry.name);
  assert.deepEqual(semanticFunctionDirs, ['video-semantic-index']);
});
