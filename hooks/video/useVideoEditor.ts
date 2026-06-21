/**
 * hooks/video/useVideoEditor.ts — v2 Production editor hook
 *
 * Unified editor hook connecting:
 *   - EditorController (undo/redo snapshot engine)
 *   - TimelineController (stabilized playhead + clip management)
 *   - RenderCompositor (real FFmpeg bake pipeline)
 *   - ExportManager (upload + publish)
 *   - RenderQueue (background export queue)
 *   - ffmpegService.extractThumbnail (timeline thumbnails)
 *
 * Improvements over v1:
 *   - Undo/redo wired to EditorController snapshot stack
 *   - Timeline state sync: trim ops update both EditorController + TimelineController
 *   - Export via RenderQueue (background, recoverable on restart)
 *   - Thumbnail strip: extract 5 keyframe thumbnails on clip load
 *   - Preview optimization: TimelineController playhead → expo-video seekTo
 *   - Multi-clip support: TimelineController manages multiple video tracks
 *   - Error recovery: retry export on failure (up to 2 attempts)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Audio }             from 'expo-av';
import * as ImagePicker      from 'expo-image-picker';
import { isFFmpegAvailable, exportFinal, extractThumbnail, RenderQueue } from '@/services/ffmpegService';
import { EditorController, type EditorState } from '@/modules/creator/editor/EditorController';
import { TimelineController, type TimelineState } from '@/modules/creator/timeline/TimelineController';
import { RenderCompositor }  from '@/modules/creator/rendering/RenderCompositor';
import { ExportManager }     from '@/modules/creator/exports/ExportManager';
import { CrashIntelligence } from '@/modules/core/CrashIntelligence';
import { EventBus }          from '@/modules/core/EventBus';
import { log }               from '@/services/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VideoClip {
  id:              string;
  uri:             string;
  durationMs:      number;
  thumbnails:      string[];   // keyframe thumbnail URIs
  trimStart:       number;     // fraction 0.0–1.0
  trimEnd:         number;     // fraction 0.0–1.0
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

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVideoEditor(maxClips = 5) {
  // Legacy player refs
  const playerRef = useRef<any>(null);
  const soundRef  = useRef<Audio.Sound | null>(null);

  // ── Clips state ───────────────────────────────────────────────────────────
  const [clips,         setClips]       = useState<VideoClip[]>([]);
  const [activeIdx,     setActiveIdxSt] = useState(0);

  // ── Playback ──────────────────────────────────────────────────────────────
  const [isPlaying,     setIsPlaying]   = useState(false);
  const [durationMs,    setDurationMs]  = useState(0);
  const [positionMs,    setPositionMs]  = useState(0);

  // ── Edit params ───────────────────────────────────────────────────────────
  const [speed,         setSpeedSt]     = useState(1.0);
  const [trimStart,     setTrimStartSt] = useState(0.0);
  const [trimEnd,       setTrimEndSt]   = useState(1.0);
  const [colorFilter,   setColorFilterSt] = useState<ColorFilter>('none');

  // ── Audio ─────────────────────────────────────────────────────────────────
  const [videoVol,      setVideoVol]    = useState(0.8);
  const [musicVol,      setMusicVol]    = useState(0.6);
  const [selectedTrack, setSelectedTrack] = useState<DeezerTrack | null>(null);

  // ── Editor state (from EditorController) ─────────────────────────────────
  const [editorState,  setEditorState]  = useState<EditorState | null>(null);
  const [canUndo,      setCanUndo]      = useState(false);
  const [canRedo,      setCanRedo]      = useState(false);
  const [historyLabels,setHistoryLabels]= useState<string[]>([]);

  // ── Timeline state ────────────────────────────────────────────────────────
  const [timelineState, setTimelineState] = useState<TimelineState | null>(null);

  // ── Export state ──────────────────────────────────────────────────────────
  const [isExporting,    setIsExporting]    = useState(false);
  const [isPublishing,   setIsPublishing]   = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [exportError,    setExportError]    = useState<string | null>(null);
  const [renderJobId,    setRenderJobId]    = useState<string | null>(null);

  const exportAttempts = useRef(0);

  // ── Subscriptions setup ───────────────────────────────────────────────────
  useEffect(() => {
    const unsubEditor = EditorController.subscribe(state => {
      setEditorState(state);
      setCanUndo(EditorController.canUndo);
      setCanRedo(EditorController.canRedo);
      setHistoryLabels(EditorController.historyLabels);
    });

    const unsubTimeline = TimelineController.subscribe(state => {
      setTimelineState(state);
      // Do NOT call setDurationMs here: TimelineController.trimMainVideo() shrinks its
      // internal durationMs to the trimmed end, which would corrupt trim calculations.
      // durationMs stays = original clip duration (set in pickClip / setActiveIdx).
      setIsPlaying(state.isPlaying);
    });

    // RenderQueue job completion
    const unsubQueue = EventBus.on('ffmpeg:job_complete' as any, (e: any) => {
      if (e?.jobId === renderJobId) {
        setIsExporting(false);
        setIsPublishing(false);
        setExportProgress(null);
        if (e.status === 'done') {
          setExportError(null);
          log.editor.info('Background render complete', { uri: e.uri });
        } else {
          setExportError(e.error ?? 'Render failed');
        }
      }
    });

    return () => {
      unsubEditor();
      unsubTimeline();
      unsubQueue();
    };
  }, [renderJobId]);

  // Cleanup audio on unmount
  useEffect(() => () => {
    soundRef.current?.stopAsync().catch(() => {});
    soundRef.current?.unloadAsync().catch(() => {});
    TimelineController.pause();
    if (EditorController.isOpen) EditorController.close();
  }, []);

  // ── Pick clip ─────────────────────────────────────────────────────────────
  const pickClip = useCallback(async () => {
    if (clips.length >= maxClips) {
      log.editor.warn('Max clips reached', { max: maxClips });
      return;
    }
    try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      log.editor.warn('Gallery permission denied');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality:    1,
    });
    if (res.canceled || !res.assets[0]) return;

    const asset       = res.assets[0];
    // expo-image-picker returns duration in seconds (older SDK) or ms (newer SDK).
    // Values above 3600 cannot be seconds (that would be > 1 h), so treat as ms already.
    const rawDuration = asset.duration ?? 30;
    const durMs       = rawDuration > 3600 ? Math.round(rawDuration) : Math.round(rawDuration * 1000);
    const clipId      = `c_${Date.now()}`;
    const clipUri  = asset.uri;

    // Extract thumbnails in background
    const thumbnails: string[] = [];
    if (isFFmpegAvailable()) {
      const points = [0.1, 0.3, 0.5, 0.7, 0.9];
      const durSec = durMs / 1000;
      await Promise.allSettled(
        points.map(async (p, i) => {
          const result = await extractThumbnail({ inputUri: clipUri, atSec: p * durSec, width: 120 });
          if (result.success) thumbnails[i] = result.uri;
        }),
      );
    }

    const clip: VideoClip = { id: clipId, uri: clipUri, durationMs: durMs, thumbnails, trimStart: 0, trimEnd: 1 };

    setClips(prev => {
      const next = [...prev, clip];
      const idx  = next.length - 1;
      setActiveIdxSt(idx);
      // Open EditorController for this clip
      EditorController.open(clipUri, durMs);
      // Initialize TimelineController
      TimelineController.initialize(durMs, clipUri);
      return next;
    });

    setTrimStartSt(0);
    setTrimEndSt(1);
    setDurationMs(durMs);
    setPositionMs(0);
    exportAttempts.current = 0;
    log.editor.info('Clip added', { id: clipId, durationMs: durMs });
    } catch (e: any) {
      // PHPhotosErrorDomain 3164: limited/denied Photos access, or asset unavailable.
      console.warn('[VideoEditor] pickClip failed:', e?.message);
    }
  }, [clips.length, maxClips]);

  // ── Remove clip ───────────────────────────────────────────────────────────
  const removeClip = useCallback((id: string) => {
    setClips(prev => {
      const next = prev.filter(c => c.id !== id);
      const newIdx = Math.min(activeIdx, Math.max(0, next.length - 1));
      setActiveIdxSt(newIdx);
      if (next.length === 0) {
        TimelineController.reset();
        if (EditorController.isOpen) EditorController.close();
      }
      return next;
    });
  }, [activeIdx]);

  // ── Set active index ──────────────────────────────────────────────────────
  const setActiveIdx = useCallback((i: number) => {
    setActiveIdxSt(i);
    const clip = clips[i];
    if (clip) {
      EditorController.open(clip.uri, clip.durationMs);
      TimelineController.initialize(clip.durationMs, clip.uri);
      // Restore this clip's trim state instead of always resetting to 0/1.
      setTrimStartSt(clip.trimStart);
      setTrimEndSt(clip.trimEnd);
    }
    setDurationMs(clip?.durationMs ?? 0);
    setPositionMs(0);
  }, [clips]);

  // ── Playback ──────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    TimelineController.togglePlay();
    // isPlaying now reflects the NEW state after the toggle.
    try {
      const p = playerRef.current;
      if (!p) return;
      if (TimelineController.isPlaying) {
        typeof p.play === 'function' ? p.play() : null;
      } else {
        typeof p.pause === 'function' ? p.pause() : null;
      }
    } catch { /* ignore */ }
  }, []);

  const seekTo = useCallback((fraction: number) => {
    if (durationMs <= 0) return;
    const ms = fraction * durationMs;
    const wasPlaying = TimelineController.isPlaying;

    // Pause player before seek to avoid position being overwritten mid-seek.
    if (wasPlaying) TimelineController.pause();

    TimelineController.seek(ms);
    setPositionMs(ms);

    try {
      const p = playerRef.current;
      if (p) {
        if (wasPlaying && typeof p.pause === 'function') p.pause();
        const sec = ms / 1000;
        if (typeof p.currentTime !== 'undefined') {
          p.currentTime = sec;
        } else if (typeof p._avRef?.setPositionAsync === 'function') {
          p._avRef.setPositionAsync(ms);
        }
        // Resume only if we were playing before.
        if (wasPlaying && typeof p.play === 'function') p.play();
      }
    } catch { /* ignore */ }

    if (wasPlaying) TimelineController.play();
  }, [durationMs]);

  // ── Edit operations (wired to EditorController) ───────────────────────────
  const setSpeed = useCallback((val: number) => {
    setSpeedSt(val);
    EditorController.setSpeed(val);
    try { if (playerRef.current) playerRef.current.playbackRate = val; } catch { /* ignore */ }
  }, []);

  const setTrimStart = useCallback((v: number) => {
    const origMs = clips[activeIdx]?.durationMs ?? 0;
    if (origMs <= 0) return;
    setTrimStartSt(v);
    EditorController.trim(v * origMs, trimEnd * origMs);
    TimelineController.trimMainVideo(v * origMs, trimEnd * origMs);
    setClips(prev => prev.map((c, i) => i === activeIdx ? { ...c, trimStart: v } : c));
  }, [trimEnd, activeIdx, clips]);

  const setTrimEnd = useCallback((v: number) => {
    const origMs = clips[activeIdx]?.durationMs ?? 0;
    if (origMs <= 0) return;
    setTrimEndSt(v);
    EditorController.trim(trimStart * origMs, v * origMs);
    TimelineController.trimMainVideo(trimStart * origMs, v * origMs);
    setClips(prev => prev.map((c, i) => i === activeIdx ? { ...c, trimEnd: v } : c));
  }, [trimStart, activeIdx, clips]);

  const setColorFilter = useCallback((f: ColorFilter) => {
    setColorFilterSt(f);
    EditorController.setLUT(f === 'none' ? null : f);
    log.editor.info('Color filter changed', { filter: f });
  }, []);

  const setAudioVolumes = useCallback((music: number, voice: number) => {
    setMusicVol(music);
    setVideoVol(voice);
    EditorController.setAudioVolume(music, voice);
  }, []);

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    const ok = EditorController.undo();
    if (ok) {
      const state = EditorController.state;
      if (state) {
        setSpeedSt(state.speed);
        setColorFilterSt((state.lutId ?? 'none') as ColorFilter);
        setMusicVol(state.musicVolume);
        setVideoVol(state.voiceVolume);
        const dur = state.durationMs;
        if (dur > 0) {
          setTrimStartSt(state.trimStartMs / dur);
          setTrimEndSt(state.trimEndMs / dur);
        }
        TimelineController.trimMainVideo(state.trimStartMs, state.trimEndMs);
      }
    }
    return ok;
  }, []);

  const redo = useCallback(() => {
    const ok = EditorController.redo();
    if (ok) {
      const state = EditorController.state;
      if (state) {
        setSpeedSt(state.speed);
        setColorFilterSt((state.lutId ?? 'none') as ColorFilter);
        setMusicVol(state.musicVolume);
        setVideoVol(state.voiceVolume);
        const dur = state.durationMs;
        if (dur > 0) {
          setTrimStartSt(state.trimStartMs / dur);
          setTrimEndSt(state.trimEndMs / dur);
        }
        TimelineController.trimMainVideo(state.trimStartMs, state.trimEndMs);
      }
    }
    return ok;
  }, []);

  // ── Export and publish ────────────────────────────────────────────────────
  const exportAndPublish = useCallback(async (
    caption: string,
    useBackground = false,
  ): Promise<{ uri: string; ok: boolean; error?: string }> => {
    const active = clips[activeIdx];
    if (!active) return { uri: '', ok: false, error: 'No active clip' };
    if (exportAttempts.current >= 2) return { uri: '', ok: false, error: 'Export failed after retries' };

    setIsPublishing(true);
    setIsExporting(true);
    setExportError(null);
    setExportProgress('Preparando...');
    exportAttempts.current++;

    const exportParams = {
      clips: clips.map(c => ({
        uri:        c.uri,
        trimStart:  c.trimStart,
        trimEnd:    c.trimEnd,
        durationMs: c.durationMs,
      })),
      speed,
      colorFilter,
      musicUri:    selectedTrack?.preview,
      musicVol,
      videoVol,
      onProgress:  (step: string, pct: number) => setExportProgress(`${step} (${pct}%)`),
    };

    try {
      // ── FFmpeg availability guard ─────────────────────────────────────────
      const hasRealTrim = clips.some(c => c.trimStart > 0.01 || c.trimEnd < 0.99);
      const needsFFmpeg = clips.length > 1 || hasRealTrim;

      if (!isFFmpegAvailable()) {
        if (needsFFmpeg) {
          const err = clips.length > 1
            ? 'Para unir varios clips se requiere EAS Build con FFmpeg instalado.'
            : 'Para recortar el video se requiere EAS Build con FFmpeg instalado.';
          setExportError(err);
          return { uri: '', ok: false, error: err };
        }
        // Single clip, no trim — publish the original URI directly.
        log.editor.warn('FFmpeg unavailable — publishing original clip without processing');
        return { uri: active.uri, ok: true };
      }

      if (useBackground) {
        // Enqueue to background render queue
        const job = RenderQueue.enqueue(exportParams, 0);
        setRenderJobId(job.id);
        setExportProgress('En cola...');
        log.editor.info('Export queued', { jobId: job.id });
        return { uri: '', ok: true };
      }

      // Foreground export
      const result = await exportFinal(exportParams);
      exportAttempts.current = 0;

      if (result.success) {
        log.editor.perf('export', Date.now());
        return { uri: result.uri, ok: true };
      } else {
        setExportError(result.error ?? 'Export failed');
        return { uri: '', ok: false, error: result.error };
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Export failed';
      log.editor.error('Export error', e);
      setExportError(msg);
      return { uri: '', ok: false, error: msg };
    } finally {
      setIsPublishing(false);
      setIsExporting(false);
      setExportProgress(null);
    }
  }, [clips, activeIdx, trimStart, trimEnd, speed, colorFilter, selectedTrack, musicVol, videoVol]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    TimelineController.pause();
    TimelineController.reset();
    if (EditorController.isOpen) EditorController.close();
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
    setTrimStartSt(0);
    setTrimEndSt(1);
    setColorFilterSt('none');
    setSelectedTrack(null);
    setEditorState(null);
    setTimelineState(null);
    setExportError(null);
    exportAttempts.current = 0;
  }, []);

  return {
    // Clips
    clips,
    activeIdx,
    activeClip:      clips[activeIdx],
    // Playback
    isPlaying,
    durationMs,
    positionMs,
    // Edit params
    speed,
    trimStart,
    trimEnd,
    colorFilter,
    // Audio
    videoVol,
    musicVol,
    selectedTrack,
    // Editor state
    editorState,
    canUndo,
    canRedo,
    historyLabels,
    // Timeline state
    timelineState,
    // Export state
    isExporting,
    isPublishing,
    exportProgress,
    exportError,
    renderJobId,
    // Refs
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
    setVideoVol:      (v: number) => setAudioVolumes(musicVol, v),
    setMusicVol:      (v: number) => setAudioVolumes(v, videoVol),
    setAudioVolumes,
    setSelectedTrack,
    setDurationMs,
    setPositionMs,
    setIsPlaying,
    undo,
    redo,
    exportAndPublish,
    reset,
    // Controller access
    editorController:   EditorController,
    timelineController: TimelineController,
    renderCompositor:   RenderCompositor,
    isFFmpegAvailable:  isFFmpegAvailable(),
  };
}
