import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase/migrations/20260909020320_stories_v2_d_viewer_integrity.sql');
const baseSchema = read('supabase/migrations/20260726100000_create_stories_schema.sql');
const context = read('contexts/StoriesContext.tsx');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const viewersSheet = read('components/feature/StoryViewersSheet.tsx');
const feed = read('app/(tabs)/index.tsx');

function modelViewerPage(rows, ownerId, requestedLimit = 50, cursor = null) {
  const limit = Math.max(1, Math.min(requestedLimit ?? 50, 100));
  const unique = new Map();
  for (const row of rows) {
    if (row.viewerId !== ownerId && !unique.has(row.viewerId)) unique.set(row.viewerId, row);
  }
  const ordered = [...unique.values()].sort((left, right) => (
    right.viewedAt.localeCompare(left.viewedAt) || right.viewerId.localeCompare(left.viewerId)
  ));
  const eligible = cursor ? ordered.filter(row => (
    row.viewedAt < cursor.viewedAt
    || (row.viewedAt === cursor.viewedAt && row.viewerId < cursor.viewerId)
  )) : ordered;
  return { rows: eligible.slice(0, limit), totalCount: ordered.length };
}

test('story_views keeps one row per Story and viewer with cascade semantics', () => {
  assert.match(baseSchema, /story_id uuid not null references public\.stories\(id\) on delete cascade/i);
  assert.match(baseSchema, /viewer_id uuid not null references public\.user_profiles\(id\) on delete cascade/i);
  assert.match(baseSchema, /unique\(story_id, viewer_id\)/i);
  assert.doesNotMatch(migration, /create table|alter table public\.story_views[\s\S]*drop constraint/i);
});

