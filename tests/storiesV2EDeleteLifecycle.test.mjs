import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase/migrations/20260909144214_stories_v2_e_delete_own_lifecycle_closure.sql');
const migrationCode = migration.replace(/--.*$/gm, '');
const baseSchema = read('supabase/migrations/20260726100000_create_stories_schema.sql');
const lifecycle = read('supabase/migrations/20260726105000_media_public_urls_and_safe_links.sql');
const context = read('contexts/StoriesContext.tsx');
const feed = read('app/(tabs)/index.tsx');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const docs = read('docs/r2-media-lifecycle.md');

function modelDelete({ actor, owner, hasLink = true, assetOwner = owner, scheduler = 'scheduled' }) {
  const state = { story: true, storyLink: hasLink, views: 2, assetStatus: 'ready', otherLink: scheduler === 'asset_in_use' };
  const before = structuredClone(state);
  try {
    if (!actor) throw new Error('not_authenticated');
    if (actor !== owner) throw new Error('story_not_found_or_not_owned');
    if (hasLink && assetOwner !== actor) throw new Error('story_media_contract_invalid');
    if (hasLink && !['scheduled', 'deleted', 'asset_in_use'].includes(scheduler)) throw new Error('story_media_schedule_failed');
    state.storyLink = false;
    state.story = false;
    state.views = 0;
    if (hasLink && scheduler === 'scheduled') state.assetStatus = 'delete_pending';
    if (hasLink && scheduler === 'deleted') state.assetStatus = 'deleted';
    return { state, cleanup: hasLink ? scheduler : 'none' };
  } catch (error) {
    return { state: before, error: error.message };
  }
}

test('E is one transactional forward migration with no Story or media data rewrite', () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /notify pgrst, 'reload schema';\n\ncommit;\s*$/i);
  assert.doesNotMatch(migration, /create table|alter table|delete from public\.media_assets/i);
});

test('direct Story DELETE is removed at both RLS and ACL boundaries', () => {
  assert.match(migration, /drop policy if exists stories_delete_owned on public\.stories/i);
  assert.match(migration, /revoke all on table public\.stories from anon, authenticated/i);
  assert.match(migration, /grant select on table public\.stories to authenticated/i);
  assert.doesNotMatch(migration, /create policy[\s\S]*for delete|grant[^;]*delete[^;]*public\.stories/i);
});

