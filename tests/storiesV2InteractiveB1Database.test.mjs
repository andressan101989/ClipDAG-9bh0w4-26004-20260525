import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter(name => name.endsWith('_stories_v2_interactive_b1.sql'));
const sql = files.length === 1 ? readFileSync(new URL(files[0], dir), 'utf8') : '';

test('B1 ships exactly one forward migration', () => assert.equal(files.length, 1));
for (const table of ['story_interactive_elements', 'story_interactive_responses', 'story_analytics_events', 'story_safety_state', 'story_operation_policy']) {
  test(`${table} has private forced RLS and no client DML`, () => {
    assert.match(sql, new RegExp(`create table private\\.${table}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on (?:table )?private\\.${table} from public, anon, authenticated, service_role`, 'i'));
  });
}
test('revision invalidations contain no respondent, content, answers, or totals', () => {
  const body = sql.match(/create table public\.story_interactive_revisions\s*\(([\s\S]*?)\n\);/i)?.[1];
  assert.ok(body);
  assert.doesNotMatch(body, /respondent|response|question|answer|total|config|payload/i);
  assert.match(body, /revision bigint/);
});
for (const name of ['respond_to_story_element', 'get_story_interactive_state', 'get_story_interactive_results', 'moderate_story_question', 'record_story_event']) {
  test(`${name} is an authenticated fixed-path API`, () => {
    const body = sql.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0];
    assert.ok(body);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path (?:to|=) ''/i);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated, service_role`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^;]+to authenticated`, 'i'));
  });
}
test('shared authorities remain canonical and no policy is activated', () => {
  assert.match(sql, /public\.check_velocity_limit\(/);
  assert.match(sql, /public\.idempotency_keys/);
  assert.doesNotMatch(sql, /create (?:or replace )?function public\.check_velocity_limit|create table (?:private|public)\.\w*(?:idempotency|velocity)/i);
  assert.doesNotMatch(sql, /update private\.story_safety_state set state\s*=\s*'passed'|insert into private\.content_safety_polic/i);
});
