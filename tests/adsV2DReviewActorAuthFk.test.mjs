import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const matches = readdirSync(migrationsDir).filter((name) =>
  name.endsWith("_ads_v2_d_fix_review_actor_auth_fk.sql"),
);

test("has exactly one narrowly scoped corrective migration", () => {
  assert.equal(matches.length, 1, "expected one ADS-V2-D actor FK correction");
});

test("moves review actor identity from profiles to auth users without cascade", () => {
  const sql = readFileSync(join(migrationsDir, matches[0]), "utf8");

  assert.match(
    sql,
    /alter table private\.advertising_ad_review_events\s+drop constraint advertising_ad_review_events_actor_user_id_fkey/i,
  );
  assert.match(
    sql,
    /alter table private\.advertising_ad_review_events\s+add constraint advertising_ad_review_events_actor_user_id_fkey\s+foreign key\s*\(actor_user_id\)\s+references auth\.users\s*\(id\)\s+on delete restrict/i,
  );
  assert.doesNotMatch(sql, /references public\.user_profiles/i);
  assert.doesNotMatch(sql, /on delete cascade/i);

  assert.equal((sql.match(/\balter table\b/gi) ?? []).length, 2);
  assert.equal((sql.match(/\bdrop constraint\b/gi) ?? []).length, 1);
  assert.equal((sql.match(/\badd constraint\b/gi) ?? []).length, 1);
  assert.doesNotMatch(sql, /\b(?:create table|create function|insert into|update\s+private\.|delete from|truncate)\b/i);
});
