import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase/migrations/20260910012140_stories_v2_h_replies_reactions_integrity.sql');
const context = read('contexts/StoriesContext.tsx');
const chatService = read('services/chatService.ts');
const interactions = read('components/feature/StoryInteractions.tsx');
const reactionContract = read('components/feature/storyReactions.ts');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const viewersSheet = read('components/feature/StoryViewersSheet.tsx');
const feed = read('app/(tabs)/index.tsx');
const ownProfile = read('app/(tabs)/profile.tsx');
const foreignProfile = read('app/creator/[id].tsx');

const keys = ['heart', 'laugh', 'wow', 'sad', 'fire', 'clap'];

function applyDesiredReaction(current, desired) {
  if (desired === null) return null;
  return desired;
}

function reactionPage(rows, limit, cursor = null) {
  const bounded = Math.max(1, Math.min(limit ?? 50, 100));
  const ordered = [...rows].sort((a, b) => (
    b.reactedAt.localeCompare(a.reactedAt) || b.reactorId.localeCompare(a.reactorId)
  ));
  const filtered = cursor ? ordered.filter(row => (
    row.reactedAt < cursor.reactedAt
    || (row.reactedAt === cursor.reactedAt && row.reactorId < cursor.reactorId)
  )) : ordered;
  return { rows: filtered.slice(0, bounded), total: rows.length };
}

test('reaction keys and emoji mapping are exact and stable', () => {
  assert.deepEqual([...reactionContract.matchAll(/key: '(heart|laugh|wow|sad|fire|clap)', emoji: '([^']+)'/g)].map(m => m[1]), keys);
  assert.deepEqual([...reactionContract.matchAll(/key: '(?:heart|laugh|wow|sad|fire|clap)', emoji: '([^']+)'/g)].map(m => m[1]), ['❤️', '😂', '😮', '😢', '🔥', '👏']);
  assert.match(migration, /reaction = any \(array\['heart', 'laugh', 'wow', 'sad', 'fire', 'clap'\]::text\[\]\)/i);
  assert.match(migration, /invalid_story_reaction/i);
});

test('story_reactions has one canonical row with cascade integrity', () => {
  assert.match(migration, /create table if not exists public\.story_reactions/i);
  assert.match(migration, /primary key \(story_id, reactor_id\)/i);
  assert.match(migration, /story_id uuid not null references public\.stories\(id\) on delete cascade/i);
  assert.match(migration, /reactor_id uuid not null references public\.user_profiles\(id\) on delete cascade/i);
  assert.doesNotMatch(migration, /reaction_count|aggregate|story_replies/i);
});

test('reaction mutation validates auth, active Story, owner and canonical visibility', () => {
  assert.match(migration, /create or replace function public\.set_story_reaction/i);
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/i);
  assert.match(migration, /authentication_required/i);
  assert.match(migration, /v_expires_at <= now\(\)/i);
  assert.match(migration, /story_owner_cannot_react/i);
  assert.match(migration, /private\.story_can_view_owner\(v_owner\)/i);
  assert.match(migration, /story_not_visible/i);
});

test('reaction set and remove are desired-state idempotent', () => {
  assert.equal(applyDesiredReaction(null, 'heart'), 'heart');
  assert.equal(applyDesiredReaction('heart', 'heart'), 'heart');
  assert.equal(applyDesiredReaction('heart', 'laugh'), 'laugh');
  assert.equal(applyDesiredReaction('laugh', null), null);
  assert.equal(applyDesiredReaction(null, null), null);
  assert.match(migration, /on conflict \(story_id, reactor_id\) do update/i);
  assert.match(migration, /when r\.reaction is distinct from excluded\.reaction then now\(\)[\s\S]*else r\.updated_at/i);
  assert.match(migration, /case when v_removed then 'removed'::text else 'unchanged'::text/i);
});

test('same selected reaction toggles by sending the explicit null desired state', () => {
  assert.match(interactions, /onReaction\(selected \? null : item\.key\)/i);
  assert.match(context, /p_reaction: reaction/i);
  assert.match(context, /viewerReaction: next/i);
});

test('direct reaction writes are denied and own reaction reads are narrow', () => {
  assert.match(migration, /alter table public\.story_reactions enable row level security/i);
  assert.match(migration, /policy story_reactions_read_own[\s\S]*for select[\s\S]*reactor_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /revoke all on table public\.story_reactions from public, anon, authenticated/i);
  assert.match(migration, /grant select on table public\.story_reactions to authenticated/i);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*story_reactions/i);
});

