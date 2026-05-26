/**
 * modules/media/CompressionManager.ts — Adaptive media compression pipeline
 *
 * Selects and applies compression before upload based on:
 *   - File type (image, video, audio)
 *   - Network conditions (WiFi vs cellular)
 *   - Power tier (performance vs saver)
 *   - Content type (avatar, feed video, story, DM attachment)
 *
 * Target quality profiles:
 *   AVATAR_IMAGE:     JPEG 80%, max 512×512   (~80KB target)
 *   FEED_THUMBNAIL:   JPEG 75%, max 720×1280  (~120KB target)
 *   STORY_IMAGE:      JPEG 80%, max 1080×1920 (~200KB target)
 *   DM_IMAGE:         JPEG 70%, max 1024×1024 (~150KB target)
 *   FEED_VIDEO:       H.264, 720p, 2Mbps      (network-adaptive)
 *   STORY_VIDEO:      H.264, 1080p, 4Mbps     (WiFi only)
 *   LIVE_VIDEO:       H.264, 480p, 800Kbps    (streaming-optimized)
 *
 * Falls back gracefully on platforms where compression APIs are unavailable.
 */

export type CompressionProfile =
  | 'avatar_image'
  | 'feed_thumbnail'
  | 'story_image'
  | 'dm_image'
  | 'feed_video'
  | 'story_video'
  | 'live_video'
  | 'voice_message';

export type NetworkCondition = 'wifi' | 'cellular_4g' | 'cellular_3g' | 'offline';
export type PowerMode = 'performance' | 'balanced' | 'saver' | 'emergency';

export interface CompressionConfig {
  imageQuality:  number;    // 0.0–1.0
  maxWidth:      number;
  maxHeight:     number;
  targetKB:      number;
  videoBitrate?: number;   // kbps
  videoFPS?:     number;
  audioKbps?:    number;
}

export interface CompressionResult {
  uri:          string;
  originalSize: number;   // bytes
  compressedSize: number;
  compressionRatio: number;
  durationMs:   number;
  profile:      CompressionProfile;
}

const PROFILES: Record<CompressionProfile, CompressionConfig> = {
  avatar_image:   { imageQuality: 0.80, maxWidth: 512,  maxHeight: 512,  targetKB: 80 },
  feed_thumbnail: { imageQuality: 0.75, maxWidth: 720,  maxHeight: 1280, targetKB: 120 },
  story_image:    { imageQuality: 0.80, maxWidth: 1080, maxHeight: 1920, targetKB: 200 },
  dm_image:       { imageQuality: 0.70, maxWidth: 1024, maxHeight: 1024, targetKB: 150 },
  feed_video:     { imageQuality: 0.8,  maxWidth: 720,  maxHeight: 1280, targetKB: 50_000, videoBitrate: 2000, videoFPS: 30 },
  story_video:    { imageQuality: 0.9,  maxWidth: 1080, maxHeight: 1920, targetKB: 80_000, videoBitrate: 4000, videoFPS: 30 },
  live_video:     { imageQuality: 0.7,  maxWidth: 854,  maxHeight: 480,  targetKB: 10_000, videoBitrate: 800,  videoFPS: 24 },
  voice_message:  { imageQuality: 1.0,  maxWidth: 0,    maxHeight: 0,    targetKB: 500,    audioKbps: 64 },
};

// Downgrade multipliers under poor conditions
const NETWORK_MULTIPLIERS: Record<NetworkCondition, number> = {
  wifi:         1.0,
  cellular_4g:  0.7,
  cellular_3g:  0.4,
  offline:      0.0,
};

const POWER_MULTIPLIERS: Record<PowerMode, number> = {
  performance: 1.0,
  balanced:    0.75,
  saver:       0.5,
  emergency:   0.3,
};

class CompressionManagerImpl {
  private _network: NetworkCondition = 'wifi';
  private _power:   PowerMode        = 'performance';

  setNetworkCondition(c: NetworkCondition): void { this._network = c; }
  setPowerMode(m: PowerMode):              void  { this._power   = m; }

  /**
   * Get the compression config for a given profile, adjusted for current conditions.
   */
  getConfig(profile: CompressionProfile): CompressionConfig {
    const base   = PROFILES[profile];
    const netMul = NETWORK_MULTIPLIERS[this._network];
    const pwrMul = POWER_MULTIPLIERS[this._power];
    const mul    = Math.min(netMul, pwrMul);

    return {
      ...base,
      imageQuality:  Math.max(0.3, base.imageQuality * mul),
      videoBitrate:  base.videoBitrate ? Math.max(200, Math.round(base.videoBitrate * mul)) : undefined,
      targetKB:      Math.round(base.targetKB * mul),
    };
  }

  /**
   * Compress an image URI using expo-image-manipulator (if available).
   * Falls back to returning original URI if library unavailable.
   */
  async compressImage(
    sourceUri:  string,
    profile:    CompressionProfile,
    sourceSize?: number,
  ): Promise<CompressionResult> {
    const config    = this.getConfig(profile);
    const startedAt = Date.now();

    try {
      const ImageManipulator = this._getImageManipulator();
      if (!ImageManipulator) {
        return this._passthroughResult(sourceUri, sourceSize ?? 0, profile, startedAt);
      }

      const actions: any[] = [];
      if (config.maxWidth > 0 && config.maxHeight > 0) {
        actions.push({ resize: { width: config.maxWidth, height: config.maxHeight } });
      }

      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        actions,
        { compress: config.imageQuality, format: ImageManipulator.SaveFormat?.JPEG ?? 'jpeg' },
      );

      const compressedSize = await this._getFileSize(result.uri);

      console.log(
        `[CompressionManager] ${profile}: ${Math.round((sourceSize ?? 0) / 1024)}KB → ${Math.round(compressedSize / 1024)}KB` +
        ` (${config.imageQuality * 100}% quality)`
      );

      return {
        uri:              result.uri,
        originalSize:     sourceSize ?? 0,
        compressedSize,
        compressionRatio: sourceSize ? compressedSize / sourceSize : 1,
        durationMs:       Date.now() - startedAt,
        profile,
      };

    } catch (e: any) {
      console.warn('[CompressionManager] compress failed:', e?.message);
      return this._passthroughResult(sourceUri, sourceSize ?? 0, profile, startedAt);
    }
  }

  /**
   * Check if video compression is available on this platform.
   */
  get videoCompressionAvailable(): boolean {
    try {
      // FFmpegKit is Android-only in current setup
      const ffmpeg = require('ffmpeg-kit-react-native');
      return !!ffmpeg;
    } catch {
      return false;
    }
  }

  private _getImageManipulator(): any {
    try { return require('expo-image-manipulator'); } catch { return null; }
  }

  private async _getFileSize(uri: string): Promise<number> {
    try {
      const fs = require('expo-file-system');
      const info = await fs.getInfoAsync(uri, { size: true });
      return (info as any)?.size ?? 0;
    } catch {
      return 0;
    }
  }

  private _passthroughResult(
    uri: string, size: number, profile: CompressionProfile, startedAt: number
  ): CompressionResult {
    return { uri, originalSize: size, compressedSize: size, compressionRatio: 1, durationMs: Date.now() - startedAt, profile };
  }
}

export const CompressionManager = new CompressionManagerImpl();
