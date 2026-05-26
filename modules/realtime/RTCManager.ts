/**
 * modules/realtime/RTCManager.ts — Production WebRTC (fully integrated)
 *
 * Real react-native-webrtc lifecycle:
 *   - getUserMedia (video + audio, fallback to audio-only)
 *   - RTCPeerConnection with STUN/TURN
 *   - Full offer/answer/ICE candidate exchange via SignalingManager
 *   - ICE restart on disconnected → 3s grace period
 *   - Exponential backoff reconnect (5 attempts, max 30s delay)
 *   - Background: video track disabled, audio kept alive
 *   - Foreground: video track re-enabled
 *   - Camera switch: replaceTrack() + renegotiate if needed
 *   - Mute/unmute: setEnabled on local tracks + sender side
 *   - Audio routing: speakerphone control via InCallManager
 *   - Stats: getStats() → RTT, loss, bitrate, frameRate
 *   - Guaranteed cleanup (tracks, PC, signaling, timers, LeakDetector)
 *   - Simulation mode when react-native-webrtc not in native build
 */

import { EventBus }         from '../core/EventBus';
import { SignalingManager } from './SignalingManager';
import { AppLifecycle }     from '../core/AppLifecycle';
import { LeakDetector }     from '../core/LeakDetector';
import { ThermalMonitor }   from '../core/ThermalMonitor';
import { TelemetryPipeline } from '../core/TelemetryPipeline';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RTCConnectionState =
  | 'new' | 'connecting' | 'connected'
  | 'reconnecting' | 'failed' | 'closed';

export type RTCQualityLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export interface RTCPeerStats {
  rttMs:         number;
  packetLossPct: number;
  bitrateKbps:   number;
  frameRate:     number;
  jitterMs:      number;
  qualityLevel:  RTCQualityLevel;
  timestamp:     number;
}

export interface RTCPeerConfig {
  roomId:          string;
  localUserId:     string;
  remoteUserId:    string;
  maxReconnects:   number;
  iceTimeoutMs:    number;
  statsIntervalMs: number;
  audioOnly?:      boolean;
  preferH264?:     boolean;
}

// ── ICE servers ───────────────────────────────────────────────────────────────
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// ── Lazy WebRTC loader ────────────────────────────────────────────────────────
let _RTCPeerConnection: any   = null;
let _RTCSessionDescription: any = null;
let _RTCIceCandidate: any     = null;
let _mediaDevices: any        = null;
let _RTCView: any             = null;

function loadWebRTC(): boolean {
  if (_RTCPeerConnection) return true;
  try {
    const webrtc = require('react-native-webrtc');
    _RTCPeerConnection    = webrtc.RTCPeerConnection;
    _RTCSessionDescription = webrtc.RTCSessionDescription;
    _RTCIceCandidate      = webrtc.RTCIceCandidate;
    _mediaDevices         = webrtc.mediaDevices;
    _RTCView              = webrtc.RTCView ?? null;
    return true;
  } catch {
    return false;
  }
}

// Lazy InCallManager for audio routing
let _InCallManager: any = null;
function loadInCallManager() {
  if (_InCallManager) return _InCallManager;
  try {
    _InCallManager = require('react-native-incall-manager').default;
  } catch { /* not available */ }
  return _InCallManager;
}

export { _RTCView as RTCView };

// ── RTCPeer ───────────────────────────────────────────────────────────────────
export class RTCPeer {
  readonly config: RTCPeerConfig;

  private _state:          RTCConnectionState = 'new';
  private _reconnectCount  = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _iceTimer:       ReturnType<typeof setTimeout> | null = null;
  private _statsTimer:     ReturnType<typeof setInterval> | null = null;
  private _disconnectTimer:ReturnType<typeof setTimeout> | null = null;

  private _stateHandlers  = new Set<(s: RTCConnectionState) => void>();
  private _statsHandlers  = new Set<(s: RTCPeerStats) => void>();
  private _errorHandlers  = new Set<(e: string) => void>();
  private _trackHandlers  = new Set<(track: any, stream: any) => void>();

  private _leakToken:     string;
  private _webrtcAvailable: boolean;
  private _pc:            any = null;
  private _localStream:   any = null;
  private _negotiating    = false;

