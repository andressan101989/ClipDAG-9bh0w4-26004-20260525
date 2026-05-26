/**
 * store/stream.store.ts — Live streaming domain store
 *
 * Single source of truth for live stream session state.
 * StreamManager writes here; stream UI subscribes for reactive rendering.
 */

import { EventBus } from '@/modules/core/EventBus';

export type StreamRole   = 'host' | 'viewer' | 'co-host';
export type StreamStatus = 'idle' | 'preparing' | 'live' | 'ending' | 'ended' | 'error';

export interface StreamGiftEvent {
  senderId:  string;
  username:  string;
  giftType:  string;
  dagValue:  number;
  timestamp: number;
}

export interface StreamMessage {
  id:        string;
  userId:    string;
  username:  string;
  avatarUrl?: string;
  text:      string;
  timestamp: number;
}

export interface StreamState {
  sessionId?:    string;
  hostId?:       string;
  title?:        string;
  status:        StreamStatus;
  role:          StreamRole;
  viewerCount:   number;
  startedAt?:    number;
  endedAt?:      number;
  // Ephemeral collections — capped to last N items for memory safety
  recentGifts:   StreamGiftEvent[];   // max 30
  messages:      StreamMessage[];     // max 100
  totalEarned:   number;              // BDAG earned this session (host only)
  error?:        string;
}

const INITIAL: StreamState = {
  status:      'idle',
  role:        'viewer',
  viewerCount: 0,
  recentGifts: [],
  messages:    [],
  totalEarned: 0,
};

const MAX_GIFTS    = 30;
const MAX_MESSAGES = 100;

class StreamStoreImpl {
  private _state: StreamState = { ...INITIAL };
  private readonly _subs = new Set<(s: StreamState) => void>();

  getState():    StreamState { return this._state; }
  get isLive():  boolean     { return this._state.status === 'live'; }

  setState(patch: Partial<StreamState>): void {
    this._state = { ...this._state, ...patch };
    this._notify();
  }

  pushGift(gift: StreamGiftEvent): void {
    const gifts = [...this._state.recentGifts, gift];
    if (gifts.length > MAX_GIFTS) gifts.splice(0, gifts.length - MAX_GIFTS);
    this.setState({
      recentGifts: gifts,
      totalEarned: this._state.totalEarned + gift.dagValue,
    });
  }

  pushMessage(msg: StreamMessage): void {
    const messages = [...this._state.messages, msg];
    if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
    this.setState({ messages });
  }

  reset(): void {
    this._state = { ...INITIAL };
    this._notify();
  }

  subscribe(fn: (s: StreamState) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  private _notify(): void {
    for (const fn of this._subs) {
      try { fn(this._state); } catch { /* isolate */ }
    }
  }
}

export const StreamStore = new StreamStoreImpl();

// Sync StreamStore ↔ EventBus
EventBus.on('stream:started',       ({ hostId, sessionId, title }) =>
  StreamStore.setState({ hostId, sessionId, title, status: 'live', startedAt: Date.now() })
);
EventBus.on('stream:ended',         ({ sessionId }) =>
  StreamStore.setState({ status: 'ended', endedAt: Date.now() })
);
EventBus.on('stream:gift_received', ({ giftType, senderId, sessionId }) =>
  StreamStore.pushGift({ senderId, username: senderId, giftType, dagValue: 0, timestamp: Date.now() })
);
