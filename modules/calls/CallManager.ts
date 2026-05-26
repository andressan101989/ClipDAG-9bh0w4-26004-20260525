/**
 * modules/calls/CallManager.ts — Voice & Video Call lifecycle manager (stub v1)
 *
 * Architecture for future implementation:
 *   - WebRTC peer connection management
 *   - Signaling via Supabase Edge Functions (polling until WebSocket available)
 *   - Call state machine: idle → ringing → connecting → active → ended
 *   - Screen share, mute, camera flip controls
 *   - In-call BDAG gifting
 *
 * CURRENT STATE: Skeleton with types and state machine.
 * WebRTC is blocked in metro.config.js — must be unblocked before
 * implementing peer connections.
 *
 * EventBus integration:
 *   Emits:  call:incoming, call:accepted, call:ended, call:rejected
 *   Listens: wallet:connected (to enable in-call gifting)
 */

import { EventBus } from '../core/EventBus';

// ── Types ─────────────────────────────────────────────────────────────────────
export type CallType   = 'voice' | 'video';
export type CallStatus =
  | 'idle'
  | 'ringing_in'   // incoming call
  | 'ringing_out'  // outgoing call, waiting for answer
  | 'connecting'   // ICE negotiation
  | 'active'       // call in progress
  | 'ended'
  | 'rejected'
  | 'missed'
  | 'error';

export interface CallSession {
  callId:     string;
  roomId:     string;
  callType:   CallType;
  callerId:   string;
  calleeId:   string;
  status:     CallStatus;
  startedAt?: number;   // epoch ms when status → active
  endedAt?:   number;
  duration?:  number;   // ms
  isMuted:    boolean;
  isCameraOn: boolean;
}

export interface CallManagerAPI {
  /** Initiate an outgoing call. */
  startCall:  (calleeId: string, type: CallType) => Promise<{ callId: string } | { error: string }>;
  /** Accept an incoming call. */
  acceptCall: (callId: string) => Promise<void>;
  /** Reject an incoming call. */
  rejectCall: (callId: string) => Promise<void>;
  /** End the current active call. */
  endCall:    (callId: string) => Promise<void>;
  /** Toggle microphone. */
  toggleMute: (callId: string) => void;
  /** Toggle camera (video calls only). */
  toggleCamera: (callId: string) => void;
  /** Current call state. */
  readonly currentCall: CallSession | null;
  /** Whether any call is active. */
  readonly isInCall: boolean;
}

// ── Stub implementation ────────────────────────────────────────────────────────
// TODO: Replace with real WebRTC implementation when react-native-webrtc
//       is re-enabled in metro.config.js and react-native.config.js.
class CallManagerImpl implements CallManagerAPI {
  private _currentCall: CallSession | null = null;

  get currentCall(): CallSession | null { return this._currentCall; }
  get isInCall(): boolean { return this._currentCall?.status === 'active'; }

  async startCall(calleeId: string, type: CallType): Promise<{ callId: string } | { error: string }> {
    console.warn('[CallManager] WebRTC not yet enabled. Unblock react-native-webrtc in metro.config.js and react-native.config.js to implement real calls.');
    return { error: 'Llamadas en desarrollo — próximamente disponibles' };
  }

  async acceptCall(callId: string): Promise<void> {
    if (!this._currentCall || this._currentCall.callId !== callId) return;
    this._currentCall = { ...this._currentCall, status: 'connecting' };
    EventBus.emit('call:accepted', { callId, roomId: this._currentCall.roomId });
  }

  async rejectCall(callId: string): Promise<void> {
    if (!this._currentCall || this._currentCall.callId !== callId) return;
    const prev = this._currentCall;
    this._currentCall = { ...prev, status: 'rejected', endedAt: Date.now() };
    EventBus.emit('call:rejected', { callId });
    this._currentCall = null;
  }

  async endCall(callId: string): Promise<void> {
    if (!this._currentCall || this._currentCall.callId !== callId) return;
    const prev = this._currentCall;
    const duration = prev.startedAt ? Date.now() - prev.startedAt : 0;
    this._currentCall = { ...prev, status: 'ended', endedAt: Date.now(), duration };
    EventBus.emit('call:ended', { callId, duration });
    this._currentCall = null;
  }

  toggleMute(callId: string): void {
    if (this._currentCall?.callId !== callId) return;
    this._currentCall = { ...this._currentCall, isMuted: !this._currentCall.isMuted };
  }

  toggleCamera(callId: string): void {
    if (this._currentCall?.callId !== callId) return;
    this._currentCall = { ...this._currentCall, isCameraOn: !this._currentCall.isCameraOn };
  }

  /** Called when a remote notification arrives with an incoming call. */
  handleIncomingCall(callId: string, roomId: string, callerId: string, type: CallType): void {
    this._currentCall = {
      callId, roomId,
      callType:   type,
      callerId,
      calleeId:   '',   // filled by app after auth
      status:     'ringing_in',
      isMuted:    false,
      isCameraOn: type === 'video',
    };
    EventBus.emit('call:incoming', { callerId, callType: type, roomId });
  }
}

export const CallManager = new CallManagerImpl();

// ── React hook ─────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';

/** Hook: subscribe to current call state updates via EventBus. */
export function useCallState() {
  const [call, setCall] = useState<CallSession | null>(CallManager.currentCall);

  useEffect(() => {
    const unsubs = [
      EventBus.on('call:incoming',  () => setCall(CallManager.currentCall)),
      EventBus.on('call:accepted',  () => setCall(CallManager.currentCall)),
      EventBus.on('call:ended',     () => setCall(CallManager.currentCall)),
      EventBus.on('call:rejected',  () => setCall(CallManager.currentCall)),
    ];
    return () => { unsubs.forEach(fn => fn()); };
  }, []);

  return {
    call,
    isInCall:    call?.status === 'active',
    isRinging:   call?.status === 'ringing_in',
    startCall:   CallManager.startCall.bind(CallManager),
    acceptCall:  CallManager.acceptCall.bind(CallManager),
    rejectCall:  CallManager.rejectCall.bind(CallManager),
    endCall:     CallManager.endCall.bind(CallManager),
    toggleMute:  CallManager.toggleMute.bind(CallManager),
    toggleCamera:CallManager.toggleCamera.bind(CallManager),
  };
}