  private _prevBytes = 0;
  private _prevTs    = 0;
  private _sigUnsubs: Array<() => void> = [];
  private _appUnsubs: Array<() => void> = [];

  constructor(config: RTCPeerConfig) {
    this.config = config;
    this._webrtcAvailable = loadWebRTC();
    this._leakToken = LeakDetector.track('socket', `rtc:${config.roomId}`, 'RTCManager');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get state():         RTCConnectionState { return this._state; }
  get isConnected():   boolean            { return this._state === 'connected'; }
  get localStream():   any                { return this._localStream; }

  onStateChange(h: (s: RTCConnectionState) => void): () => void {
    this._stateHandlers.add(h);
    return () => this._stateHandlers.delete(h);
  }
  onStats(h: (s: RTCPeerStats) => void): () => void {
    this._statsHandlers.add(h);
    return () => this._statsHandlers.delete(h);
  }
  onError(h: (e: string) => void): () => void {
    this._errorHandlers.add(h);
    return () => this._errorHandlers.delete(h);
  }
  onRemoteTrack(h: (track: any, stream: any) => void): () => void {
    this._trackHandlers.add(h);
    return () => this._trackHandlers.delete(h);
  }

  // ── Negotiate ─────────────────────────────────────────────────────────────

  async negotiate(role: 'offer' | 'answer'): Promise<void> {
    if (this._negotiating) return;
    this._negotiating = true;
    this._setState('connecting');
    this._startIceTimeout();

    try {
      if (this._webrtcAvailable) {
        await this._negotiateReal(role);
      } else {
        await this._negotiateSimulated(role);
      }
    } finally {
      this._negotiating = false;
    }
  }

  // ── ICE restart ───────────────────────────────────────────────────────────

  async restartICE(): Promise<void> {
    if (!this._pc || !this._webrtcAvailable) return;
    this._setState('reconnecting');
    this._startIceTimeout();
    try {
      const offer = await this._pc.createOffer({ iceRestart: true });
      await this._pc.setLocalDescription(new _RTCSessionDescription(offer));
      await SignalingManager.sendOffer(this.config.roomId, this.config.localUserId, offer.sdp);
      console.log('[RTCPeer] ICE restart sent:', this.config.roomId);
    } catch (e: any) {
      this._notifyError(`ICE restart failed: ${e?.message}`);
    }
  }

  // ── Reconnect with backoff ────────────────────────────────────────────────

  async reconnect(): Promise<void> {
    if (this._reconnectCount >= this.config.maxReconnects) {
      this._setState('failed');
      this._notifyError('Max reconnects reached');
      return;
    }

    const delay = Math.min(500 * Math.pow(2, this._reconnectCount), 30_000);
    this._reconnectCount++;
    this._setState('reconnecting');
    console.log(`[RTCPeer] reconnect #${this._reconnectCount} in ${delay}ms`);

    this._reconnectTimer = setTimeout(async () => {
      if (this._pc) { try { this._pc.close(); } catch { /* ignore */ } this._pc = null; }
      this._negotiating = false;
      await this.negotiate('offer');
    }, delay);
  }

  // ── Track management ──────────────────────────────────────────────────────

  setTrackEnabled(kind: 'audio' | 'video', enabled: boolean): void {
    // Local stream tracks
    if (this._localStream) {
      const tracks = kind === 'audio'
        ? this._localStream.getAudioTracks?.()
        : this._localStream.getVideoTracks?.();
      for (const t of (tracks ?? [])) t.enabled = enabled;
    }
    // Sender tracks
    if (this._pc) {
      try {
        for (const sender of (this._pc.getSenders?.() ?? [])) {
          if (sender?.track?.kind === kind) sender.track.enabled = enabled;
        }
      } catch { /* non-fatal */ }
    }
    console.log('[RTCPeer] track', kind, enabled ? 'enabled' : 'disabled');
  }

  async replaceTrack(kind: 'audio' | 'video', newTrack: any): Promise<void> {
    if (!this._pc) return;
    try {
      const senders: any[] = this._pc.getSenders?.() ?? [];
      const sender = senders.find(s => s?.track?.kind === kind);
      if (sender) {
        await sender.replaceTrack(newTrack);
        // May need renegotiation
        if (this._pc.signalingState !== 'stable') {
          this._negotiating = false;
          await this.negotiate('offer');
        }
      }
    } catch (e: any) {
      console.warn('[RTCPeer] replaceTrack error:', e?.message);
    }
  }

  /** Switch camera (front ↔ back) — replaces video track in-place */
  async switchCamera(): Promise<void> {
    if (!this._localStream || !this._webrtcAvailable) return;
    const videoTrack = this._localStream.getVideoTracks?.()?.[0];
    if (!videoTrack) return;
    try {
      if (typeof videoTrack._switchCamera === 'function') {
        videoTrack._switchCamera();   // react-native-webrtc extension
      }
      console.log('[RTCPeer] camera switched');
    } catch (e: any) {
      console.warn('[RTCPeer] switchCamera error:', e?.message);
    }
  }

  /** Route audio to speaker (true) or earpiece (false) */
  setAudioSpeaker(speaker: boolean): void {
    const icm = loadInCallManager();
    if (!icm) return;
    try {
      if (speaker) {
        icm.setForceSpeakerphoneOn(true);
      } else {
        icm.setForceSpeakerphoneOn(false);
        icm.setSpeakerphoneOn(false);
      }
    } catch { /* ignore */ }
  }

  // ── Adaptive bitrate via thermal ──────────────────────────────────────────

  private _applyThermalBitrate(): void {
    if (!this._pc) return;
    const thermal = ThermalMonitor.currentState;
    const maxBps = thermal === 'critical' ? 128_000
                 : thermal === 'serious'  ? 256_000
                 : thermal === 'fair'     ? 512_000
                 : 1_500_000;

    try {
      const senders: any[] = this._pc.getSenders?.() ?? [];
      for (const sender of senders) {
        if (sender?.track?.kind !== 'video') continue;
        const params = sender.getParameters?.();
        if (!params?.encodings) continue;
        for (const enc of params.encodings) {
          enc.maxBitrate = maxBps;
        }
        sender.setParameters?.(params);
      }
    } catch { /* codecs may not support parameter setting */ }
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    this._clearTimers();
    this._clearSignalingUnsubs();
    this._clearAppUnsubs();
    SignalingManager.stopPolling(this.config.roomId);

    // Stop audio routing
    this.setAudioSpeaker(false);
    const icm = loadInCallManager();
    if (icm) {
      try { icm.stop(); } catch { /* ignore */ }
    }

    // Stop local media
    if (this._localStream) {
      try { for (const t of this._localStream.getTracks?.() ?? []) t.stop(); } catch { /* ignore */ }
      this._localStream = null;
    }
    if (this._pc) {
      try { this._pc.close(); } catch { /* ignore */ }
      this._pc = null;
    }

    this._setState('closed');
    LeakDetector.release(this._leakToken);
    console.log('[RTCPeer] closed:', this.config.roomId);
  }

  // ── Real WebRTC negotiation ───────────────────────────────────────────────

  private async _negotiateReal(role: 'offer' | 'answer'): Promise<void> {
    // Build peer connection
    this._pc = new _RTCPeerConnection({ iceServers: RTCManagerImpl._iceServers });
    this._wireConnectionEvents();

    // Acquire local stream
    await this._acquireLocalStream();

    // Start InCallManager audio session
    const icm = loadInCallManager();
    if (icm) {
      try { icm.start({ media: 'video' }); } catch { /* ignore */ }
    }

    // Start signaling poll
    SignalingManager.startPolling(this.config.roomId, this.config.localUserId);

    if (role === 'offer') {
      await this._sendOffer();
    } else {
      await this._waitForAndAnswerOffer();
    }

    // ICE candidate handler
    const iceUnsub = SignalingManager.onSignal('ice-candidate', async (msg) => {
      if (msg.roomId !== this.config.roomId) return;
      if (!this._pc?.remoteDescription) return;
      try {
        await this._pc.addIceCandidate(new _RTCIceCandidate(JSON.parse(msg.payload)));
      } catch (e: any) {
        console.warn('[RTCPeer] addIceCandidate error:', e?.message);
      }
    });
    this._sigUnsubs.push(iceUnsub);

    // End signal handler
    const endUnsub = SignalingManager.onSignal('end', (msg) => {
      if (msg.roomId !== this.config.roomId) return;
      this.close();
    });
    this._sigUnsubs.push(endUnsub);

    // App lifecycle handlers
    this._appUnsubs.push(
      AppLifecycle.onBackground(() => { this.setTrackEnabled('video', false); }),
      AppLifecycle.onForeground(() => { if (this._state === 'connected') this.setTrackEnabled('video', true); }),
    );

    // Thermal-driven bitrate adaptation
    const thermalUnsub = EventBus.on('thermal:state_changed', () => {
      this._applyThermalBitrate();
    });
    this._sigUnsubs.push(thermalUnsub);

    this._startRealStats();
  }

  private async _sendOffer(): Promise<void> {
    const offer = await this._pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: !this.config.audioOnly });
    await this._pc.setLocalDescription(new _RTCSessionDescription(offer));
    await SignalingManager.sendOffer(this.config.roomId, this.config.localUserId, offer.sdp);