test('direct authenticated inserts are revoked while own read markers remain available', () => {
  assert.match(migration, /drop policy if exists story_views_insert_owned/i);
  assert.match(migration, /revoke all on table public\.story_views from anon, authenticated/i);
  assert.match(migration, /grant select on table public\.story_views to authenticated/i);
  assert.match(migration, /create policy story_views_read_owned[\s\S]*viewer_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(migration, /grant[^;]*insert[^;]*story_views/i);
  assert.doesNotMatch(context, /\.from\('story_views'\)\.insert|\.from\('story_views'\)[\s\S]{0,120}\.insert/i);
});

test('mark_story_viewed is the single authenticated mutation authority', () => {
  assert.match(migration, /create or replace function public\.mark_story_viewed\(p_story_id uuid\)/i);
  assert.match(migration, /returns table\(status text, viewed_at timestamptz\)/i);
  assert.match(migration, /security definer\s+set search_path to 'pg_catalog', 'public'/i);
  assert.match(migration, /v_actor uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migration, /message = 'not_authenticated'/i);
  assert.match(migration, /message = 'invalid_story_id'/i);
  assert.match(migration, /s\.expires_at > now\(\)[\s\S]*private\.story_can_view_owner\(s\.user_id\)/i);
  assert.match(migration, /message = 'story_not_visible_or_expired'/i);
  assert.match(migration, /grant execute on function public\.mark_story_viewed\(uuid\)\s+to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.mark_story_viewed\(uuid\)[\s\S]{0,80}service_role/i);
});

test('owner self-view is an explicit no-op and cannot enter the view table through the RPC', () => {
  const ownerBranch = migration.slice(
    migration.indexOf('if v_owner = v_actor then'),
    migration.indexOf('insert into public.story_views as sv'),
  );
  assert.match(ownerBranch, /return query select 'owner'::text, null::timestamptz/i);
  assert.match(ownerBranch, /return;/i);
  assert.doesNotMatch(ownerBranch, /insert into public\.story_views/i);
});

test('view mutation is idempotent and never rewrites viewed_at', () => {
  assert.match(migration, /insert into public\.story_views as sv\(story_id, viewer_id\)/i);
  assert.match(migration, /values\(p_story_id, v_actor\)/i);
  assert.match(migration, /on conflict \(story_id, viewer_id\) do nothing/i);
  assert.match(migration, /'recorded'::text/i);
  assert.match(migration, /'already_recorded'::text/i);
  assert.doesNotMatch(migration, /do update|update public\.story_views/i);
});

test('owner-only viewer RPC exposes only the approved display contract', () => {
  assert.match(migration, /create or replace function public\.get_story_viewers\(/i);
  assert.match(migration, /returns table\([\s\S]*viewer_id uuid,[\s\S]*username text,[\s\S]*avatar_url text,[\s\S]*viewed_at timestamptz,[\s\S]*total_count bigint/i);
  assert.match(migration, /if v_owner <> v_actor then[\s\S]*story_viewers_owner_only/i);
  assert.match(migration, /join public\.user_profiles up on up\.id = sv\.viewer_id/i);
  assert.doesNotMatch(migration, /email|phone|device|ip_address|auth\.users|raw_user_meta_data/i);
  assert.match(migration, /grant execute on function public\.get_story_viewers\(uuid, integer, timestamptz, uuid\)\s+to authenticated/i);
  assert.doesNotMatch(migration, /story_views_owner_read_all/i);
});

test('viewer count is unique, global and excludes historical owner self-views', () => {
  assert.match(migration, /viewer_total as \([\s\S]*count\(\*\)::bigint as total_count[\s\S]*sv\.story_id = p_story_id[\s\S]*sv\.viewer_id <> v_owner/i);
  assert.match(migration, /viewer_page as \([\s\S]*sv\.viewer_id <> v_owner/i);
  assert.match(migration, /cross join viewer_total vt/i);
  assert.doesNotMatch(migration, /update public\.stories[\s\S]*view|story_view_counts/i);
});

test('viewer pagination uses a stable bounded keyset and its matching index', () => {
  assert.match(migration, /v_limit integer := greatest\(1, least\(coalesce\(p_limit, 50\), 100\)\)/i);
  assert.match(migration, /invalid_viewer_cursor/i);
  assert.match(migration, /sv\.viewed_at < p_before_viewed_at[\s\S]*sv\.viewed_at = p_before_viewed_at[\s\S]*sv\.viewer_id < p_before_viewer_id/i);
  assert.match(migration, /order by sv\.viewed_at desc, sv\.viewer_id desc[\s\S]*limit v_limit/i);
  assert.doesNotMatch(migration, /\boffset\b/i);
  assert.match(migration, /create index story_views_story_viewed_at_viewer_idx[\s\S]*\(story_id, viewed_at desc, viewer_id desc\)/i);
});

test('keyset pagination model is deterministic across timestamp ties without duplicates', () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({
    viewerId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    viewedAt: index < 70 ? '2026-09-09T00:00:00.000Z' : '2026-09-08T23:59:00.000Z',
  }));
  rows.push({ viewerId: 'owner', viewedAt: '2026-09-10T00:00:00.000Z' });
  rows.push(rows[4]);

  const first = modelViewerPage(rows, 'owner', 50);
  const firstLast = first.rows.at(-1);
  const second = modelViewerPage(rows, 'owner', 50, firstLast);
  const secondLast = second.rows.at(-1);
  const third = modelViewerPage(rows, 'owner', 50, secondLast);
  const allIds = [...first.rows, ...second.rows, ...third.rows].map(row => row.viewerId);

  assert.equal(first.totalCount, 130);
  assert.equal(second.totalCount, 130);
  assert.equal(third.totalCount, 130);
  assert.equal(first.rows.length, 50);
  assert.equal(second.rows.length, 50);
  assert.equal(third.rows.length, 30);
  assert.equal(new Set(allIds).size, 130);
});

test('viewer page limit is clamped to 1..100 while total remains global', () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    viewerId: `viewer-${String(index).padStart(3, '0')}`,
    viewedAt: new Date(Date.UTC(2026, 8, 9, 0, 0, index)).toISOString(),
  }));
  assert.equal(modelViewerPage(rows, 'owner', 0).rows.length, 1);
  assert.equal(modelViewerPage(rows, 'owner', 500).rows.length, 100);
  assert.equal(modelViewerPage(rows, 'owner', 10).totalCount, 120);
});

test('StoriesContext scopes seen-marker loading to the visible Story set', () => {
  assert.match(context, /\.from\('story_views'\)[\s\S]*\.eq\('viewer_id', user\.id\)[\s\S]*\.in\('story_id', storyIds\)/i);
});

