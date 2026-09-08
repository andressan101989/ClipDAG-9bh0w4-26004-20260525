import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const group = readFileSync(new URL('../app/chat/group/[conversationId].tsx', import.meta.url), 'utf8');

class RealtimeChannelModel {
  constructor(topic) {
    this.topic = topic;
    this.callbacks = [];
    this.subscribeCalls = 0;
    this.active = false;
  }

  on(type, _filter, callback) {
    if (this.active) throw new Error(`cannot add \`${type}\` callbacks for ${this.topic} after \`subscribe()\`.`);
    this.callbacks.push(callback);
    return this;
  }

  subscribe() {
    this.subscribeCalls += 1;
    if (this.subscribeCalls > 1) throw new Error('subscribe called twice');
    this.active = true;
    return this;
  }
}

class RealtimeClientModel {
  constructor() {
    this.channels = new Map();
    this.removeCalls = 0;
  }

  channel(topic) {
    const existing = this.channels.get(topic);
    if (existing) return existing;
    const channel = new RealtimeChannelModel(topic);
    this.channels.set(topic, channel);
    return channel;
  }

  async removeChannel(channel) {
    this.removeCalls += 1;
    channel.active = false;
    this.channels.delete(channel.topic);
    return 'ok';
  }
}

function mountGroupCallLifecycle(client, conversationId, mountId, load, setActiveCall) {
  let stale = false;
  let cleanupFlight = null;
  const refresh = () => Promise.resolve(load()).then(call => {
    if (!stale) setActiveCall(call);
  }).catch(() => {
    if (!stale) setActiveCall(null);
  });
  const channel = client.channel(`chat-group-call-entry:${conversationId}:${mountId}`);
  channel.on('postgres_changes', {}, refresh);
  channel.subscribe();
  const cleanup = () => {
    stale = true;
    cleanupFlight ??= client.removeChannel(channel).catch(() => undefined);
    return cleanupFlight;
  };
  return { channel, cleanup, refresh };
}

function resolveInputHeight(currentHeight, contentHeight) {
  const nextHeight = Math.min(112, Math.max(42, contentHeight));
  return Math.abs(currentHeight - nextHeight) < 1 ? currentHeight : nextHeight;
}

test('registers postgres_changes before subscribe', () => {
  const onIndex = group.indexOf("channel.on('postgres_changes'");
  const subscribeIndex = group.indexOf('channel.subscribe()', onIndex);
  assert(onIndex >= 0);
  assert(subscribeIndex > onIndex);
});

test('subscribes exactly once for each owned channel', () => {
  const client = new RealtimeClientModel();
  const lifecycle = mountGroupCallLifecycle(client, 'group-a', 'mount-1', () => null, () => {});
  assert.equal(lifecycle.channel.subscribeCalls, 1);
  assert.equal((group.match(/channel\.subscribe\(\)/g) ?? []).length, 1);
});

test('cleanup uses the canonical client removeChannel API', async () => {
  const client = new RealtimeClientModel();
  const lifecycle = mountGroupCallLifecycle(client, 'group-a', 'mount-1', () => null, () => {});
  await lifecycle.cleanup();
  assert.equal(client.removeCalls, 1);
  assert.equal(client.channels.size, 0);
  assert.match(group, /supabase\.removeChannel\(channel\)/);
});

test('double cleanup is idempotent and shares one removal flight', async () => {
  const client = new RealtimeClientModel();
  const lifecycle = mountGroupCallLifecycle(client, 'group-a', 'mount-1', () => null, () => {});
  const first = lifecycle.cleanup();
  const second = lifecycle.cleanup();
  assert.strictEqual(first, second);
  await Promise.all([first, second]);
  assert.equal(client.removeCalls, 1);
  assert.match(group, /cleanupFlight \?\?=/);
});

test('mount unmount mount owns a fresh valid channel lifecycle', async () => {
  const client = new RealtimeClientModel();
  const first = mountGroupCallLifecycle(client, 'group-a', 'mount-1', () => null, () => {});
  await first.cleanup();
  const second = mountGroupCallLifecycle(client, 'group-a', 'mount-2', () => null, () => {});
  assert.notStrictEqual(first.channel, second.channel);
  assert.equal(second.channel.subscribeCalls, 1);
});

test('development remount cannot add a callback to the subscribed channel', () => {
  const client = new RealtimeClientModel();
  const first = mountGroupCallLifecycle(client, 'group-a', 'mount-1', () => null, () => {});
  assert.doesNotThrow(() => mountGroupCallLifecycle(client, 'group-a', 'mount-2', () => null, () => {}));
  assert.equal(client.channels.size, 2);
  assert.notEqual(first.channel.topic, [...client.channels.values()][1].topic);
  assert.match(group, /chat-group-call-entry:\$\{conversationId\}:\$\{generateUUID\(\)\}/);
});

