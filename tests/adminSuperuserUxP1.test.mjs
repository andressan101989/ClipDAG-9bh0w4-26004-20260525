import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const migration=readFileSync(new URL("../supabase/migrations/20260916121530_admin_superuser_ux_content_finance_p1.sql",import.meta.url),"utf8");

test("content detail exposes explicit canonical media authority in priority order",()=>{
  for(const field of ["media_kind","media_url","playback_url","poster_url","media_origin","media_asset_id","video_asset_id"]){
    assert.match(migration,new RegExp(`'${field}'`));
  }
  assert.ok(migration.indexOf("canonical_stream")<migration.indexOf("canonical_r2"));
  assert.match(migration,/video_asset_links[\s\S]*provider = 'cloudflare_stream'[\s\S]*status = 'ready'/);
  assert.match(migration,/media_asset_links[\s\S]*provider = 'r2'[\s\S]*status = 'ready'/);
  assert.match(migration,/legacy_video_url/);
});

test("platform balance and fixed USD equivalence are calculated server-side from canonical accounts",()=>{
  assert.match(migration,/platform_balance_summary/);
  assert.match(migration,/owner_id is null/);
  assert.match(migration,/account_type in \('platform', 'marketplace_ads_revenue'\)/);
  assert.match(migration,/v_bdag_balance \* 0\.01::numeric/);
  assert.match(migration,/'usd_per_bdag', 0\.01::numeric/);
});

test("UX projection migration performs no finance or media data mutation",()=>{
  assert.doesNotMatch(migration,/\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:ledger_|financial_|wallet|settlement|videos|media_assets|video_assets)/i);
  assert.doesNotMatch(migration,/create\s+table/i);
  assert.match(migration,/admin_require_capability\('content\.items\.read'\)/);
  assert.match(migration,/admin_require_capability\('finance\.ledger\.read'\)/);
  assert.match(migration,/set search_path = ''/);
});
