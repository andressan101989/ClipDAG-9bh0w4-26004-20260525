import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260923214108_ads_v2_plr_1_age_eligibility_readiness.sql';
const sql = fs.readFileSync(migrationPath, 'utf8');
const api = fs.readFileSync('apps/business-web/src/lib/adsManagerApi.ts', 'utf8');
const ui = fs.readFileSync('apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx', 'utf8');

test('PLR-1 reuses the canonical age authority and materializes only unknown legacy state', () => {
  assert.match(sql, /private\.age_eligibility_policy/);
  assert.match(sql, /private\.user_age_eligibility/);
  assert.match(sql, /private\.age_classify_dob\(p_date_of_birth\)/);
  assert.match(sql, /private\.ads_actor_is_advertiser_age_eligible\(v_actor\)/);
  assert.match(sql, /insert into private\.user_age_eligibility[\s\S]*'unknown_legacy'[\s\S]*'legacy_unknown'[\s\S]*from auth\.users as users/i);
  assert.doesNotMatch(sql, /create table/i);
  assert.doesNotMatch(sql, /(add column|create table)[\s\S]{0,120}date_of_birth/i);
});

test('PLR-1 exposes self-only read and one-time remediation RPCs', () => {
  assert.match(sql, /create or replace function public\.get_my_age_eligibility\(\)/i);
  assert.match(sql, /create or replace function public\.remediate_my_age_eligibility\(\s*p_date_of_birth text/i);
  assert.doesNotMatch(sql, /get_my_age_eligibility\s*\(\s*p_/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /if v_existing\.status <> 'unknown_legacy'/i);
  assert.match(sql, /source = 'legacy_remediation'/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /grant execute on function public\.get_my_age_eligibility\(\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.remediate_my_age_eligibility\(text\) to authenticated/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]{0,120}to anon/i);
});

test('Business Ads uses canonical self RPCs without retaining DOB or calculating age authority', () => {
  assert.match(api, /get_my_age_eligibility/);
  assert.match(api, /remediate_my_age_eligibility/);
  assert.match(ui, /Confirm your age to continue with advertising\./);
  assert.match(ui, /type="date"/);
  assert.doesNotMatch(`${api}\n${ui}`, /localStorage|sessionStorage|date_of_birth.*console|service_role/);
  assert.doesNotMatch(ui, /getFullYear|Date\.now\(\).*18|age_band\s*=/);
});

test('PLR-1 does not change Ads delivery, finance, targeting or operational authorities', () => {
  assert.doesNotMatch(sql, /update\s+private\.advertising_(delivery|finance|targeting|event)_policy/i);
  assert.doesNotMatch(sql, /insert\s+into\s+private\.advertising_/i);
  assert.doesNotMatch(sql, /financial_transactions|ledger_entries|marketplace_ad_/i);
});
