import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [host, viewer] = await Promise.all([
  read("app/live/broadcast/[streamId].tsx"),
  read("app/live/watch/[streamId].tsx"),
]);

const moderationStart = host.indexOf("hostActionPanel === 'moderation'");
const moderation = host.slice(
  moderationStart,
  host.indexOf("hostActionPanel === 'gifts'", moderationStart),
);
const invitation = host.slice(
  host.indexOf("hostActionPanel === 'participants' && activeAudiences.length > 0"),
  host.indexOf("hostActionPanel === 'moderation'"),
);

test("Moderar reuses every existing authoritative cohost control", () => {
  assert.match(moderation, /toggleCohostMute\(participant\)/);
  assert.match(moderation, /toggleCohostMicLock\(participant\)/);
  assert.match(moderation, /toggleCohostFloor\(participant\)/);
  assert.match(moderation, /setCohostTimer\(participant, 60\)/);
  assert.match(moderation, /setCohostTimer\(participant, 120\)/);
  assert.match(moderation, /setCohostTimer\(participant, null\)/);
  assert.match(moderation, /removeCohost\(participant\)/);
  assert.match(moderation, /getCohostTimerText\(participant\)/);
  assert.match(moderation, /structuredCohosts\.map\(participant/);
  assert.doesNotMatch(moderation, /structuredCohosts\.slice/);
});

test("Invitar remains audience-only instead of duplicating cohost moderation", () => {
  assert.match(invitation, /activeAudiences\.slice/);
  assert.match(invitation, /sendHostInviteToAudience\(participant\)/);
  assert.doesNotMatch(invitation, /toggleCohostMute|toggleCohostMicLock|setCohostTimer|removeCohost/);
});

test("mute lock floor timer and removal use canonical server authority", () => {
  assert.match(host, /const updateCohostControls = useCallback/);
  assert.match(host, /controlLiveParticipant\(streamId, participant\.user_id, action, durationSeconds\)/);
  assert.doesNotMatch(host, /\.from\('live_participants'\)[\s\S]*\.update\(/);
  assert.doesNotMatch(host, /\.from\('live_control_events'\)[\s\S]*\.insert\(/);
  for (const event of ["mute", "unmute", "lock_mic", "unlock_mic", "grant_floor", "revoke_floor", "timer_start", "timer_stop", "remove_cohost"])
    assert.match(host, new RegExp(`'${event}'`));
});

test("a host microphone lock remains enforced by the existing guest listener", () => {
  assert.match(host, /nextLocked \? 'lock_mic' : 'unlock_mic'/);
  assert.match(viewer, /if \(participantRow\?\.mic_locked\) return/);
  assert.match(viewer, /disabled=\{!!participantRow\?\.mic_locked \|\| wasRemoved\}/);
  assert.match(viewer, /remoteMicMuted \|\| remoteMicLocked/);
});

test("audited timer presets remain 1m 2m and free with active-state feedback", () => {
  assert.match(moderation, />1m<\/Text>/);
  assert.match(moderation, />2m<\/Text>/);
  assert.match(moderation, />∞<\/Text>/);
  assert.match(moderation, /floor_duration_seconds === 60 && styles\.timerBtnActive/);
  assert.match(moderation, /floor_duration_seconds === 120 && styles\.timerBtnActive/);
  assert.doesNotMatch(host, /setCohostTimer\(participant, (?:240|300)\)/);
});

test("timer expiration retains canonical auto-mute on host and guest", () => {
  assert.match(host, /enforceLiveParticipantTimer\(streamId, participant\.user_id\)/);
  assert.match(host, /const timer = setInterval\(enforceExpiredTimers, 1000\)/);
  assert.match(viewer, /floorSecondsRemaining !== 0/);
  assert.match(viewer, /if \(!isMuted\) toggleMute\(\)/);
  assert.match(viewer, /enforceLiveParticipantTimer\(streamId, user\.id\)/);
});

test("Moderar stays above the measured product boundary", () => {
  assert.match(moderation, /styles\.cohostPanel, styles\.moderationPanel, \{ bottom: productOverlayClearance/);
  assert.match(host, /featuredProductMeasurement\?\.productId === featuredProductId/);
  assert.match(host, /onLayoutHeight=\{handleProductRailLayout\}/);
});
