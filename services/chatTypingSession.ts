import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/template';

export const CHAT_TYPING_THROTTLE_MS = 1_000;
export const CHAT_TYPING_EXPIRES_MS = 3_500;
const CHAT_TYPING_SUBSCRIBE_TIMEOUT_MS = 8_000;

type Timer = ReturnType<typeof setTimeout>;
type Clock = { now: () => number; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
const systemClock: Clock = { now: Date.now, setTimeout, clearTimeout };

export class TypingSignalController {
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private remoteTimer: Timer | null = null;
  private active = true;
  constructor(
    private readonly sendSignal: (typing: boolean) => Promise<void>,
    private readonly onRemoteChange: (typing: boolean) => void,
    private readonly clock: Clock = systemClock,
  ) {}

  async setLocalTyping(hasText: boolean): Promise<void> {
    if (!this.active) return;
    if (!hasText) { await this.sendSignal(false); return; }
    const now = this.clock.now();
    if (now - this.lastStartedAt < CHAT_TYPING_THROTTLE_MS) return;
    this.lastStartedAt = now;
    await this.sendSignal(true);
  }

  receiveRemote(typing: boolean): void {
    if (!this.active) return;
    if (this.remoteTimer) this.clock.clearTimeout(this.remoteTimer);
    this.remoteTimer = null;
    this.onRemoteChange(typing);
    if (typing) {
      this.remoteTimer = this.clock.setTimeout(() => {
        if (!this.active) return;
        this.remoteTimer = null;
        this.onRemoteChange(false);
      }, CHAT_TYPING_EXPIRES_MS);
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    await this.sendSignal(false);
  }

  dispose(): void {
    this.active = false;
    if (this.remoteTimer) this.clock.clearTimeout(this.remoteTimer);
    this.remoteTimer = null;
    this.onRemoteChange(false);
  }
}

export type ChatTypingSession = {
  setTyping: (hasText: boolean) => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
};

export async function createChatTypingSession(input: {
  userId: string;
  partnerId: string;
  conversationId: string;
  generation: number;
  onRemoteChange: (typing: boolean) => void;
}): Promise<ChatTypingSession> {
  const supabase = getSupabaseClient();
  await supabase.realtime.setAuth();
  let active = true;
  const outboundChannel: RealtimeChannel = supabase.channel(`chat-typing:${input.conversationId}:${input.userId}`, {
    config: { private: true, broadcast: { self: false, ack: true } },
  });
  const inboundChannel: RealtimeChannel = supabase.channel(`chat-typing:${input.conversationId}:${input.partnerId}`, {
    config: { private: true, broadcast: { self: false, ack: true } },
  });
  const controller = new TypingSignalController(
    async typing => {
      if (!active) return;
      const result = await outboundChannel.send({
        type: 'broadcast', event: 'typing',
        payload: { conversation_id: input.conversationId, generation: input.generation, typing },
      });
      if (result !== 'ok' && result !== 'timed out') throw new Error('chat_typing_signal_failed');
    },
    input.onRemoteChange,
  );

  inboundChannel.on('broadcast', { event: 'typing' }, ({ payload }) => {
    if (!active || payload?.conversation_id !== input.conversationId) return;
    controller.receiveRemote(payload?.typing === true);
  });

  const subscribe = (channel: RealtimeChannel) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chat_typing_subscribe_timeout')), CHAT_TYPING_SUBSCRIBE_TIMEOUT_MS);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timer); reject(new Error('chat_typing_channel_unavailable'));
      }
    });
  });
  await Promise.all([subscribe(outboundChannel), subscribe(inboundChannel)]).catch(async error => {
    active = false;
    controller.dispose();
    await Promise.all([supabase.removeChannel(outboundChannel), supabase.removeChannel(inboundChannel)]);
    throw error;
  });

  return {
    setTyping: hasText => controller.setLocalTyping(hasText),
    stop: () => controller.stop(),
    dispose: async () => {
      if (!active) return;
      try { await controller.stop(); } catch { /* channel may already be closed */ }
      active = false;
      controller.dispose();
      await Promise.all([supabase.removeChannel(outboundChannel), supabase.removeChannel(inboundChannel)]);
    },
  };
}