test('StoriesContext marks local state only after a successful canonical RPC status', () => {
  const block = context.slice(
    context.indexOf('const markStoryViewed = useCallback'),
    context.indexOf('const getStoryViewers = useCallback'),
  );
  assert.match(block, /rpc\('mark_story_viewed'/i);
  assert.ok(block.indexOf("rpc('mark_story_viewed'") < block.indexOf('const nextViewed'));
  assert.ok(block.indexOf('if (error)') < block.indexOf('const nextViewed'));
  assert.match(block, /status !== 'recorded'[\s\S]*status !== 'already_recorded'[\s\S]*status !== 'owner'/i);
  assert.match(block, /viewFlightsRef\.current\.get\(storyId\)/i);
  assert.match(block, /storySessionRef\.current !== actorId/i);
  assert.doesNotMatch(block, /from\('story_views'\).*insert/i);
});

test('failed view persistence remains unviewed and errors are logged without private identifiers', () => {
  const block = context.slice(
    context.indexOf('const markStoryViewed = useCallback'),
    context.indexOf('const getStoryViewers = useCallback'),
  );
  assert.match(block, /if \(error\) \{[\s\S]*Story view persistence failed[\s\S]*return;/i);
  assert.doesNotMatch(block, /console\.(warn|log)\([^)]*storyId/i);
});

test('viewer list caller maps only approved fields and returns a keyset cursor', () => {
  assert.match(context, /rpc\('get_story_viewers'/i);
  assert.match(context, /p_before_viewed_at: cursor\?\.viewedAt \?\? null/i);
  assert.match(context, /p_before_viewer_id: cursor\?\.viewerId \?\? null/i);
  assert.match(context, /viewerId: row\.viewer_id[\s\S]*username: row\.username[\s\S]*avatarUrl:[\s\S]*viewedAt: row\.viewed_at/i);
  assert.match(context, /nextCursor: last \? \{ viewedAt: last\.viewedAt, viewerId: last\.viewerId \} : null/i);
  assert.doesNotMatch(context, /row\.(email|phone|device|ip_address)/i);
});

test('feed wires current identity and both canonical viewer callbacks into the existing viewer', () => {
  assert.match(feed, /getStoryViewers[^\n]*= useStories\(\)/i);
  assert.match(feed, /<StoryViewer[\s\S]*currentUserId=\{user\?\.id\}[\s\S]*onMarkViewed=\{markStoryViewed\}[\s\S]*onGetViewers=\{getStoryViewers\}/i);
});

for (const [platform, viewer] of [['native', nativeViewer], ['web', webViewer]]) {
  test(`${platform} owner UI shows a real eye/count control only for the current user's Story`, () => {
    assert.match(viewer, /currentStory\.userId === currentUserId/i);
    assert.match(viewer, /isOwnStory && onGetViewers/i);
    assert.match(viewer, /name="visibility"/i);
    assert.match(viewer, /viewerCount/i);
    assert.match(viewer, /<StoryViewersSheet/i);
  });

  test(`${platform} owner UI supports initial load, cursor pagination and retry`, () => {
    assert.match(viewer, /onGetViewers\(storyId, cursor, 50\)/i);
    assert.match(viewer, /loadViewers\(currentStory\.id, viewerCursor, true\)/i);
    assert.match(viewer, /if \(currentStory\) void loadViewers\(currentStory\.id\)/i);
    assert.match(viewer, /viewers\.length < viewerCount/i);
  });
}

test('StoryViewersSheet is presentational and includes loading, empty, error, retry and pagination states', () => {
  assert.match(viewersSheet, /Cargando visualizaciones/);
  assert.match(viewersSheet, /Todavía no hay visualizaciones/);
  assert.match(viewersSheet, /No pudimos cargar las visualizaciones/);
  assert.match(viewersSheet, />Reintentar</);
  assert.match(viewersSheet, /onEndReached/);
  assert.match(viewersSheet, /onLoadMore/);
  assert.doesNotMatch(viewersSheet, /getSupabaseClient|createClient|\.from\(|\.rpc\(/i);
});

test('D adds no parallel view table, analytics authority, realtime or reactions', () => {
  assert.doesNotMatch(migration, /create table|story_view_events|story_impressions|story_view_counts|realtime|reaction|reply/i);
  assert.doesNotMatch(context + nativeViewer + webViewer + viewersSheet, /story_view_events|story_impressions|reaction|reply|subscribe\(/i);
});
