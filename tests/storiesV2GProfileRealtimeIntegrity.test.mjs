import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const context = read('contexts/StoriesContext.tsx');
const hook = read('hooks/useStories.tsx');
const storiesBar = read('components/feature/StoriesBar.tsx');
const ownProfile = read('app/(tabs)/profile.tsx');
const foreignProfile = read('app/creator/[id].tsx');
const feed = read('app/(tabs)/index.tsx');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const migration = read('supabase/migrations/20260909225612_stories_v2_g_enable_stories_realtime.sql');

function profileState(group) {
  if (!group?.stories?.length) return 'none';
  return group.hasUnseen ? 'unseen' : 'seen';
}

function prune(groups, viewed, now) {
  return groups.flatMap(group => {
    const stories = group.stories.filter(story => Date.parse(story.expiresAt) > now);
    return stories.length ? [{ ...group, stories, hasUnseen: stories.some(story => !viewed.has(story.id)) }] : [];
  });
}

test('own Profile derives its Story ring from the canonical shared store', () => {
  assert.match(ownProfile, /getStoryGroupForUser\(user\?\.id\)/);
  assert.match(ownProfile, /ownStoryGroup[\s\S]*<StoryAvatarRing/);
  assert.equal(profileState({ stories: [{ id: 's1' }], hasUnseen: true }), 'unseen');
});

