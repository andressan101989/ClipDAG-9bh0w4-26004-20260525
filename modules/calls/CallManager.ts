/**
 * modules/calls/CallManager.ts — v2 Production WebRTC Call Manager
 *
 * Full implementation:
 *   - Real WebRTC peer connections via RTCManager
 *   - Real signaling via SignalingManager + Supabase
 *   - ICE handling, restart, reconnect
 *   - Mute/unmute, camera switching, audio routing
 *   - Call state machine: idle → ringing → connecting → active → ended
 *   - Background recovery (video muted, audio alive)
 *   - Resource cleanup guaranteed on all exit paths
 *   - No throw — all errors handled gracefully
 */

import { EventBus }        from '../core/EventBus';
import { RTCManager }      from '../realtime/RTCManager';
import { SignalingManager }from '../realtime/SignalingManager';
import { LeakDetector }    from '../core/LeakDetector';
import { AppLifecycle }    from '../core/AppLifecycle';
import type { RTCPeer, RTCConnectionState, RTCPeerStats } from '../realtime/RTCManager';

// ── Types ─────────────────────────────────────────────────────────────────────
export type CallType   = 'voice' | 'video';
export type CallStatus =
  | 'idle'
  | 'ringing_in'
  | 'ringing_out'
  | 'connecting'
  | 'active'
  | 'reconnecting'
  | 'ended'
  | 'rejected'
  | 'missed'
  | 'failed'
  | 'error';

export interface CallSession {
  callId:     string;
  roomId:     string;
  callType:   CallType;
  callerId:   string;
  calleeId:   string;
  status:     CallStatus;
  startedAt?: number;
  endedAt?:   number;
  duration?:  number;
  isMuted:    boolean;
  isCameraOn: boolean;
  isSpeaker:  boolean;
  stats?:     RTCPeerStats;
  localStream?: any;
  remoteStream?: any;
}

export interface CallResult {
  success: boolean;
  error?:  string;
  callId?: string;
}

// ── Ring timeout: auto-cancel unanswered outgoing call ──────────────────────
const RING_TIMEOUT_MS    = 45_000;
const RECONNECT_DELAY_MS = 2_000;

class CallManagerImpl {
  private _current:    CallSession | null = null;
  private _peer:       RTCPeer | null     = null;
  private _ringTimer:  ReturnType<typeof setTimeout> | null = null;
  private _leakToken:  string | null      = null;
  private _unsubs:     Array<() => void>  = [];
  private _handlers    = new Set<(s: CallSession | null) => void>();
  private _mountedRef  = { mounted: false };

  // ── Public state ──────────────────────────────────────────────────────────

  get currentCall(): CallSession | null { return this._current; }
  get isInCall():    boolean            { return this._current?.status === 'active'; }

  onCallChange(fn: (s: CallSession | null) => void): () => void {
    this._handlers.add(fn);
    return () => this._handlers.delete(fn);
  }

  // ── Outgoing call ─────────────────────────────────────────────────────────

  async startCall(
    localUserId: string,
    calleeId: string,
    type: CallType,
  ): Promise<CallResult> {
    if (this._current) {
      return { success: false, error: 'Ya hay una llamada activa' };
    }

    const callId = `call_${localUserId}_${calleeId}_${Date.now()}`;
    const roomId = `call:${[localUserId, calleeId].sort().join(':')}`;

    this._current = {
      callId, roomId, callType: type,
      callerId: localUserId, calleeId,
      status: 'ringing_out',
      isMuted: false, isCameraOn: type === 'video', isSpeaker: true,
    };
    this._mountedRef.mounted = true;
    this._leakToken = LeakDetector.track('socket', `call:${callId}`, 'CallManager');
    this._notify();
    EventBus.emit('call:ringing_out', { callId, calleeId, callType: type });

    // Ring timeout — cancel if unanswered
    this._ringTimer = setTimeout(() => {
      if (this._current?.status === 'ringing_out') {
        this._endWithStatus('missed');
        EventBus.emit('call:missed', { callId });
      }
    }, RING_TIMEOUT_MS);

    // Start RTC negotiation immediately (offer side)
    const rtcResult = await this._initRTC(roomId, localUserId, calleeId, 'offer', type);
    if (!rtcResult.success) {
      this._clearRingTimer();
      this._endWithStatus('error');
      return { success: false, error: rtcResult.error };
    }

    return { success: true, callId };
  }