test('conversation switch removes A before B remains active', async () => {
  const client = new RealtimeClientModel();
  const first = mountGroupCallLifecycle(client, 'group-a', 'mount-a', () => null, () => {});
  await first.cleanup();
  const second = mountGroupCallLifecycle(client, 'group-b', 'mount-b', () => null, () => {});
  assert.deepEqual([...client.channels.keys()], [second.channel.topic]);
  assert.match(second.channel.topic, /group-b/);
});

test('late refresh after unmount cannot update active call state', async () => {
  let resolveLoad;
  const pending = new Promise(resolve => { resolveLoad = resolve; });
  const updates = [];
  const client = new RealtimeClientModel();
  const lifecycle = mountGroupCallLifecycle(client, 'group-a', 'mount-1', () => pending, call => updates.push(call));
  const refresh = lifecycle.refresh();
  await lifecycle.cleanup();
  resolveLoad({ id: 'late-call' });
  await refresh;
  assert.deepEqual(updates, []);
  assert.match(group, /if \(!stale\) setActiveCall\(call\)/);
});

test('cleanup leaves no active duplicate listeners', async () => {
  const client = new RealtimeClientModel();
  const first = mountGroupCallLifecycle(client, 'group-a', 'mount-1', () => null, () => {});
  const second = mountGroupCallLifecycle(client, 'group-a', 'mount-2', () => null, () => {});
  await first.cleanup();
  assert.deepEqual([...client.channels.values()].filter(channel => channel.active), [second.channel]);
});

test('physical callback-after-subscribe error is prevented contractually', () => {
  const client = new RealtimeClientModel();
  const first = mountGroupCallLifecycle(client, 'group-a', 'mount-1', () => null, () => {});
  assert.throws(() => first.channel.on('postgres_changes', {}, () => {}), /after `subscribe\(\)`/);
  assert.doesNotThrow(() => mountGroupCallLifecycle(client, 'group-a', 'mount-2', () => null, () => {}));
});

test('composer minimum input height is 42', () => {
  assert.equal(resolveInputHeight(60, 12), 42);
  assert.match(group, /const INPUT_MIN_HEIGHT = 42/);
});

test('composer maximum input height is 112', () => {
  assert.equal(resolveInputHeight(60, 180), 112);
  assert.match(group, /const INPUT_MAX_HEIGHT = 112/);
});

test('identical content size produces no effective height change', () => {
  assert.equal(resolveInputHeight(64, 64), 64);
});

test('subpixel content variation below one is absorbed by the deadband', () => {
  assert.equal(resolveInputHeight(64, 64.75), 64);
  assert.match(group, /Math\.abs\(currentHeight - nextHeight\) < 1/);
});

test('multiline input grows while remaining inside bounds', () => {
  assert.equal(resolveInputHeight(42, 78), 78);
  assert.equal(resolveInputHeight(78, 111), 111);
});

test('input enables scrolling at the maximum height', () => {
  assert.match(group, /scrollEnabled=\{inputHeight >= INPUT_MAX_HEIGHT\}/);
});

test('deleting text returns deterministically to minimum height', () => {
  assert.equal(resolveInputHeight(90, 20), 42);
  assert.match(group, /setInputHeight\(INPUT_MIN_HEIGHT\)/);
});

test('productive handler has no additive content-size feedback offset', () => {
  assert.doesNotMatch(group, /contentSize\.height\s*\+\s*14/);
  assert.match(group, /onContentSizeChange=\{handleInputContentSizeChange\}/);
});

test('send and idle voice controls reserve one stable trailing width', () => {
  assert.match(group, /composerTrailingIdle: \{ width: 46 \}/);
  assert.match(group, /text\.trim\(\) && !voiceRecording[\s\S]*VoiceRecorderBar/);
});

test('VoiceRecorderBar remains the canonical group recording control', () => {
  assert.equal((group.match(/<VoiceRecorderBar/g) ?? []).length, 1);
  assert.match(group, /voiceDraftSenderRef\.current\.handoff/);
});

test('keyboard avoidance and safe-area padding remain single existing authorities', () => {
  assert.match(group, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  assert.match(group, /paddingBottom: Math\.max\(insets\.bottom, Spacing\.sm\)/);
  assert.equal((group.match(/KeyboardAvoidingView/g) ?? []).length, 3);
});
