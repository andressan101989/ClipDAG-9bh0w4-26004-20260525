/**
 * hooks/video/useVideoEditor.ts
 *
 * Encapsulates ALL video editor state and business logic.
 * VideosTab becomes a pure UI consumer — no state management inside.
 *
 * Contract:
 *  - No JSX
 *  - No direct imports from other studio tabs
 *  - expo-video and ffmpeg are lazy-required inside effects
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { isFFmpegAvailable, exportFinal } from '@/services/ffmpegService';
import { log } from '@/services/logger';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface VideoClip {
  id:         string;
  uri:        string;
  durationMs: number;
}

export interface DeezerTrack {
  id:       number;
  title:    string;
  preview:  string;
  duration: number;
  artist:   { name: string };
  album:    { cover_medium: string; title: string };
}

export type ColorFilter = 'vintage' | 'cine' | 'frio' | 'calido' | 'bn' | 'neon' | 'none';

export interface VideoEditorState {
  // Clips
  clips:         VideoClip[];
  activeIdx:     number;
  activeClip:    VideoClip | undefined;
  // Playback
  isPlaying:     boolean;
  durationMs:    number;
  positionMs:    number;
  // Edit params
  speed:         number;
  trimStart:     number;
  trimEnd:       number;
  colorFilter:   ColorFilter;
  // Audio
  videoVol:      number;
  musicVol:      number;
  selectedTrack: DeezerTrack | null;
  // UI state
  isExporting:   boolean;
  isPublishing:  boolean;
  exportProgress: string | null;
  // Player ref (expo-video or expo-av)
  playerRef:     React.MutableRefObject<any>;
  soundRef:      React.MutableRefObject<Audio.Sound | null>;
}

export interface VideoEditorActions {
  pickClip:         () => Promise<void>;
  removeClip:       (id: string) => void;
  setActiveIdx:     (i: number) => void;
  togglePlay:       () => void;
  seekTo:           (fraction: number) => void;
  setSpeed:         (v: number) => void;
  setTrimStart:     (v: number) => void;
  setTrimEnd:       (v: number) => void;
  setColorFilter:   (f: ColorFilter) => void;
  setVideoVol:      (v: number) => void;
  setMusicVol:      (v: number) => void;
  setSelectedTrack: (t: DeezerTrack | null) => void;
  setDurationMs:    (ms: number) => void;
  setPositionMs:    (ms: number) => void;
  setIsPlaying:     (p: boolean) => void;
  exportAndPublish: (caption: string) => Promise<{ uri: string; ok: boolean; error?: string }>;
  reset:            () => void;
}

export type UseVideoEditorReturn = VideoEditorState & VideoEditorActions;

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useVideoEditor(maxClips = 5): UseVideoEditorReturn {
  const playerRef = useRef<any>(null);
  const soundRef  = useRef<Audio.Sound | null>(null);

  const [clips,         setClips]         = useState<VideoClip[]>([]);
  const [activeIdx,     setActiveIdxSt]   = useState(0);
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [durationMs,    setDurationMs]    = useState(0);
  const [positionMs,    setPositionMs]    = useState(0);
  const [speed,         setSpeedSt]       = useState(1.0);
  const [trimStart,     setTrimStart]     = useState(0.0);
  const [trimEnd,       setTrimEnd]       = useState(1.0);
  const [colorFilter,   setColorFilterSt] = useState<ColorFilter>('none');
  const [videoVol,      setVideoVol]      = useState(0.8);
  const [musicVol,      setMusicVol]      = useState(0.6);
  const [selectedTrack, setSelectedTrack] = useState<DeezerTrack | null>(null);
  const [isExporting,   setIsExporting]   = useState(false);
  const [isPublishing,  setIsPublishing]  = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);

  // Cleanup audio on unmount
  useEffect(() => () => {
    soundRef.current?.stopAsync().catch(() => {});
    soundRef.current?.unloadAsync().catch(() => {});
  }, []);

  const pickClip = useCallback(async () => {
    if (clips.length >= maxClips) {
      log.editor.warn('Max clips reached', { max: maxClips });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      log.editor.warn('Gallery permission denied');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
    });
    if (!res.canceled && res.assets[0]) {
      const clip: VideoClip = {
        id:         `c_${Date.now()}`,
        uri:        res.assets[0].uri,
        durationMs: (res.assets[0].duration ?? 30) * 1000,
      };
      setClips(prev => {
        const next = [...prev, clip];
        setActiveIdxSt(next.length - 1);
        return next;
      });
      setTrimStart(0);
      setTrimEnd(1);
      log.editor.info('Clip added', { id: clip.id, durationMs: clip.durationMs });
    }
  }, [clips.length, maxClips]);

  const removeClip = useCallback((id: string) => {
    setClips(prev => {
      const next = prev.filter(c => c.id !== id);
      setActiveIdxSt(i => Math.min(i, Math.max(0, next.length - 1)));
      return next;
    });
  }, []);

  const setActiveIdx = useCallback((i: number) => {
    setActiveIdxSt(i);
    setTrimStart(0);
    setTrimEnd(1);
    setDurationMs(0);
    setPositionMs(0);
  }, []);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (isPlaying) {
        if (typeof p.pause === 'function') p.pause();
        setIsPlaying(false);
      } else {
        if (typeof p.play === 'function') p.play();
        setIsPlaying(true);
      }
    } catch (e) {
      log.editor.warn('togglePlay failed', e);
    }
  }, [isPlaying]);

  const seekTo = useCallback((fraction: number) => {
    if (!playerRef.current || durationMs <= 0) return;
    const targetSec = (fraction * durationMs) / 1000;
    try {
      if (typeof playerRef.current.currentTime !== 'undefined') {
        playerRef.current.currentTime = targetSec;
      } else {
        playerRef.current._avRef?.setPositionAsync?.(targetSec * 1000);
      }
    } catch (e) {
      log.editor.warn('seekTo failed', e);
    }
  }, [durationMs]);

  const setSpeed = useCallback((val: number) => {
    setSpeedSt(val);
    try { if (playerRef.current) playerRef.current.playbackRate = val; } catch { /* ignore */ }
  }, []);

  const setColorFilter = useCallback((f: ColorFilter) => {
    setColorFilterSt(f);
    log.editor.info('Color filter changed', { filter: f });
  }, []);

  const exportAndPublish = useCallback(async (caption: string): Promise<{ uri: string; ok: boolean; error?: string }> => {
    const active = clips[activeIdx];
    if (!active) return { uri: '', ok: false, error: 'No active clip' };

    const t0 = Date.now();
    setIsPublishing(true);
    setIsExporting(true);
    setExportProgress('Preparando...');

    try {
      const result = await exportFinal({
        clips: clips.map(c => ({
          uri:        c.uri,
          trimStart:  c.id === active.id ? trimStart : 0,
          trimEnd:    c.id === active.id ? trimEnd   : 1,
          durationMs: c.durationMs,
        })),
        speed,
        colorFilter,
        musicUri:  selectedTrack?.preview,
        musicVol,
        videoVol,
        onProgress: (step, pct) => setExportProgress(`${step} (${pct}%)`),
      });

      log.editor.perf('export', Date.now() - t0);
      const uri = result.uri || active.uri;
      return { uri, ok: true };

    } catch (e: any) {
      log.editor.error('Export failed', e);
      return { uri: '', ok: false, error: e?.message ?? 'Export failed' };
    } finally {
      setIsPublishing(false);
      setIsExporting(false);
      setExportProgress(null);
    }
  }, [clips, activeIdx, trimStart, trimEnd, speed, colorFilter, selectedTrack, musicVol, videoVol]);

  const reset = useCallback(() => {
    soundRef.current?.stopAsync().catch(() => {});
    soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current  = null;
    playerRef.current = null;
    setClips([]);
    setActiveIdxSt(0);
    setIsPlaying(false);
    setDurationMs(0);
    setPositionMs(0);
    setSpeedSt(1);
    setTrimStart(0);
    setTrimEnd(1);
    setColorFilterSt('none');
    setSelectedTrack(null);
  }, []);

  return {
    // State
    clips,
    activeIdx,
    activeClip:    clips[activeIdx],
    isPlaying,
    durationMs,
    positionMs,
    speed,
    trimStart,
    trimEnd,
    colorFilter,
    videoVol,
    musicVol,
    selectedTrack,
    isExporting,
    isPublishing,
    exportProgress,
    playerRef,
    soundRef,
    // Actions
    pickClip,
    removeClip,
    setActiveIdx,
    togglePlay,
    seekTo,
    setSpeed,
    setTrimStart,
    setTrimEnd,
    setColorFilter,
    setVideoVol,
    setMusicVol,
    setSelectedTrack,
    setDurationMs,
    setPositionMs,
    setIsPlaying,
    exportAndPublish,
    reset,
  };
}
