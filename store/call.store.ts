/**
 * store/call.store.ts — Call domain store
 *
 * Single source of truth for voice/video call state.
 * CallManager writes here; UI hooks subscribe for reactive rendering.
 */

import { EventBus } from '@/modules/core/EventBus';

export type CallType   = 'voice' | 'video';
export type CallStatus =
  | 'idle'
  | 'ringing_in'
  | 'ringing_out'
  | 'connecting'
  | 'active'
  | 'ended'
  | 'rejected'
  | 'missed'
  | 'error';

export interface CallParticipant {
  userId:     string;
  username:   string;
  avatarUrl?: string;
  isMuted:    boolean;
  isCameraOn: boolean;
  isRemote:   boolean;
}

export interface CallState {
  callId?:      string;
  roomId?:      string;
  callType:     CallType;
  status:       CallStatus;
  startedAt?:   number;
  endedAt?:     number;
  duration?:    number;
  localMuted:   boolean;
  localCamera:  boolean;
  participants: CallParticipant[];
  error?:       string;
}

const INITIAL: CallState = {
  callType:     'voice',
  status:       'idle',
  localMuted:   false,
  localCamera:  true,
  participants: [],
};

class CallStoreImpl {
  private _state: CallState = { ...INITIAL };
  private readonly _subs = new Set<(s: CallState) => void>();

  getState():   CallState { return this._state; }
  get isIdle(): boolean   { return this._state.status === 'idle'; }
  get isActive():boolean  { return this._state.status === 'active'; }

  setState(patch: Partial<CallState>): void {
    this._state = { ...this._state, ...patch };
    this._notify();
  }

  addParticipant(p: CallParticipant): void {
    const existing = this._state.participants.findIndex(x => x.userId === p.userId);
    const list = [...this._state.participants];
    if (existing >= 0) list[existing] = p;
    else list.push(p);
    this.setState({ participants: list });
  }

  removeParticipant(userId: string): void {
    this.setState({ participants: this._state.participants.filter(p => p.userId !== userId) });
  }

  reset(): void {
    this._state = { ...INITIAL };
    this._notify();
  }

  subscribe(fn: (s: CallState) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  private _notify(): void {
    for (const fn of this._subs) {
      try { fn(this._state); } catch { /* isolate */ }
    }
  }
}

export const CallStore = new CallStoreImpl();

// Sync CallStore ↔ EventBus
EventBus.on('call:ended',    ({ duration }) => CallStore.setState({ status: 'ended', endedAt: Date.now(), duration }));
EventBus.on('call:rejected', ()              => CallStore.setState({ status: 'rejected' }));
EventBus.on('call:accepted', ({ callId, roomId }) => CallStore.setState({ callId, roomId, status: 'connecting' }));
EventBus.on('call:incoming', ({ callerId, callType, roomId }) =>
  CallStore.setState({ status: 'ringing_in', callType, roomId, participants: [] })
);