test('owner-only reaction identities use bounded stable keyset pagination', () => {
  assert.match(migration, /create or replace function public\.get_story_reactions/i);
  assert.match(migration, /v_owner is null or v_owner <> v_actor/i);
  assert.match(migration, /story_not_found_or_not_owned/i);
  assert.match(migration, /invalid_reaction_cursor/i);
  assert.match(migration, /greatest\(1, least\(coalesce\(p_limit, 50\), 100\)\)/i);
  assert.match(migration, /\(r\.updated_at, r\.reactor_id\) < \(p_before_updated_at, p_before_reactor_id\)/i);
  assert.match(migration, /order by r\.updated_at desc, r\.reactor_id desc/i);
  assert.doesNotMatch(migration, /\boffset\b/i);
});

test('reaction pagination remains stable across timestamp ties and keeps global count', () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    reactorId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    reactedAt: index < 5 ? '2026-09-10T01:00:00Z' : '2026-09-10T00:00:00Z',
  }));
  const first = reactionPage(rows, 3);
  const second = reactionPage(rows, 3, first.rows.at(-1));
  const third = reactionPage(rows, 3, second.rows.at(-1));
  const combined = [...first.rows, ...second.rows, ...third.rows];
  assert.deepEqual([first.rows.length, second.rows.length, third.rows.length], [3, 3, 1]);
  assert.equal(new Set(combined.map(row => row.reactorId)).size, 7);
  assert.equal(first.total, 7);
  assert.match(migration, /reaction_total[\s\S]*count\(\*\)::bigint[\s\S]*cross join reaction_total/i);
});

test('reaction RPCs are fixed-search-path authenticated-only authorities', () => {
  for (const signature of [
    'set_story_reaction\\(uuid, text\\)',
    'get_story_reactions\\(uuid, integer, timestamptz, uuid\\)',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*from public, anon, authenticated, service_role`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature} to authenticated`, 'i'));
  }
  assert.equal((migration.match(/security definer/g) || []).length, 3);
  assert.equal((migration.match(/set search_path = pg_catalog, public/g) || []).length, 3);
});

test('Story reply wrapper validates Story then composes canonical Chat authorities', () => {
  assert.match(migration, /create or replace function public\.reply_to_story/i);
  assert.match(migration, /story_owner_cannot_reply/i);
  assert.match(migration, /v_expires_at <= now\(\)/i);
  assert.match(migration, /private\.story_can_view_owner\(v_owner\)/i);
  assert.match(migration, /from public\.chat_get_or_create_direct\(v_owner\)/i);
  assert.match(migration, /from public\.chat_send_message\(/i);
  assert.match(migration, /p_client_message_id/i);
});

test('reply recipient is database-derived and cannot be supplied by Story UI', () => {
  const signature = migration.slice(migration.indexOf('public.reply_to_story'), migration.indexOf('returns public.messages'));
  assert.doesNotMatch(signature, /recipient|owner_id/i);
  assert.match(migration, /select s\.user_id, s\.expires_at[\s\S]*into v_owner/i);
  assert.match(chatService, /rpc\('reply_to_story'[\s\S]*p_story_id: storyId/i);
  assert.doesNotMatch(chatService.slice(chatService.indexOf('sendStoryReply'), chatService.indexOf('getOrCreateDirectConversation')), /recipient/i);
});

test('Story replies store safe durable text context and no Story media identity', () => {
  assert.match(migration, /v_prefix constant text := 'Respondió a tu historia'/i);
  assert.match(migration, /v_prefix \|\| E'\\n' \|\| v_body/i);
  assert.doesNotMatch(migration, /signed_url|media_url|r2|storage|token/i);
  assert.doesNotMatch(migration, /alter table public\.messages|add column/i);
  assert.doesNotMatch(migration, /create table[^;]*story_replies/i);
});

test('reply send state trims, guards duplicates, preserves draft on failure and clears on success', () => {
  assert.match(interactions, /const text = draft\.trim\(\)/i);
  assert.match(interactions, /if \(!text \|\| sendingRef\.current\) return/i);
  assert.match(interactions, /setSending\(true\)/i);
  assert.match(interactions, /await onReply\(text, attempt\.clientMessageId\)[\s\S]*setDraft\(''\)/i);
  assert.match(interactions, /catch \{[\s\S]*setSendError\(true\)/i);
  assert.doesNotMatch(interactions.slice(interactions.indexOf('catch {'), interactions.indexOf('finally')), /setDraft/);
});

test('composer and reaction controls are non-owner only and wired in every canonical Viewer caller', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /!isOwnStory && onSetReaction && onReplyToStory/i);
    assert.match(viewer, /<StoryInteractions/i);
    assert.match(viewer, /selectedReaction=\{currentStory\.viewerReaction \?\? null\}/i);
  }
  for (const caller of [feed, ownProfile, foreignProfile]) {
    assert.match(caller, /onSetReaction=\{setStoryReaction\}/i);
    assert.match(caller, /onGetReactions=\{getStoryReactions\}/i);
    assert.match(caller, /onReplyToStory=\{replyToStory\}/i);
  }
});

