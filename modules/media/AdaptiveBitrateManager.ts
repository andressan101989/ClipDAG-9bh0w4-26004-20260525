/**
 * modules/media/AdaptiveBitrateManager.ts — Adaptive bitrate selection for streaming
 *
 * Monitors network conditions and adjusts video quality levels for:
 *   - Live streaming (outbound encoding bitrate)
 *   - Video call quality (WebRTC bitrate caps)
 *   - Feed video playback (HLS/DASH quality selection)
 *   - Story video loading (preload priority)
 *
 * Quality Levels:
 *   AUTO:  algorithm decides (default)
 *   1080p: 4–6 Mbps  (WiFi, performance tier)
 *   720p:  2–3 Mbps  (WiFi or strong 4G)
 *   480p:  800Kbps   (4G, balanced tier)
 *   360p:  400Kbps   (weak 4G, saver tier)
 *   240p:  200Kbps   (3G / emergency tier)
 *
 * Adapts based on:
 *   - Network RTT probes (latency)
 *   - Packet loss estimation (buffer underruns)
 *   - Bandwidth estimation (download throughput)
 *   - Device power tier (thermal / battery)
 */

import { EventBus }   from '../core/EventBus';
import { AppLifecycle } from '../core/AppLifecycle';

export type VideoQualityLevel = 'auto' | '1080p' | '720p' | '480p' | '360p' | '240p';

export interface QualityConfig {
  label:       VideoQualityLevel;
  bitrateKbps: number;   // target encoding bitrate
  minKbps:     number;   // minimum required bandwidth
  width:       number;
  height:      number;
  fps:         number;
}

export interface NetworkProbe {
  rttMs:          number;
  downloadKbps:   number;
  packetLossPct:  number;
  timestamp:      number;
}

const QUALITY_LEVELS: QualityConfig[] = [
  { label: '1080p', bitrateKbps: 5000, minKbps: 6000, width: 1920, height: 1080, fps: 30 },
  { label: '720p',  bitrateKbps: 2500, minKbps: 3000, width: 1280, height: 720,  fps: 30 },
  { label: '480p',  bitrateKbps: 800,  minKbps: 1000, width: 854,  height: 480,  fps: 24 },
  { label: '360p',  bitrateKbps: 400,  minKbps: 500,  width: 640,  height: 360,  fps: 20 },
  { label: '240p',  bitrateKbps: 200,  minKbps: 250,  width: 426,  height: 240,  fps: 15 },
];

const PROBE_HISTORY_MAX     = 20;
const UPGRADE_STABILITY_SEC = 10;   // seconds of good network before upgrading
const DOWNGRADE_THRESHOLD   = 3;    // consecutive bad probes before downgrading

class AdaptiveBitrateManagerImpl {
  private _currentLevel:    VideoQualityLevel = 'auto';
  private _forcedLevel:     VideoQualityLevel | null = null;
  private _probeHistory:    NetworkProbe[] = [];
  private _goodProbeStreak  = 0;
  private _badProbeStreak   = 0;
  private _lastUpgradeAt    = 0;
  private _powerTier:       string = 'performance';
  private readonly _handlers = new Set<(level: VideoQualityLevel, config: QualityConfig) => void>();

  // ── Network probes ────────────────────────────────────────────────────────

  /** Feed a network measurement to the ABR algorithm. */
  recordProbe(probe: NetworkProbe): void {
    this._probeHistory.push(probe);
    if (this._probeHistory.length > PROBE_HISTORY_MAX) {
      this._probeHistory.shift();
    }
    this._evaluate();
  }

  // ── Quality override ──────────────────────────────────────────────────────

  /** Force a specific quality level (user preference). Pass null to resume auto. */
  setForcedLevel(level: VideoQualityLevel | null): void {
    this._forcedLevel = level;
    if (level && level !== 'auto') {
      this._applyLevel(level);
    } else {
      this._evaluate();
    }
  }

  /** Called by PowerManager when power tier changes. */
  onPowerTierChange(tier: string): void {
    this._powerTier = tier;
    this._evaluate();
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get currentLevel():  VideoQualityLevel { return this._forcedLevel ?? this._currentLevel; }
  get currentConfig(): QualityConfig | null {
    return QUALITY_LEVELS.find(q => q.label === this.currentLevel) ?? null;
  }
  get estimatedBandwidthKbps(): number {
    if (this._probeHistory.length === 0) return 0;
    const recent = this._probeHistory.slice(-5);
    return recent.reduce((s, p) => s + p.downloadKbps, 0) / recent.length;
  }

  onQualityChange(fn: (level: VideoQualityLevel, config: QualityConfig) => void): () => void {
    this._handlers.add(fn);
    return () => this._handlers.delete(fn);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _evaluate(): void {
    if (this._forcedLevel && this._forcedLevel !== 'auto') return;

    const bw = this.estimatedBandwidthKbps;
    if (bw === 0) return;

    const latestProbe = this._probeHistory[this._probeHistory.length - 1];
    const isBad = latestProbe ? (latestProbe.rttMs > 200 || latestProbe.packetLossPct > 5) : false;

    if (isBad) {
      this._badProbeStreak++;
      this._goodProbeStreak = 0;
    } else {
      this._goodProbeStreak++;
      this._badProbeStreak = 0;
    }

    // Get max quality cap from power tier
    const maxLevel = this._getMaxLevelForPowerTier();

    // Find best quality that fits bandwidth
    let target: VideoQualityLevel = '240p';
    for (const q of QUALITY_LEVELS) {
      if (bw >= q.minKbps) { target = q.label; break; }
    }

    // Apply power tier cap
    const targetIdx = QUALITY_LEVELS.findIndex(q => q.label === target);
    const maxIdx    = QUALITY_LEVELS.findIndex(q => q.label === maxLevel);
    if (maxIdx !== -1 && targetIdx < maxIdx) {
      target = QUALITY_LEVELS[maxIdx].label;
    }

    // Hysteresis: don't upgrade too quickly, downgrade quickly
    const now = Date.now();
    if (target < this._currentLevel) {
      // Downgrade immediately after N bad probes
      if (this._badProbeStreak >= DOWNGRADE_THRESHOLD) {
        this._applyLevel(target);
      }
    } else if (target > this._currentLevel) {
      // Upgrade only after stability period
      if (
        this._goodProbeStreak >= UPGRADE_STABILITY_SEC &&
        (now - this._lastUpgradeAt) > UPGRADE_STABILITY_SEC * 1000
      ) {
        this._applyLevel(target);
        this._lastUpgradeAt = now;
        this._goodProbeStreak = 0;
      }
    }
  }

  private _applyLevel(level: VideoQualityLevel): void {
    if (this._currentLevel === level) return;
    const prev    = this._currentLevel;
    this._currentLevel = level;
    const config  = QUALITY_LEVELS.find(q => q.label === level);
    console.log(`[AdaptiveBitrate] ${prev} → ${level} (${config?.bitrateKbps}kbps)`);

    if (config) {
      for (const fn of this._handlers) {
        try { fn(level, config); } catch { /* isolate */ }
      }
    }
  }

  private _getMaxLevelForPowerTier(): VideoQualityLevel {
    switch (this._powerTier) {
      case 'emergency': return '240p';
      case 'saver':     return '360p';
      case 'balanced':  return '480p';
      default:          return '1080p';
    }
  }
}

export const AdaptiveBitrateManager = new AdaptiveBitrateManagerImpl();
