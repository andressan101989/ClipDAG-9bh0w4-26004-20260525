import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_ads_v2_personalization_targeting_v4.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';

test('Ads V4 is one CLI-named migration extending the existing audience authority', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migrationNames[0], /^\d{14}_ads_v2_personalization_targeting_v4\.sql$/);
  assert.match(migrationSql, /nelyon-ads-targeting-v4/i);
  assert.match(migrationSql, /private\.advertising_audiences/i);
  assert.match(migrationSql, /private\.advertising_audience_versions/i);
  assert.match(migrationSql, /create table private\.advertising_interest_targets/i);
  assert.doesNotMatch(migrationSql,
    /create table private\.(?:advertising_user_interest_profile|ads_user_vector|advertising_audiences_v4)/i);
});

test('V3 stays immutable/deliverable and no campaign is rewritten into V4', () => {
  assert.match(migrationSql, /nelyon-ads-targeting-v3/i);
  assert.doesNotMatch(migrationSql, /update\s+private\.advertising_audience_versions[\s\S]*definition/i);
  assert.doesNotMatch(migrationSql, /update\s+private\.advertising_campaigns[\s\S]*(?:audience|target)/i);
  assert.doesNotMatch(migrationSql, /delete\s+from\s+private\.advertising_/i);
});

test('Ads V4 reuses safe taxonomy, adult consent, language and broad region only', () => {
  assert.match(migrationSql, /private\.personalization_interest_taxonomy/i);
  assert.match(migrationSql, /ads_eligible/i);
  assert.match(migrationSql, /minor_safe/i);
  assert.match(migrationSql, /ads_personalization_consent/i);
  assert.match(migrationSql, /private\.user_age_eligibility/i);
  assert.match(migrationSql, /language/i);
  assert.match(migrationSql, /content_region_code|country/i);
  assert.match(migrationSql, /interest_targeting_enabled/i);
  assert.match(migrationSql, /behavioral_targeting_enabled/i);
  assert.match(migrationSql, /v_has_interest_targets[\s\S]*v_traits->>'eligible'/i);
  assert.match(migrationSql, /minors can[\s\S]*never match an interest audience/i);
  assert.match(migrationSql, /precise_viewer_location_matching_enabled[^;]*false/i);
  assert.doesNotMatch(migrationSql,
    /(?:from|join)\s+(?:public|private)\.(?:financial_transactions|ledger_entries|ledger_accounts|wallets)|\bgps\b|\blatitude\b|\blongitude\b|raw_watch|video_views\.video_id/i);
});

test('sensitive or unknown interests fail closed and private traits are not advertiser output', () => {
  assert.match(migrationSql, /unknown_interest|invalid_interest|interest_not_ads_eligible/i);
  assert.match(migrationSql, /sensitive_targeting_allowed[^;]*false/i);
  assert.doesNotMatch(migrationSql,
    /political|religion|sexual_orientation|race|ethnicity|medical_condition|criminal_history|union_membership/i);
  assert.doesNotMatch(migrationSql, /jsonb_build_object\s*\([^;]*(?:'embedding'|'watch_history'|'video_ids')/i);
});