  // ── Incoming call ─────────────────────────────────────────────────────────

  handleIncomingCall(
    callId: string,
    roomId: string,
    callerId: string,
    localUserId: string,
    type: CallType,
  ): void {
    if (this._current) {
      // Already in a call — reject silently
      SignalingManager.sendEnd(roomId, localUserId).catch(() => {});
      return;
    }
    this._current = {
      callId, roomId, callType: type,
      callerId, calleeId: localUserId,
      status: 'ringing_in',
      isMuted: false, isCameraOn: type === 'video', isSpeaker: true,
    };
    this._mountedRef.mounted = true;
    this._leakToken = LeakDetector.track('socket', `call:${callId}`, 'CallManager');
    this._notify();
    EventBus.emit('call:incoming', { callerId, callType: type, roomId, callId });
  }

  async acceptCall(localUserId: string): Promise<CallResult> {
    if (!this._current || this._current.status !== 'ringing_in') {
      return { success: false, error: 'Sin llamada entrante para aceptar' };
    }
    this._clearRingTimer();
    const { roomId, callerId, callType } = this._current;
    this._setStatus('connecting');

    const rtcResult = await this._initRTC(roomId, localUserId, callerId, 'answer', callType);
    if (!rtcResult.success) {
      this._endWithStatus('error');
      return { success: false, error: rtcResult.error };
    }
    EventBus.emit('call:accepted', { callId: this._current.callId, roomId });
    return { success: true };
  }

  async rejectCall(localUserId: string): Promise<void> {
    if (!this._current) return;
    const { roomId } = this._current;
    this._clearRingTimer();
    try { await SignalingManager.sendEnd(roomId, localUserId); } catch { /* ignore */ }
    this._endWithStatus('rejected');
    EventBus.emit('call:rejected', { callId: this._current?.callId });
  }

  async endCall(localUserId: string): Promise<void> {
    if (!this._current) return;
    const { roomId } = this._current;
    this._clearRingTimer();
    try { await SignalingManager.sendEnd(roomId, localUserId); } catch { /* ignore */ }
    await this._cleanup();
    this._endWithStatus('ended');
  }

  // ── Track controls ────────────────────────────────────────────────────────

  toggleMute(): boolean {
    if (!this._current || !this._peer) return false;
    const next = !this._current.isMuted;
    this._peer.setTrackEnabled('audio', !next);
    this._current = { ...this._current, isMuted: next };
    this._notify();
    return next;
  }

  toggleCamera(): boolean {
    if (!this._current || !this._peer) return false;
    const next = !this._current.isCameraOn;
    this._peer.setTrackEnabled('video', next);
    this._current = { ...this._current, isCameraOn: next };
    this._notify();
    return next;
  }

  async switchCamera(): Promise<void> {
    if (!this._peer) return;
    try { await this._peer.switchCamera(); } catch { /* ignore */ }
  }

  toggleSpeaker(): boolean {
    if (!this._current || !this._peer) return false;
    const next = !this._current.isSpeaker;
    this._peer.setAudioSpeaker(next);
    this._current = { ...this._current, isSpeaker: next };
    this._notify();
    return next;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _initRTC(
    roomId:      string,
    localUserId: string,
    remoteId:    string,
    role:        'offer' | 'answer',
    callType:    CallType,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const peer = await RTCManager.createPeer(roomId, localUserId, remoteId, {
        audioOnly:       callType === 'voice',
        maxReconnects:   5,
        iceTimeoutMs:    15_000,
        statsIntervalMs: 3_000,
      });
      this._peer = peer;

      peer.onStateChange((s: RTCConnectionState) => {
        if (!this._mountedRef.mounted) return;
        this._onRTCStateChange(s);
      });

      peer.onRemoteTrack((_track: any, stream: any) => {
        if (!this._current || !this._mountedRef.mounted) return;
        this._current = { ...this._current, remoteStream: stream };
        this._notify();
        EventBus.emit('call:track_received', { roomId, stream });
      });

      peer.onStats((stats: RTCPeerStats) => {
        if (!this._current || !this._mountedRef.mounted) return;
        this._current = { ...this._current, stats };
        this._notify();
      });

      peer.onError((err: string) => {
        console.warn('[CallManager] RTC error:', err);
        EventBus.emit('call:error', { error: err });
      });

      // Background: mute video, keep audio
      this._unsubs.push(
        AppLifecycle.onBackground(() => {
          if (this._current?.isCameraOn) peer.setTrackEnabled('video', false);
        }),
        AppLifecycle.onForeground(() => {
          if (this._current?.isCameraOn) peer.setTrackEnabled('video', true);
        }),
      );

      await peer.negotiate(role);

      // After negotiate, expose local stream
      if (peer.localStream && this._current && this._mountedRef.mounted) {
        this._current = { ...this._current, localStream: peer.localStream };
        this._notify();
      }

      return { success: true };
    } catch (e: any) {
      console.warn('[CallManager] _initRTC error:', e?.message);
      return { success: false, error: e?.message ?? 'RTC init failed' };
    }
  }