test('reaction picker reflects selection and contains no fullscreen effect system', () => {
  assert.match(interactions, /selectedReaction === item\.key/i);
  assert.match(interactions, /reactionSelected/i);
  assert.doesNotMatch(interactions + nativeViewer + webViewer, /confetti|particle|emoji rain|full.?screen reaction/i);
});

test('optimistic reaction failure restores the persisted selection', () => {
  const block = context.slice(context.indexOf('const setStoryReaction'), context.indexOf('const getStoryReactions'));
  assert.match(block, /const previous =/i);
  assert.ok(block.indexOf('updateLocal(reaction)') < block.indexOf("rpc('set_story_reaction'"));
  assert.match(block, /if \(error\)[\s\S]*updateLocal\(previous\)/i);
  assert.match(block, /reactionFlightsRef/i);
});

test('composer focus and mutation busy state join F effective pause authority', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    const pause = viewer.slice(viewer.indexOf('const shouldPausePlayback'), viewer.indexOf('const loadViewers'));
    assert.match(pause, /interactionFocused/i);
    assert.match(pause, /reactionPending/i);
    assert.match(viewer, /onFocusChange=\{setInteractionFocused\}/i);
  }
});

test('interaction surface captures responder input instead of navigating Stories', () => {
  assert.match(interactions, /onStartShouldSetResponder=\{\(\) => true\}/i);
  assert.match(interactions, /onPress=\{\(\) => void onReaction/i);
  assert.match(interactions, /onPress=\{\(\) => void submit\(\)\}/i);
  assert.doesNotMatch(interactions, /goNext|goPrev|handleZonePress/i);
});

test('owner viewer sheet reuses its existing modal for private reaction identities', () => {
  assert.match(viewersSheet, /tab === 'viewers'/i);
  assert.match(viewersSheet, /tab === 'reactions'/i);
  assert.match(viewersSheet, /storyReactionEmoji\(item\.reaction\)/i);
  assert.match(nativeViewer, /reactions=\{reactions\}/i);
  assert.match(webViewer, /onReactionsLoadMore/i);
});

test('Story state reads only the actor reaction and maps approved fields', () => {
  assert.match(context, /\.from\('story_reactions'\)[\s\S]*\.eq\('reactor_id', actorId\)[\s\S]*\.in\('story_id', storyIds\)/i);
  assert.match(context, /isStoryReactionKey\(row\.reaction\)/i);
  assert.match(context, /viewerReaction: ownReactionByStory\.get\(row\.id\) \?\? null/i);
  assert.match(context, /reactorId: row\.reactor_id[\s\S]*reaction: row\.reaction[\s\S]*reactedAt: row\.reacted_at/i);
  assert.doesNotMatch(context, /row\.(email|phone|device|ip|session)/i);
});

test('story_reactions remains outside Realtime and viewer identities remain canonical D RPC data', () => {
  assert.doesNotMatch(migration, /alter publication|supabase_realtime/i);
  assert.doesNotMatch(context, /table: 'story_reactions'/i);
  assert.equal((context.match(/rpc\('get_story_viewers'/g) || []).length, 1);
  assert.equal((context.match(/rpc\('get_story_reactions'/g) || []).length, 1);
});

test('H creates no parallel Chat, Story, media or raw message insert authority', () => {
  const client = context + chatService + nativeViewer + webViewer + interactions;
  assert.doesNotMatch(client, /\.from\('messages'\)\.(insert|update|delete)/i);
  assert.doesNotMatch(client, /StoryReplyService|StoryChatService|StoryMessagesContext/i);
  assert.doesNotMatch(client, /createContext\(/i);
  assert.doesNotMatch(migration, /create table[^;]*(messages|chat_conversations|story_replies)/i);
  assert.doesNotMatch(client, /getMediaUrl\(|signedUrl|deleteMediaAsset/i);
});

test('web retains the F video placeholder without requesting Story video media for replies', () => {
  const media = webViewer.slice(webViewer.indexOf('function StoryMedia'), webViewer.indexOf('export function StoryViewer'));
  assert.match(media, /Video \(solo móvil\)/i);
  assert.ok(media.indexOf("story.mediaType === 'video'") < media.indexOf('<StoryPhotoMedia'));
  assert.doesNotMatch(media.slice(0, media.indexOf('<StoryPhotoMedia')), /useStoryMediaUrl|getMediaUrl/i);
  assert.match(webViewer, /<StoryInteractions/i);
});

test('B C D E F and G authorities remain intact', () => {
  assert.match(context, /rpc\('create_story_with_media'/i);
  assert.match(context, /rpc\('mark_story_viewed'/i);
  assert.match(context, /rpc\('delete_story'/i);
  assert.match(context, /table: 'stories'/i);
  assert.match(nativeViewer, /PHOTO_DURATION_MS = 15000/i);
  assert.match(nativeViewer, /addListener\?\.\('playToEnd'/i);
  assert.match(nativeViewer, /shouldPausePlayback/i);
});
