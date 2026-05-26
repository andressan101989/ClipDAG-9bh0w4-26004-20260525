/**
 * modules/realtime/RTCManager.ts — WebRTC production implementation
 *
 * Full RTC peer lifecycle with real react-native-webrtc integration:
 *   - RTCPeerConnection with STUN/TURN servers
 *   - Real offer/answer negotiation via SignalingManager
 *   - ICE candidate exchange
 *   - Media track management (audio/video mute, camera flip)
 *   - getStats() for real RTT, packet loss, bitrate, frameRate
 *   - ICE restart on disconnection
 *   - Exponential backoff reconnect (max 5 attempts)
 *   - Background video pause / foreground resume
 *   - Guaranteed cleanup on close
 *   - LeakDetector lifecycle tracking
 *
 * react-native-webrtc availability is detected at runtime.
 * Falls back to simulation mode when not available (web/Expo Go).
 */

import { EventBus }         from '../core/EventBus';
import { SignalingManager } from './SignalingManager';
import { AppLifecycle }     from '../core/AppLifecycle';
import { LeakDetector }     from '../core/LeakDetector';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RTCConnectionState =
  | 'new' | 'connecting' | 'connected'
  | 'reconnecting' | 'failed' | 'closed';

export type RTCQualityLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export interface RTCPeerStats {
  rttMs:            number;
  packetLossPct:    number;
  bitrateKbps:      number;
  frameRate:        number;
  jitterMs:         number;
  qualityLevel:     RTCQualityLevel;
  timestamp:        number;
}

export interface RTCPeerConfig {
  roomId:          string;
  localUserId:     string;
  remoteUserId:    string;
  maxReconnects:   number;
  iceTimeoutMs:    number;
  statsIntervalMs: number;
}

// ── ICE server configuration ──────────────────────────────────────────────────

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

// ── Dynamic WebRTC loader (graceful fallback) ─────────────────────────────────

let _RTCPeerConnection: any = null;
let _RTCSessionDescription: any = null;
let _RTCIceCandidate: any = null;
let _mediaDevices: any = null;

function loadWebRTC(): boolean {
  if (_RTCPeerConnection) return true;
  try {
    const webrtc = require('react-native-webrtc');
    _RTCPeerConnection   = webrtc.RTCPeerConnection;
    _RTCSessionDescription = webrtc.RTCSessionDescription;
    _RTCIceCandidate     = webrtc.RTCIceCandidate;
    _mediaDevices        = webrtc.mediaDevices;
    return true;
  } catch {
    return false;
  }
}

// ── RTCPeer ───────────────────────────────────────────────────────────────────

export class RTCPeer {
  readonly config:  RTCPeerConfig;
  private _state:   RTCConnectionState = 'new';
  private _reconnectCount = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _iceTimer:       ReturnType<typeof setTimeout> | null = null;
  private _statsTimer:     ReturnType<typeof setInterval> | null = null;
  private _stateHandlers  = new Set<(s: RTCConnectionState) => void>();
  private _statsHandlers  = new Set<(s: RTCPeerStats) => void>();
  private _errorHandlers  = new Set<(e: string) => void>();
  private _leakToken:     string;
  private _webrtcAvailable: boolean;

  // Real WebRTC objects (null when not available)
  private _pc:             any = null;
  private _localStream:    any = null;
  private _negotiating     = false;

  // Stats accumulator
  private _prevBytes    = 0;
  private _prevTs       = 0;