  private _onRTCStateChange(s: RTCConnectionState): void {
    if (!this._current) return;
    switch (s) {
      case 'connected':
        this._setStatus('active');
        this._current = { ...this._current, startedAt: this._current.startedAt ?? Date.now() };
        this._notify();
        EventBus.emit('call:connected', { callId: this._current.callId });
        break;
      case 'reconnecting':
        this._setStatus('reconnecting');
        EventBus.emit('call:reconnecting', { callId: this._current.callId });
        break;
      case 'failed':
        this._endWithStatus('failed');
        EventBus.emit('call:failed', { callId: this._current?.callId });
        break;
      case 'closed':
        if (this._current.status !== 'ended' &&
            this._current.status !== 'rejected' &&
            this._current.status !== 'missed') {
          this._endWithStatus('ended');
        }
        break;
      default:
        break;
    }
  }

  private _setStatus(status: CallStatus): void {
    if (!this._current) return;
    this._current = { ...this._current, status };
    this._notify();
  }

  private _endWithStatus(status: CallStatus): void {
    if (!this._current) return;
    const startedAt = this._current.startedAt;
    const duration  = startedAt ? Date.now() - startedAt : 0;
    this._current = { ...this._current, status, endedAt: Date.now(), duration };
    this._notify();
    this._mountedRef.mounted = false;
    this._cleanup();
    // Defer null so listeners can read final state
    setTimeout(() => {
      this._current = null;
      this._notify();
    }, 800);
    if (this._leakToken) { LeakDetector.release(this._leakToken); this._leakToken = null; }
    EventBus.emit('call:ended', { status, duration });
  }

  private async _cleanup(): Promise<void> {
    this._clearRingTimer();
    for (const fn of this._unsubs) { try { fn(); } catch { /* ignore */ } }
    this._unsubs = [];
    if (this._peer) {
      try { await this._peer.close(); } catch { /* ignore */ }
      this._peer = null;
    }
  }

  private _clearRingTimer(): void {
    if (this._ringTimer) { clearTimeout(this._ringTimer); this._ringTimer = null; }
  }

  private _notify(): void {
    const snapshot = this._current;
    for (const fn of this._handlers) { try { fn(snapshot); } catch { /* isolate */ } }
  }
}

export const CallManager = new CallManagerImpl();

// ── React hook ─────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';

export function useCallState() {
  const [call, setCall] = useState<CallSession | null>(CallManager.currentCall);

  useEffect(() => {
    const unsub = CallManager.onCallChange(setCall);
    return unsub;
  }, []);

  return {
    call,
    isInCall:      call?.status === 'active',
    isRinging:     call?.status === 'ringing_in',
    isConnecting:  call?.status === 'connecting' || call?.status === 'ringing_out',
    isReconnecting:call?.status === 'reconnecting',
    localStream:   call?.localStream  ?? null,
    remoteStream:  call?.remoteStream ?? null,
    stats:         call?.stats        ?? null,
    startCall:  CallManager.startCall.bind(CallManager),
    acceptCall: CallManager.acceptCall.bind(CallManager),
    rejectCall: CallManager.rejectCall.bind(CallManager),
    endCall:    CallManager.endCall.bind(CallManager),
    toggleMute:    () => CallManager.toggleMute(),
    toggleCamera:  () => CallManager.toggleCamera(),
    toggleSpeaker: () => CallManager.toggleSpeaker(),
    switchCamera:  () => CallManager.switchCamera(),
    handleIncomingCall: CallManager.handleIncomingCall.bind(CallManager),
  };
}