test('foreign Profile derives only RLS-visible Stories from the same store', () => {
  assert.match(foreignProfile, /getStoryGroupForUser\(creatorId\)/);
  assert.match(foreignProfile, /disabled=\{!creatorStoryGroup\}/);
  assert.doesNotMatch(foreignProfile, /\.from\(['"]stories['"]\)/);
});

test('Profile Story rings share the StoriesBar seen and unseen visual authority', () => {
  assert.match(storiesBar, /export function StoryAvatarRing/);
  assert.match(storiesBar, /hasUnseen \? \([\s\S]*LinearGradient/);
  assert.match(storiesBar, /storyRingGradSeen/);
  assert.equal(profileState({ stories: [{ id: 's1' }], hasUnseen: false }), 'seen');
  assert.equal(profileState(null), 'none');
});

test('own Profile preserves avatar editing when no active Story exists', () => {
  assert.match(ownProfile, /ownStoryGroup \? setStoryViewerVisible\(true\) : handlePickAvatar\(\)/);
  assert.match(ownProfile, /!ownStoryGroup \? \([\s\S]*cameraBadge/);
});

test('both Profile routes reuse the canonical StoryViewer rather than creating another viewer', () => {
  for (const profile of [ownProfile, foreignProfile]) {
    assert.match(profile, /from '@\/components\/feature\/StoryViewer'/);
    assert.match(profile, /<StoryViewer/);
    assert.match(profile, /onMarkViewed=\{markStoryViewed\}/);
    assert.match(profile, /onGetViewers=\{getStoryViewers\}/);
    assert.match(profile, /onDeleteStory=\{deleteStory\}/);
  }
  assert.doesNotMatch(ownProfile + foreignProfile, /ProfileStoryViewer|ProfileStoriesContext/);
});

test('multiple Stories open as the selected user canonical sequence', () => {
  assert.match(context, /group\.stories\.push\(story\)/);
  assert.match(ownProfile, /storyGroup=\{ownStoryGroup\}/);
  assert.match(foreignProfile, /storyGroup=\{creatorStoryGroup\}/);
});

test('Home tracks selected user identity instead of retaining a stale StoryGroup snapshot', () => {
  assert.match(feed, /viewingStoryUserId/);
  assert.match(feed, /storyGroups\.find\(group => group\.userId === viewingStoryUserId\)/);
  assert.doesNotMatch(feed, /setViewingStoryGroup/);
});

test('confirmed mark_story_viewed updates the one shared seen state without a duplicate RPC', () => {
  assert.equal((context.match(/rpc\('mark_story_viewed'/g) || []).length, 1);
  assert.match(context, /viewedStoryIdsRef\.current = nextViewed[\s\S]*setStoryGroups\(prev => prev\.map/);
  assert.match(context, /viewFlightsRef/);
});

test('one provider-owned Postgres Changes channel is the Stories realtime authority', () => {
  assert.equal((context.match(/\.channel\(`/g) || []).length, 1);
  assert.match(context, /\.channel\(`stories-v2:\$\{actorId\}`\)/);
  assert.match(context, /event: '\*'[\s\S]*schema: 'public'[\s\S]*table: 'stories'/);
  assert.doesNotMatch(ownProfile + foreignProfile + feed + storiesBar + nativeViewer + webViewer, /postgres_changes/);
});

test('Realtime payload is never inserted into state and only invalidates canonical loading', () => {
  assert.match(context, /table: 'stories',[\s\S]*\}, \(\) => \{[\s\S]*void loadStories\(\)/);
  assert.match(context, /\.from\('stories'\)[\s\S]*\.gt\('expires_at'/);
  assert.doesNotMatch(context, /payload\.(new|old)|setStoryGroups\([^)]*payload/);
});

test('canonical Story reconciliation still relies on RLS and canonical media links', () => {
  assert.match(context, /Visibility is enforced by the stories RLS authority/);
  assert.match(context, /\.from\('media_asset_links'\)[\s\S]*\.eq\('entity_type', 'story'\)[\s\S]*\.eq\('slot', 'media'\)/);
});

test('rapid realtime signals coalesce into one active load plus one pending reconciliation', () => {
  assert.match(context, /refreshFlightRef/);
  assert.match(context, /refreshPendingRef\.current = true/);
  assert.match(context, /do \{[\s\S]*await fetchCanonicalStories\(actorId\)[\s\S]*\} while \(refreshPendingRef\.current/);
});

test('subscription is session fenced, removed on logout or user switch, and resubscribed per login', () => {
  assert.match(context, /storySessionRef\.current === actorId/);
  assert.match(context, /return \(\) => \{[\s\S]*active = false;[\s\S]*removeChannel\(channel\)/);
  assert.match(context, /\[user\?\.id, loadStories\]/);
});

test('SUBSCRIBED and foreground transitions trigger controlled reconciliation', () => {
  assert.match(context, /status === 'SUBSCRIBED'[\s\S]*void loadStories\(\)/);
  assert.match(context, /AppState\.addEventListener\('change'/);
  assert.match(context, /previousState !== 'active' && nextState === 'active'/);
});

test('expired Stories are pruned deterministically without polling', () => {
  const groups = [{ userId: 'u', hasUnseen: true, stories: [
    { id: 'old', expiresAt: '2026-01-01T00:00:00Z' },
    { id: 'active', expiresAt: '2027-01-01T00:00:00Z' },
  ] }];
  assert.deepEqual(prune(groups, new Set(['active']), Date.parse('2026-06-01T00:00:00Z'))[0].stories.map(s => s.id), ['active']);
  assert.match(context, /const nextExpiry = Math\.min/);
  assert.match(context, /setTimeout\(\(\) => \{[\s\S]*pruneExpiredStoryGroups[\s\S]*void loadStories\(\)/);
  assert.doesNotMatch(context, /setInterval/);
});

test('Story deletion and expiration remove stale Profile and Home viewer state', () => {
  assert.match(ownProfile, /storyViewerVisible && !ownStoryGroup/);
  assert.match(foreignProfile, /storyViewerVisible && !creatorStoryGroup/);
  assert.match(feed, /storyViewerVisible && viewingStoryUserId && !viewingStoryGroup/);
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /currentIndex >= stories\.length\) onClose\(\)/);
  }
});

test('follow and unfollow reconcile Story visibility through the shared authority', () => {
  assert.match(foreignProfile, /await toggleFollow\(creatorId\);\n\s*await refreshStories\(\)/);
});

test('story_views is not added to realtime and owner identities remain RPC-only', () => {
  assert.doesNotMatch(context, /table: 'story_views'/);
  assert.equal((context.match(/rpc\('get_story_viewers'/g) || []).length, 1);
  assert.doesNotMatch(migration, /story_views/);
});

test('G migration adds only public.stories to the existing publication idempotently', () => {
  assert.match(migration, /pg_catalog\.pg_publication_tables/);
  assert.match(migration, /pubname = 'supabase_realtime'/);
  assert.match(migration, /schemaname = 'public'/);
  assert.match(migration, /tablename = 'stories'/);
  assert.match(migration, /alter publication supabase_realtime add table public\.stories/);
  assert.doesNotMatch(migration, /create publication|drop publication|for all tables|create policy|grant |alter table|insert |update |delete from/i);
});

test('G creates no parallel data, media, view, delete or backend authority', () => {
  const gClient = context + ownProfile + foreignProfile + feed + storiesBar;
  assert.match(hook, /useContext\(StoriesContext\)/);
  assert.doesNotMatch(gClient, /createContext\(|ProfileStoriesContext|StoryMediaResolver|StoryRealtimeService/);
  assert.doesNotMatch(gClient, /\.from\('story_views'\)\.(insert|update|delete)|\.from\('stories'\)\.(insert|update|delete)/);
  assert.doesNotMatch(gClient, /deleteMediaAsset\([^)]*story|functions\.invoke\(['"]get-media-url/);
});

test('B C D E and F authorities remain wired through the shared context and viewer', () => {
  assert.match(context, /rpc\('create_story_with_media'/);
  assert.match(context, /mediaAssetId: storyAssetIds\.get\(row\.id\)/);
  assert.match(context, /rpc\('mark_story_viewed'/);
  assert.match(context, /rpc\('delete_story'/);
  assert.match(nativeViewer, /PHOTO_DURATION_MS = 15000/);
  assert.match(nativeViewer, /addListener\?\.\('playToEnd'/);
});