  constructor(config: RTCPeerConfig) {
    this.config = config;
    this._webrtcAvailable = loadWebRTC();
    this._leakToken = LeakDetector.track('socket', `rtc:${config.roomId}`, 'RTCManager');
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get state(): RTCConnectionState { return this._state; }
  get isConnected(): boolean { return this._state === 'connected'; }

  onStateChange(handler: (s: RTCConnectionState) => void): () => void {
    this._stateHandlers.add(handler);
    return () => this._stateHandlers.delete(handler);
  }

  onStats(handler: (s: RTCPeerStats) => void): () => void {
    this._statsHandlers.add(handler);
    return () => this._statsHandlers.delete(handler);
  }

  onError(handler: (e: string) => void): () => void {
    this._errorHandlers.add(handler);
    return () => this._errorHandlers.delete(handler);
  }

  /** Initiate offer/answer negotiation. */
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

  /** Force ICE restart. */
  async restartICE(): Promise<void> {
    this._setState('reconnecting');
    this._startIceTimeout();

    if (this._pc && this._webrtcAvailable) {
      try {
        // Create new offer with iceRestart flag
        const offer = await this._pc.createOffer({ iceRestart: true });
        await this._pc.setLocalDescription(new _RTCSessionDescription(offer));
        await SignalingManager.sendOffer(
          this.config.roomId,
          this.config.localUserId,
          offer.sdp,
        );
        console.log('[RTCPeer] ICE restart offer sent:', this.config.roomId);
      } catch (e: any) {
        this._notifyError(`ICE restart failed: ${e?.message}`);
      }
    }
  }

  /** Full reconnect with exponential backoff. */
  async reconnect(): Promise<void> {
    if (this._reconnectCount >= this.config.maxReconnects) {
      this._setState('failed');
      this._notifyError('Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(500 * Math.pow(2, this._reconnectCount), 30_000);
    this._reconnectCount++;
    this._setState('reconnecting');

    console.log(`[RTCPeer] reconnect attempt ${this._reconnectCount} in ${delay}ms`);

    this._reconnectTimer = setTimeout(async () => {
      // Close old PC and re-negotiate
      if (this._pc) {
        this._pc.close();
        this._pc = null;
      }
      await this.negotiate('offer');
    }, delay);
  }

  /** Replace a media track (camera flip, resolution change). */
  async replaceTrack(trackKind: 'audio' | 'video', newTrack: any): Promise<void> {
    if (!this._pc) return;

    try {
      const senders = this._pc.getSenders() as any[];
      const sender = senders.find((s: any) => s.track?.kind === trackKind);
      if (sender) {
        await sender.replaceTrack(newTrack);
        console.log('[RTCPeer] track replaced:', trackKind);
        // May need renegotiation for some codec changes
        if (this._pc.signalingState !== 'stable') {
          await this.negotiate('offer');
        }
      }
    } catch (e: any) {
      console.warn('[RTCPeer] replaceTrack error:', e?.message);
    }
  }

  /** Mute/unmute audio or video without renegotiation. */
  setTrackEnabled(trackKind: 'audio' | 'video', enabled: boolean): void {
    if (this._localStream) {
      const tracks = trackKind === 'audio'
        ? this._localStream.getAudioTracks()
        : this._localStream.getVideoTracks();
      for (const track of tracks) {
        track.enabled = enabled;
      }
    }
    // Also mute via sender for remote side
    if (this._pc) {
      try {
        const senders = this._pc.getSenders() as any[];
        for (const sender of senders) {
          if (sender.track?.kind === trackKind) {
            sender.track.enabled = enabled;
          }
        }
      } catch { /* non-fatal */ }
    }
    console.log('[RTCPeer] setTrackEnabled:', trackKind, enabled);
  }

  async close(): Promise<void> {
    this._clearTimers();
    SignalingManager.stopPolling(this.config.roomId);

    // Stop all local media tracks
    if (this._localStream) {
      try {
        for (const track of this._localStream.getTracks()) {
          track.stop();
        }
      } catch { /* ignore */ }
      this._localStream = null;
    }

    // Close peer connection
    if (this._pc) {
      try { this._pc.close(); } catch { /* ignore */ }
      this._pc = null;
    }

    this._setState('closed');
    LeakDetector.release(this._leakToken);
    console.log('[RTCPeer] closed:', this.config.roomId);
  }

  // ── Real WebRTC negotiation ────────────────────────────────────────────────

  private async _negotiateReal(role: 'offer' | 'answer'): Promise<void> {
    // Create peer connection
    this._pc = new _RTCPeerConnection({
      iceServers: RTCManagerImpl._iceServers,
    });
    this._wireConnectionEvents();

    // Acquire local media stream
    try {
      this._localStream = await _mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          width:  { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
      });

      for (const track of this._localStream.getTracks()) {
        this._pc.addTrack(track, this._localStream);
      }
    } catch (e: any) {
      // Fall back to audio-only if video fails
      console.warn('[RTCPeer] video unavailable, falling back to audio:', e?.message);
      try {
        this._localStream = await _mediaDevices.getUserMedia({ audio: true, video: false });
        for (const track of this._localStream.getAudioTracks()) {
          this._pc.addTrack(track, this._localStream);
        }
      } catch (audioErr: any) {
        this._notifyError(`Media access denied: ${audioErr?.message}`);
        this._setState('failed');
        return;
      }
    }

    // Start signaling + polling
    SignalingManager.startPolling(this.config.roomId, this.config.localUserId);

    if (role === 'offer') {
      const offer = await this._pc.createOffer({});
      await this._pc.setLocalDescription(new _RTCSessionDescription(offer));
      await SignalingManager.sendOffer(
        this.config.roomId,
        this.config.localUserId,
        offer.sdp,
      );

      // Wait for remote answer
      SignalingManager.onSignal('answer', async (msg) => {
        if (msg.roomId !== this.config.roomId) return;
        if (!this._pc || this._pc.signalingState !== 'have-local-offer') return;
        try {
          await this._pc.setRemoteDescription(
            new _RTCSessionDescription({ type: 'answer', sdp: msg.payload }),
          );
          console.log('[RTCPeer] remote answer applied');
        } catch (e: any) {
          this._notifyError(`Remote answer failed: ${e?.message}`);
        }
      });
    } else {
      // Wait for remote offer
      SignalingManager.onSignal('offer', async (msg) => {
        if (msg.roomId !== this.config.roomId) return;
        try {
          await this._pc.setRemoteDescription(
            new _RTCSessionDescription({ type: 'offer', sdp: msg.payload }),
          );
          const answer = await this._pc.createAnswer();
          await this._pc.setLocalDescription(new _RTCSessionDescription(answer));
          await SignalingManager.sendAnswer(
            this.config.roomId,
            this.config.localUserId,
            answer.sdp,
          );
        } catch (e: any) {
          this._notifyError(`Answer creation failed: ${e?.message}`);
        }
      });
    }

    // Wire incoming ICE candidates
    SignalingManager.onSignal('ice-candidate', async (msg) => {
      if (msg.roomId !== this.config.roomId) return;
      if (!this._pc || !this._pc.remoteDescription) return;
      try {
        await this._pc.addIceCandidate(
          new _RTCIceCandidate(JSON.parse(msg.payload)),
        );
      } catch (e: any) {
        console.warn('[RTCPeer] addIceCandidate error:', e?.message);
      }
    });

    // Remote end signal
    SignalingManager.onSignal('end', (msg) => {
      if (msg.roomId !== this.config.roomId) return;
      this.close();
    });

    // Start real stats collection
    this._startRealStats();
  }

  private async _negotiateSimulated(role: 'offer' | 'answer'): Promise<void> {
    SignalingManager.startPolling(this.config.roomId, this.config.localUserId);

    SignalingManager.onSignal('end', (msg) => {
      if (msg.roomId !== this.config.roomId) return;
      this.close();
    });

    // Simulate connection after short delay (for non-webrtc environments)
    setTimeout(() => {
      if (this._state === 'connecting') {
        this._setState('connected');
        this._reconnectCount = 0;
        this._clearIceTimer();
        this._startStatsSimulation();
        console.log('[RTCPeer] simulated connection established:', this.config.roomId);
      }
    }, 1500);
  }

  // ── Connection event wiring ───────────────────────────────────────────────

  _wireConnectionEvents(): void {
    if (!this._pc) return;

    this._pc.oniceconnectionstatechange = () => {
      const s = this._pc?.iceConnectionState ?? 'closed';
      console.log('[RTCPeer] ICE state:', s, 'room:', this.config.roomId);

      if (s === 'connected' || s === 'completed') {
        this._clearReconnectTimer();
        this._clearIceTimer();
        this._reconnectCount = 0;
        this._setState('connected');
      } else if (s === 'disconnected') {
        // Wait 3s — may self-recover
        this._reconnectTimer = setTimeout(() => {
          if (this._pc?.iceConnectionState === 'disconnected') {
            this.restartICE();
          }
        }, 3000);
      } else if (s === 'failed') {
        this._clearReconnectTimer();
        this.reconnect();
      } else if (s === 'closed') {
        this._setState('closed');
      }
    };

    this._pc.onicegatheringstatechange = () => {
      if (this._pc?.iceGatheringState === 'complete') {
        this._clearIceTimer();
      }
    };

    this._pc.onicecandidate = async (event: any) => {
      if (event.candidate) {
        try {
          await SignalingManager.sendIceCandidate(
            this.config.roomId,
            this.config.localUserId,
            JSON.stringify(event.candidate.toJSON?.() ?? event.candidate),
          );
        } catch (e: any) {
          console.warn('[RTCPeer] ICE candidate send error:', e?.message);
        }
      }
    };

    this._pc.onnegotiationneeded = async () => {
      if (this._state === 'connected' || this._state === 'connecting') {
        console.log('[RTCPeer] renegotiation needed');
        this._negotiating = false; // Allow re-entry
        await this.negotiate('offer');
      }
    };

    this._pc.ontrack = (event: any) => {
      // Remote track received — emit for UI layer to consume
      EventBus.emit('call:state_changed' as any, {
        roomId: this.config.roomId,
        state:  'track_received',
        track:  event.track,
        stream: event.streams?.[0],
      });
    };

    this._pc.onconnectionstatechange = () => {
      const s = this._pc?.connectionState ?? 'closed';
      console.log('[RTCPeer] connection state:', s);
      if (s === 'failed') {
        this.reconnect();
      }
    };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  private _startRealStats(): void {
    this._statsTimer = setInterval(async () => {
      if (!this._pc || this._state !== 'connected') return;

      try {
        const stats = await this._pc.getStats();
        let rttMs = 0;
        let packetLossPct = 0;
        let bitrateKbps = 0;
        let frameRate = 0;
        let jitterMs = 0;

        stats.forEach((report: any) => {
          if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
            rttMs        = (report.roundTripTime ?? 0) * 1000;
            jitterMs     = (report.jitter ?? 0) * 1000;
            const lost   = report.packetsLost ?? 0;
            const recv   = report.packetsReceived ?? 1;
            packetLossPct = (lost / (lost + recv)) * 100;
          }
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            frameRate   = report.framesPerSecond ?? 0;
            const bytes = report.bytesSent ?? 0;
            const now   = report.timestamp ?? Date.now();
            if (this._prevBytes > 0 && this._prevTs > 0) {
              const dt = (now - this._prevTs) / 1000;
              bitrateKbps = ((bytes - this._prevBytes) * 8) / dt / 1000;
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
      } catch { /* getStats can fail during negotiation */ }
    }, this.config.statsIntervalMs);
  }

  private _startStatsSimulation(): void {
    this._statsTimer = setInterval(() => {
      const rtt  = 20 + Math.random() * 30;
      const loss = Math.random() * 2;
      const bps  = 800 + Math.random() * 200;

      const sample: RTCPeerStats = {
        rttMs:         rtt,
        packetLossPct: loss,
        bitrateKbps:   bps,
        frameRate:     28 + Math.random() * 4,
        jitterMs:      5  + Math.random() * 10,
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
    console.error('[RTCPeer] error:', msg);
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
    if (this._statsTimer) { clearInterval(this._statsTimer); this._statsTimer = null; }
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
  }

  private _clearIceTimer(): void {
    if (this._iceTimer) { clearTimeout(this._iceTimer); this._iceTimer = null; }
  }
}

// ── RTCManager singleton ──────────────────────────────────────────────────────

class RTCManagerImpl {
  static _iceServers: any[] = DEFAULT_ICE_SERVERS;
  private readonly _peers = new Map<string, RTCPeer>();

  configure(iceServers: any[]): void {
    RTCManagerImpl._iceServers = iceServers;
    console.log('[RTCManager] configured:', iceServers.length, 'ICE servers');
  }

  async createPeer(
    roomId:       string,
    localUserId:  string,
    remoteUserId: string,
    options: Partial<RTCPeerConfig> = {},
  ): Promise<RTCPeer> {
    await this._peers.get(roomId)?.close();

    const peer = new RTCPeer({
      roomId,
      localUserId,
      remoteUserId,
      maxReconnects:   5,
      iceTimeoutMs:    15_000,
      statsIntervalMs: 3_000,
      ...options,
    });

    this._peers.set(roomId, peer);

    peer.onStateChange(async (s) => {
      if (s === 'closed' || s === 'failed') {
        this._peers.delete(roomId);
      }
    });

    // Auto-pause video on background, restore on foreground
    AppLifecycle.onBackground(() => {
      if (peer.isConnected) {
        peer.setTrackEnabled('video', false);
      }
    });
    AppLifecycle.onForeground(() => {
      if (peer.state === 'connected') {
        peer.setTrackEnabled('video', true);
      }
    });

    return peer;
  }

  getPeer(roomId: string): RTCPeer | undefined {
    return this._peers.get(roomId);
  }

  async closeAll(): Promise<void> {
    for (const peer of this._peers.values()) {
      await peer.close();
    }
    this._peers.clear();
  }

  get activePeerCount(): number { return this._peers.size; }
}

export const RTCManager = new RTCManagerImpl();