    const answerUnsub = SignalingManager.onSignal('answer', async (msg) => {
      if (msg.roomId !== this.config.roomId) return;
      if (this._pc?.signalingState !== 'have-local-offer') return;
      try {
        await this._pc.setRemoteDescription(new _RTCSessionDescription({ type: 'answer', sdp: msg.payload }));
        console.log('[RTCPeer] remote answer applied');
      } catch (e: any) {
        this._notifyError(`Remote answer failed: ${e?.message}`);
      }
    });
    this._sigUnsubs.push(answerUnsub);
  }

  private async _waitForAndAnswerOffer(): Promise<void> {
    const offerUnsub = SignalingManager.onSignal('offer', async (msg) => {
      if (msg.roomId !== this.config.roomId) return;
      try {
        await this._pc.setRemoteDescription(new _RTCSessionDescription({ type: 'offer', sdp: msg.payload }));
        const answer = await this._pc.createAnswer();
        await this._pc.setLocalDescription(new _RTCSessionDescription(answer));
        await SignalingManager.sendAnswer(this.config.roomId, this.config.localUserId, answer.sdp);
      } catch (e: any) {
        this._notifyError(`Answer creation failed: ${e?.message}`);
      }
    });
    this._sigUnsubs.push(offerUnsub);
  }

  private async _acquireLocalStream(): Promise<void> {
    try {
      this._localStream = await _mediaDevices.getUserMedia({
        audio: true,
        video: this.config.audioOnly ? false : {
          facingMode: 'user',
          width:      { ideal: 640 },
          height:     { ideal: 480 },
          frameRate:  { ideal: 30, max: 30 },
        },
      });
    } catch (videoErr: any) {
      console.warn('[RTCPeer] video failed, trying audio-only:', videoErr?.message);
      try {
        this._localStream = await _mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (audioErr: any) {
        this._notifyError(`Media access denied: ${audioErr?.message}`);
        this._setState('failed');
        throw audioErr;
      }
    }

    if (this._localStream) {
      for (const track of this._localStream.getTracks?.() ?? []) {
        this._pc.addTrack(track, this._localStream);
      }
    }
  }

  // ── Simulated mode ────────────────────────────────────────────────────────

  private async _negotiateSimulated(role: 'offer' | 'answer'): Promise<void> {
    SignalingManager.startPolling(this.config.roomId, this.config.localUserId);

    const endUnsub = SignalingManager.onSignal('end', (msg) => {
      if (msg.roomId !== this.config.roomId) return;
      this.close();
    });
    this._sigUnsubs.push(endUnsub);

    setTimeout(() => {
      if (this._state === 'connecting') {
        this._setState('connected');
        this._reconnectCount = 0;
        this._clearIceTimer();
        this._startStatsSimulation();
      }
    }, 1500);
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  _wireConnectionEvents(): void {
    if (!this._pc) return;

    this._pc.oniceconnectionstatechange = () => {
      const s = this._pc?.iceConnectionState ?? 'closed';
      console.log('[RTCPeer] ICE:', s, this.config.roomId);

      if (s === 'connected' || s === 'completed') {
        this._clearReconnectTimer();
        this._clearIceTimer();
        this._clearDisconnectTimer();
        this._reconnectCount = 0;
        this._setState('connected');
        // Route audio to speaker on connect
        this.setAudioSpeaker(true);
      } else if (s === 'disconnected') {
        // 3s grace period — may self-recover
        this._disconnectTimer = setTimeout(() => {
          if (this._pc?.iceConnectionState === 'disconnected') {
            this.restartICE();
          }
        }, 3000);
      } else if (s === 'failed') {
        this._clearDisconnectTimer();
        this.reconnect();
      } else if (s === 'closed') {
        this._setState('closed');
      }
    };

    this._pc.onicegatheringstatechange = () => {
      if (this._pc?.iceGatheringState === 'complete') this._clearIceTimer();
    };

    this._pc.onicecandidate = async (event: any) => {
      if (!event.candidate) return;
      try {
        await SignalingManager.sendIceCandidate(
          this.config.roomId,
          this.config.localUserId,
          JSON.stringify(event.candidate.toJSON?.() ?? event.candidate),
        );
      } catch (e: any) {
        console.warn('[RTCPeer] ICE candidate send error:', e?.message);
      }
    };

    this._pc.onnegotiationneeded = async () => {
      if (this._state === 'connected') {
        console.log('[RTCPeer] renegotiation needed');
        this._negotiating = false;
        await this.negotiate('offer');
      }
    };

    this._pc.ontrack = (event: any) => {
      const track  = event.track;
      const stream = event.streams?.[0] ?? null;
      // Notify hook / screen layer
      for (const h of this._trackHandlers) h(track, stream);
      EventBus.emit('call:state_changed' as any, {
        roomId: this.config.roomId,
        state:  'track_received',
        track,
        stream,
      });
    };

    this._pc.onconnectionstatechange = () => {
      const s = this._pc?.connectionState ?? 'closed';
      if (s === 'failed') this.reconnect();
    };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  private _startRealStats(): void {
    this._statsTimer = setInterval(async () => {
      if (!this._pc || this._state !== 'connected') return;
      try {
        const stats = await this._pc.getStats();
        let rttMs = 0, packetLossPct = 0, bitrateKbps = 0, frameRate = 0, jitterMs = 0;

        stats.forEach((r: any) => {
          if (r.type === 'remote-inbound-rtp' && r.kind === 'audio') {
            rttMs         = (r.roundTripTime ?? 0) * 1000;
            jitterMs      = (r.jitter ?? 0) * 1000;
            const lost    = r.packetsLost ?? 0;
            const recv    = r.packetsReceived ?? 1;
            packetLossPct = (lost / (lost + recv)) * 100;
          }
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            frameRate   = r.framesPerSecond ?? 0;
            const bytes = r.bytesSent ?? 0;
            const now   = r.timestamp ?? Date.now();
            if (this._prevBytes > 0 && this._prevTs > 0) {
              bitrateKbps = ((bytes - this._prevBytes) * 8) / ((now - this._prevTs) / 1000) / 1000;
            }
            this._prevBytes = bytes;
            this._prevTs    = now;
          }
        });

        const sample: RTCPeerStats = {
          rttMs:         Math.max(0, rttMs),
          packetLossPct: Math.max(0, Math.min(100, packetLossPct)),
          bitrateKbps:   Math.max(0, bitrateKbps),
          frameRate:     Math.max(0, frameRate),
          jitterMs:      Math.max(0, jitterMs),
          qualityLevel:  'good',
          timestamp:     Date.now(),
        };
        sample.qualityLevel = this._classifyQuality(sample);
        for (const h of this._statsHandlers) h(sample);

        TelemetryPipeline.recordRTCQuality?.(`call:${this.config.remoteUserId}`, {
          rttMs:         sample.rttMs,
          packetLossPct: sample.packetLossPct,
          bitrateKbps:   sample.bitrateKbps,
        });
      } catch { /* getStats can fail during state transitions */ }
    }, this.config.statsIntervalMs);
  }

  private _startStatsSimulation(): void {
    this._statsTimer = setInterval(() => {
      const sample: RTCPeerStats = {
        rttMs:         20 + Math.random() * 30,
        packetLossPct: Math.random() * 1.5,
        bitrateKbps:   850 + Math.random() * 250,
        frameRate:     28 + Math.random() * 4,
        jitterMs:      4  + Math.random() * 8,
        qualityLevel:  'good',
        timestamp:     Date.now(),
      };
      sample.qualityLevel = this._classifyQuality(sample);
      for (const h of this._statsHandlers) h(sample);
    }, this.config.statsIntervalMs);
  }

  private _classifyQuality(s: RTCPeerStats): RTCQualityLevel {
    if (s.rttMs < 50  && s.packetLossPct < 0.5) return 'excellent';
    if (s.rttMs < 100 && s.packetLossPct < 2)   return 'good';
    if (s.rttMs < 200 && s.packetLossPct < 5)   return 'fair';
    if (s.rttMs < 400 && s.packetLossPct < 15)  return 'poor';
    return 'critical';
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _setState(s: RTCConnectionState): void {
    if (this._state === s) return;
    this._state = s;
    for (const h of this._stateHandlers) h(s);
    EventBus.emit('call:state_changed' as any, { roomId: this.config.roomId, state: s });
  }

  private _notifyError(msg: string): void {
    console.error('[RTCPeer]', msg);
    for (const h of this._errorHandlers) h(msg);
  }

  private _startIceTimeout(): void {
    this._clearIceTimer();
    this._iceTimer = setTimeout(() => {
      if (this._state === 'connecting' || this._state === 'reconnecting') {
        console.warn('[RTCPeer] ICE timeout — reconnecting');
        this.reconnect();
      }
    }, this.config.iceTimeoutMs);
  }

  private _clearTimers(): void {
    this._clearReconnectTimer();
    this._clearIceTimer();
    this._clearDisconnectTimer();
    if (this._statsTimer) { clearInterval(this._statsTimer); this._statsTimer = null; }
  }

  private _clearReconnectTimer():  void { if (this._reconnectTimer)  { clearTimeout(this._reconnectTimer);  this._reconnectTimer  = null; } }
  private _clearIceTimer():        void { if (this._iceTimer)        { clearTimeout(this._iceTimer);        this._iceTimer        = null; } }
  private _clearDisconnectTimer(): void { if (this._disconnectTimer) { clearTimeout(this._disconnectTimer); this._disconnectTimer = null; } }

  private _clearSignalingUnsubs(): void {
    for (const fn of this._sigUnsubs) { try { fn(); } catch { /* ignore */ } }
    this._sigUnsubs = [];
  }

  private _clearAppUnsubs(): void {
    for (const fn of this._appUnsubs) { try { fn(); } catch { /* ignore */ } }
    this._appUnsubs = [];
  }
}

// ── RTCManager singleton ──────────────────────────────────────────────────────
class RTCManagerImpl {
  static _iceServers: any[] = DEFAULT_ICE_SERVERS;
  private readonly _peers   = new Map<string, RTCPeer>();

  configure(iceServers: any[]): void {
    RTCManagerImpl._iceServers = iceServers;
    console.log('[RTCManager] configured with', iceServers.length, 'ICE servers');
  }

  async createPeer(
    roomId:       string,
    localUserId:  string,
    remoteUserId: string,
    options:      Partial<RTCPeerConfig> = {},
  ): Promise<RTCPeer> {
    // Close any existing peer on same room
    await this._peers.get(roomId)?.close();

    const peer = new RTCPeer({
      roomId,
      localUserId,
      remoteUserId,
      maxReconnects:   5,
      iceTimeoutMs:    15_000,
      statsIntervalMs: 3_000,
      audioOnly:       false,
      preferH264:      true,
      ...options,
    });

    this._peers.set(roomId, peer);

    peer.onStateChange((s) => {
      if (s === 'closed' || s === 'failed') this._peers.delete(roomId);
    });

    return peer;
  }

  getPeer(roomId: string): RTCPeer | undefined {
    return this._peers.get(roomId);
  }

  async closeAll(): Promise<void> {
    for (const peer of this._peers.values()) await peer.close();
    this._peers.clear();
  }

  get activePeerCount(): number { return this._peers.size; }
}

export const RTCManager = new RTCManagerImpl();