test('delete_story is the only authenticated Story delete authority', () => {
  assert.match(migration, /create or replace function public\.delete_story\(p_story_id uuid\)/i);
  assert.match(migration, /returns table\([\s\S]*deleted_story_id uuid,[\s\S]*media_asset_id uuid,[\s\S]*media_cleanup_status text/i);
  assert.match(migration, /security definer\s+set search_path to 'pg_catalog', 'public'/i);
  assert.match(migration, /revoke all on function public\.delete_story\(uuid\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.delete_story\(uuid\)\s+to authenticated/i);
});

test('delete_story derives auth and uses one safe missing-or-foreign response', () => {
  assert.match(migration, /v_actor uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migration, /message = 'not_authenticated'/i);
  assert.match(migration, /message = 'invalid_story_id'/i);
  assert.match(migration, /s\.id = p_story_id[\s\S]*s\.user_id = v_actor[\s\S]*for update/i);
  assert.match(migration, /message = 'story_not_found_or_not_owned'/i);
  assert.doesNotMatch(migration, /p_owner|owner_id uuid/i);
});

test('canonical media discovery uses story/media/0 and never media_url', () => {
  assert.match(migration, /l\.entity_type = 'story'[\s\S]*l\.entity_id = v_story_id[\s\S]*l\.slot = 'media'[\s\S]*l\.position = 0/i);
  assert.doesNotMatch(migrationCode, /media_url|object_key|bucket_name|public_url/i);
});

test('Story, asset and link are locked before mutation', () => {
  const storyLock = migration.indexOf('from public.stories s');
  const assetLock = migration.indexOf('from public.media_assets a');
  const linkLock = migration.indexOf('perform 1\n    from public.media_asset_links l');
  const unlink = migration.indexOf('delete from public.media_asset_links l');
  assert.ok(storyLock >= 0 && assetLock > storyLock && linkLock > assetLock && unlink > linkLock);
  assert.match(migration, /select a\.owner_id[\s\S]*for update/i);
  assert.match(migration, /story_media_contract_changed/i);
});

test('only the target Story link is removed and exactly one row is required', () => {
  const unlink = migration.slice(migration.indexOf('delete from public.media_asset_links l'), migration.indexOf('delete from public.stories s'));
  assert.match(unlink, /l\.asset_id = v_asset_id/i);
  assert.match(unlink, /l\.entity_type = 'story'/i);
  assert.match(unlink, /l\.entity_id = v_story_id/i);
  assert.match(unlink, /l\.slot = 'media'/i);
  assert.match(unlink, /l\.position = 0/i);
  assert.match(unlink, /get diagnostics v_affected = row_count[\s\S]*v_affected <> 1/i);
});

test('Story deletion relies on the existing story_views cascade', () => {
  assert.match(migration, /delete from public\.stories s[\s\S]*s\.id = v_story_id[\s\S]*s\.user_id = v_actor/i);
  assert.match(baseSchema, /story_id uuid not null references public\.stories\(id\) on delete cascade/i);
  assert.doesNotMatch(migration, /delete from public\.story_views/i);
});

test('media scheduling is delegated after unlink and Story deletion', () => {
  const unlink = migration.indexOf('delete from public.media_asset_links l');
  const storyDelete = migration.indexOf('delete from public.stories s');
  const schedule = migration.indexOf('public.schedule_media_asset_deletion(v_asset_id, v_actor)');
  assert.ok(unlink >= 0 && storyDelete > unlink && schedule > storyDelete);
  assert.doesNotMatch(migration, /deleteObject|finalize_media_asset_deletion|update public\.media_assets/i);
});

test('scheduler outcomes preserve shared media and fail closed on unknown state', () => {
  assert.match(migration, /v_cleanup_status not in \('scheduled', 'deleted', 'asset_in_use'\)/i);
  assert.match(migration, /message = 'story_media_schedule_failed'/i);
  assert.match(lifecycle, /if public\.media_asset_has_valid_links\(p_asset_id\) then return 'asset_in_use'/i);
});

test('canonical photo and video deletion schedule an unlinked asset', () => {
  for (const mediaType of ['photo', 'video']) {
    const result = modelDelete({ actor: 'owner', owner: 'owner', scheduler: 'scheduled', mediaType });
    assert.equal(result.state.story, false);
    assert.equal(result.state.storyLink, false);
    assert.equal(result.state.views, 0);
    assert.equal(result.state.assetStatus, 'delete_pending');
    assert.equal(result.cleanup, 'scheduled');
  }
});

test('shared asset deletion removes only the Story relationship', () => {
  const result = modelDelete({ actor: 'owner', owner: 'owner', scheduler: 'asset_in_use' });
  assert.equal(result.state.story, false);
  assert.equal(result.state.storyLink, false);
  assert.equal(result.state.otherLink, true);
  assert.equal(result.state.assetStatus, 'ready');
  assert.equal(result.cleanup, 'asset_in_use');
});

test('legacy no-link Story deletion never guesses or mutates media', () => {
  const result = modelDelete({ actor: 'owner', owner: 'owner', hasLink: false });
  assert.equal(result.state.story, false);
  assert.equal(result.state.views, 0);
  assert.equal(result.state.assetStatus, 'ready');
  assert.equal(result.cleanup, 'none');
});

test('foreign ownership and invalid media state roll back the modeled transaction', () => {
  const foreign = modelDelete({ actor: 'other', owner: 'owner' });
  assert.equal(foreign.error, 'story_not_found_or_not_owned');
  assert.equal(foreign.state.story, true);
  assert.equal(foreign.state.storyLink, true);
  assert.equal(foreign.state.views, 2);

  const invalidMedia = modelDelete({ actor: 'owner', owner: 'owner', assetOwner: 'other' });
  assert.equal(invalidMedia.error, 'story_media_contract_invalid');
  assert.equal(invalidMedia.state.story, true);
  assert.equal(invalidMedia.state.storyLink, true);
});

test('StoriesContext calls only delete_story and refreshes after success', () => {
  const start = context.indexOf('const deleteStory = useCallback');
  const block = context.slice(start, context.indexOf('\n  return (', start));
  assert.match(block, /rpc\('delete_story'/i);
  assert.ok(block.indexOf("rpc('delete_story'") < block.indexOf('await loadStories()'));
  assert.match(block, /deleteFlightsRef\.current\.get\(storyId\)/i);
  assert.match(block, /storySessionRef\.current !== actorId/i);
  assert.doesNotMatch(block, /\.from\('stories'\)|deleteMediaAsset|media_url|object_key/i);
});

test('client validates the complete server result and logs no Story identity', () => {
  const start = context.indexOf('const deleteStory = useCallback');
  const block = context.slice(start, context.indexOf('\n  return (', start));
  assert.match(block, /row\?\.deleted_story_id !== storyId/i);
  assert.match(block, /scheduled', 'deleted', 'asset_in_use', 'none'/i);
  assert.match(block, /Story deletion failed[\s\S]*code: error\.code/i);
  assert.doesNotMatch(block, /console\.(warn|log)\([^)]*storyId/i);
});

test('Feed wires the canonical delete callback into the existing StoryViewer', () => {
  assert.match(feed, /deleteStory[^\n]*= useStories\(\)/i);
  assert.match(feed, /<StoryViewer[\s\S]*onDeleteStory=\{deleteStory\}/i);
});

for (const [platform, viewer] of [['native', nativeViewer], ['web', webViewer]]) {
  test(`${platform} delete control is owner-only and requires explicit confirmation`, () => {
    assert.match(viewer, /isOwnStory && onDeleteStory/i);
    assert.match(viewer, /accessibilityLabel="Eliminar historia"/i);
    assert.match(viewer, /¿Eliminar esta historia\?/i);
    assert.match(viewer, /Se eliminará para todos\./i);
    assert.match(viewer, />Cancelar</i);
    assert.match(viewer, /'Eliminar'/i);
  });

  test(`${platform} delete flow has a busy guard, closes only after success and preserves failure retry`, () => {
    assert.match(viewer, /if \(!currentStory \|\| !isOwnStory \|\| !onDeleteStory \|\| deletePending\) return/i);
    assert.ok(viewer.indexOf('await onDeleteStory(currentStory.id)') < viewer.indexOf('onClose();', viewer.indexOf('const confirmDelete')));
    assert.match(viewer, /catch \(_\) \{[\s\S]*setDeleteError\(true\)/i);
    assert.match(viewer, /No se pudo eliminar\. Inténtalo de nuevo\./i);
    assert.match(viewer, /disabled=\{deletePending\}/i);
  });
}

test('generic cleanup and physical deletion remain unchanged authorities', () => {
  assert.match(lifecycle, /create or replace function public\.schedule_media_asset_deletion/i);
  assert.match(lifecycle, /create or replace function public\.cleanup_stale_media_upload_records/i);
  assert.match(docs, /delete_story\(uuid\)/i);
  assert.match(docs, /schedule_media_asset_deletion/i);
  assert.match(docs, /Physical R2 deletion remains exclusively/i);
});

test('E creates no parallel table, Edge, cleanup, scheduler, reactions or direct object deletion', () => {
  const changed = migration + context + nativeViewer + webViewer;
  assert.doesNotMatch(migration, /create table|cron\.schedule|create or replace function public\.(remove_story|delete_my_story|delete_story_with_media)/i);
  assert.doesNotMatch(changed, /deleteObject|StoryDeleteService|reaction|reply/i);
  assert.doesNotMatch(context, /deleteMediaAsset|\.from\('stories'\)[\s\S]{0,120}\.delete/i);
});
