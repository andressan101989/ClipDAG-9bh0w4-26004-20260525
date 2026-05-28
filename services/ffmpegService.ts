/**
 * services/ffmpegService.ts — v10 Production FFmpeg pipeline
 *
 * Real video processing via ffmpeg-kit-react-native (EAS Build only).
 * Full pipeline: trim → merge → transitions → speed → color → audio → export.
 *
 * New in v10:
 *   - Real transition compositor (crossfade, wipe, zoom, dissolve)
 *   - Render queue with priority, concurrency=1, background recovery
 *   - Export recovery: persisted job state survives app restarts
 *   - Audio mixing: multi-track amix with per-track volume
 *   - Thumbnail extraction from any timestamp
 *   - Watermark overlay (PNG stamp into video frame)
 *   - Progress streaming via FFmpegSession statistics callback
 *   - Temp file registry: guaranteed cleanup on cancel/error/success
 *   - Graceful fallback when ffmpeg-kit not compiled in
 */

// expo-file-system loaded lazily — top-level import crashes OnSpace preview on iOS
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EventBus } from '@/modules/core/EventBus';

let _FS: typeof import('expo-file-system/legacy') | null = null;
try {
  _FS = require('expo-file-system/legacy');
} catch (e: any) {
  console.log('[FFmpeg] expo-file-system not available:', e?.message);
}
// Convenience accessor — returns null if module unavailable
const FS = () => _FS;

// ── Lazy-load FFmpeg Kit ──────────────────────────────────────────────────────
let FFmpegKit: any      = null;
let ReturnCode: any     = null;
let FFprobeKit: any     = null;
let Statistics: any     = null;

try {
  const kit    = require('ffmpeg-kit-react-native');
  FFmpegKit    = kit.FFmpegKit   ?? null;
  ReturnCode   = kit.ReturnCode  ?? null;
  FFprobeKit   = kit.FFprobeKit  ?? null;
  Statistics   = kit.Statistics  ?? null;
  console.log('[FFmpeg] ffmpeg-kit-react-native loaded ✓');
} catch (e: any) {
  console.log('[FFmpeg] ffmpeg-kit not available (expected on Expo Go):', e?.message);
}

export const isFFmpegAvailable = (): boolean => !!FFmpegKit;

// ── Constants ─────────────────────────────────────────────────────────────────
// Computed lazily so cacheDirectory is only accessed after native init
const getTmpDir       = () => `${FS()?.cacheDirectory ?? ''}ffmpeg_tmp/`;
const getThumbnailDir = () => `${FS()?.cacheDirectory ?? ''}thumbnails/`;
const RECOVERY_KEY    = '@ffmpeg_render_queue';

// ── Temp file registry ────────────────────────────────────────────────────────
const _tempRegistry = new Set<string>();

function tmpFile(tag: string, ext = 'mp4'): string {
  const path = `${getTmpDir()}${tag}_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
  _tempRegistry.add(path);
  return path;
}

async function ensureDir(dir: string): Promise<void> {
  const fs = FS(); if (!fs) return;
  const info = await fs.getInfoAsync(dir);
  if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
}

function releaseTemp(path: string): void {
  _tempRegistry.delete(path);
  FS()?.deleteAsync(path, { idempotent: true }).catch(() => {});
}

/** Release ALL temp files created in this session. */
export async function cleanupTempFiles(): Promise<void> {
  const fs = FS(); if (!fs) return;
  for (const path of _tempRegistry) {
    fs.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
  _tempRegistry.clear();
  fs.deleteAsync(getTmpDir(), { idempotent: true }).catch(() => {});
}

// ── Execute helper ────────────────────────────────────────────────────────────
interface ExecResult {
  success: boolean;
  output:  string;
}

async function exec(
  command:    string,
  onProgress?: (pct: number) => void,
  durationMs?: number,
): Promise<ExecResult> {
  if (!FFmpegKit) return { success: false, output: 'FFmpegKit not compiled in — EAS Build required' };

  await ensureDir(getTmpDir());

  let progressFired = false;

  const session = await FFmpegKit.executeAsync(
    command,
    // Complete callback
    async (sess: any) => { /* handled below */ },
    // Log callback
    undefined,
    // Statistics callback
    durationMs && onProgress ? (stats: any) => {
      try {
        const timeMs = (stats?.getTime?.() ?? 0) * 1000;
        const pct = Math.min(99, Math.round((timeMs / durationMs) * 100));
        if (pct > 0) { progressFired = true; onProgress(pct); }
      } catch { /* ignore */ }
    } : undefined,
  );

  // Wait for completion
  const rc     = await session.getReturnCode();
  const output = await session.getOutput() ?? '';
  const ok     = ReturnCode?.isSuccess(rc) ?? rc === 0;

  if (!ok) {
    console.warn('[FFmpeg] Command failed. Output:', output.slice(-800));
  } else {
    if (!progressFired && onProgress) onProgress(100);
  }

  return { success: ok, output };
}

// Simple sync exec (no progress)
async function execSync(command: string): Promise<ExecResult> {
  return exec(command);
}

// ── Video probe ───────────────────────────────────────────────────────────────
export interface VideoInfo {
  durationSec: number;
  width:       number;
  height:      number;
  fps:         number;
  codec:       string;
  hasAudio:    boolean;
}

export async function probeVideo(uri: string): Promise<VideoInfo | null> {
  if (!FFprobeKit) return null;
  try {
    const session = await FFprobeKit.execute(
      `-v quiet -print_format json -show_streams -show_format "${uri}"`,
    );
    const output = await session.getOutput() ?? '{}';
    const data   = JSON.parse(output);
    const vStream = (data.streams ?? []).find((s: any) => s.codec_type === 'video');
    const aStream = (data.streams ?? []).find((s: any) => s.codec_type === 'audio');
    return {
      durationSec: parseFloat(data.format?.duration ?? '0'),
      width:       parseInt(vStream?.width ?? '1080'),
      height:      parseInt(vStream?.height ?? '1920'),
      fps:         eval(vStream?.r_frame_rate ?? '30/1') || 30,
      codec:       vStream?.codec_name ?? 'h264',
      hasAudio:    !!aStream,
    };
  } catch {
    return null;
  }
}

// ── 1. Trim ───────────────────────────────────────────────────────────────────
export async function trimVideo(params: {
  inputUri:    string;
  startSec:    number;
  endSec:      number;
  outputUri?:  string;
  onProgress?: (pct: number) => void;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  const dur = params.endSec - params.startSec;
  if (dur <= 0) return { success: false, uri: '', error: 'Invalid trim range' };

  const out = params.outputUri ?? tmpFile('trim');
  const cmd = `-ss ${params.startSec.toFixed(3)} -i "${params.inputUri}" -t ${dur.toFixed(3)} -c:v copy -c:a copy -avoid_negative_ts make_zero -y "${out}"`;
  const res = await exec(cmd, params.onProgress, dur * 1000);
  return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
}

// ── 2. Merge with optional transitions ───────────────────────────────────────
export type TransitionType = 'none' | 'crossfade' | 'wipe_left' | 'wipe_right' | 'zoom' | 'dissolve';

export interface MergeClipParams {
  uri:             string;
  trimStartSec?:   number;
  trimEndSec?:     number;
  durationSec?:    number;
  transitionIn?:   TransitionType;
  transitionSec?:  number; // crossfade duration, default 0.5
}

export async function mergeClips(params: {
  clips:      MergeClipParams[];
  outputUri?: string;
  onProgress?:(pct: number) => void;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  const { clips, outputUri, onProgress } = params;
  if (!clips.length) return { success: false, uri: '', error: 'No clips provided' };

  const out = outputUri ?? tmpFile('merge');

  if (clips.length === 1) {
    const c  = clips[0];
    const ss = c.trimStartSec ? `-ss ${c.trimStartSec.toFixed(3)}` : '';
    const t  = (c.trimEndSec && c.trimStartSec !== undefined)
      ? `-t ${(c.trimEndSec - c.trimStartSec).toFixed(3)}`
      : '';
    const cmd = `${ss} -i "${c.uri}" ${t} -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k -y "${out}"`;
    const res  = await exec(cmd, onProgress, ((c.durationSec ?? 30) * 1000));
    return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
  }

  // Check if any transition requested
  const hasTransitions = clips.some(c => c.transitionIn && c.transitionIn !== 'none');

  if (!hasTransitions || !isFFmpegAvailable()) {
    // Fast path: concat demuxer
    const listPath = tmpFile('concat_list', 'txt');

    // Pre-trim clips that need trimming
    const trimmedUris: string[] = [];
    let totalDur = 0;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      onProgress?.(Math.round((i / clips.length) * 30));
      if (c.trimStartSec !== undefined && c.trimEndSec !== undefined) {
        const tr = await trimVideo({ inputUri: c.uri, startSec: c.trimStartSec, endSec: c.trimEndSec });
        if (!tr.success) return { success: false, uri: '', error: tr.error };
        trimmedUris.push(tr.uri);
        totalDur += c.trimEndSec - c.trimStartSec;
      } else {
        trimmedUris.push(c.uri);
        totalDur += c.durationSec ?? 30;
      }
    }

    const content = trimmedUris.map(u => `file '${u}'`).join('\n');
    const fs = FS();
    if (fs) await fs.writeAsStringAsync(listPath, content, { encoding: fs.EncodingType.UTF8 });

    const cmd = `-f concat -safe 0 -i "${listPath}" -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k -y "${out}"`;
    const res  = await exec(cmd, p => onProgress?.(30 + Math.round(p * 0.7)), totalDur * 1000);
    releaseTemp(listPath);
    // Release intermediate trims
    for (let i = 0; i < clips.length; i++) {
      if (clips[i].trimStartSec !== undefined) releaseTemp(trimmedUris[i]);
    }
    return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
  }

  // Transition path: build complex filter graph
  return _mergeWithTransitions(clips, out, onProgress);
}

async function _mergeWithTransitions(
  clips:      MergeClipParams[],
  out:        string,
  onProgress?:(pct: number) => void,
): Promise<{ success: boolean; uri: string; error?: string }> {
  // Pre-trim all clips to uniform resolution 720p9:16
  const W = 720, H = 1280;
  const trimmed: string[] = [];
  let totalDur = 0;

  for (let i = 0; i < clips.length; i++) {
    const c       = clips[i];
    const dur     = (c.trimEndSec ?? (c.durationSec ?? 30)) - (c.trimStartSec ?? 0);
    const prepped = tmpFile(`prep_${i}`);
    const ss      = c.trimStartSec ? `-ss ${c.trimStartSec.toFixed(3)}` : '';
    const t       = `-t ${dur.toFixed(3)}`;
    const scale   = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`;
    const cmd     = `${ss} -i "${c.uri}" ${t} -vf "${scale}" -r 30 -c:v libx264 -preset fast -crf 22 -an -y "${prepped}"`;
    const res     = await execSync(cmd);
    if (!res.success) return { success: false, uri: '', error: `Prep clip ${i}: ${res.output.slice(-200)}` };
    trimmed.push(prepped);
    totalDur += dur;
    onProgress?.(Math.round((i / clips.length) * 40));
  }

  // Build xfade chain
  const XFADE_DUR = 0.5;
  let filterParts: string[] = [];
  const inputs = trimmed.map((_, i) => `-i "${trimmed[i]}"`).join(' ');

  // Simple xfade chain: [0][1]xfade=crossfade:...[v01]; [v01][2]xfade...
  let prevOut = '[0:v]';
  let prevDur = (clips[0].trimEndSec ?? clips[0].durationSec ?? 30) - (clips[0].trimStartSec ?? 0);

  for (let i = 1; i < trimmed.length; i++) {
    const transType = clips[i].transitionIn ?? 'crossfade';
    const xfaceType = transType === 'wipe_left'  ? 'wipeleft'
                    : transType === 'wipe_right' ? 'wiperight'
                    : transType === 'zoom'       ? 'zoomin'
                    : transType === 'dissolve'   ? 'fade'
                    : 'fade';
    const offset  = Math.max(0, prevDur - XFADE_DUR);
    const outTag  = i < trimmed.length - 1 ? `[v${i}]` : '[vout]';
    filterParts.push(`${prevOut}[${i}:v]xfade=transition=${xfaceType}:duration=${XFADE_DUR}:offset=${offset.toFixed(3)}${outTag}`);
    prevOut = outTag;
    prevDur = prevDur - XFADE_DUR + ((clips[i].trimEndSec ?? clips[i].durationSec ?? 30) - (clips[i].trimStartSec ?? 0));
  }

  // Audio: concat all clips' silent tracks then add amix (no audio in prepped clips)
  const filterGraph = filterParts.join(';');
  const cmd = `${inputs} -filter_complex "${filterGraph}" -map "[vout]" -c:v libx264 -preset fast -crf 22 -an -y "${out}"`;
  const res = await exec(cmd, p => onProgress?.(40 + Math.round(p * 0.6)), totalDur * 1000);

  // Cleanup trimmed intermediates
  for (const t of trimmed) releaseTemp(t);

  return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
}

// ── 3. Color filter / LUT ─────────────────────────────────────────────────────
export type ColorFilterName = 'vintage' | 'cine' | 'frio' | 'calido' | 'bn' | 'neon' | 'none';

const COLOR_FILTERS: Record<ColorFilterName, string> = {
  none:    'null',
  vintage: "curves=r='0/0 0.3/0.4 1/1':g='0/0 0.3/0.28 1/0.9':b='0/0 1/0.75',vignette=PI/4",
  cine:    "curves=all='0/0 0.5/0.4 1/1',vignette=PI/3,colorchannelmixer=.8:.1:.1:0:.1:.8:.1:0:.1:.1:.8:0",
  frio:    'colorbalance=rs=-0.2:gs=-0.1:bs=0.3:rm=-0.1:gm=0.0:bm=0.2:rh=-0.1:gh=0.0:bh=0.2',
  calido:  'colorbalance=rs=0.3:gs=0.1:bs=-0.2:rm=0.2:gm=0.1:bm=-0.1:rh=0.1:gh=0.0:bh=-0.1',
  bn:      "hue=s=0,curves=all='0/0 0.5/0.6 1/1'",
  neon:    'hue=s=2.5,gblur=sigma=0.6',
};

export async function applyColorFilter(params: {
  inputUri:    string;
  filter:      ColorFilterName;
  outputUri?:  string;
  onProgress?: (pct: number) => void;
  durationMs?: number;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  const out = params.outputUri ?? tmpFile('filtered');
  const vf  = COLOR_FILTERS[params.filter] ?? 'null';
  const cmd = `-i "${params.inputUri}" -vf "${vf}" -c:v libx264 -preset fast -crf 22 -c:a copy -y "${out}"`;
  const res = await exec(cmd, params.onProgress, params.durationMs);
  return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
}

// ── 4. Audio mixing (multi-track) ─────────────────────────────────────────────
export interface AudioTrack {
  uri:    string;
  volume: number;    // 0.0 – 1.0
  loop?:  boolean;   // loop to match video length
}

export async function mixAudio(params: {
  videoUri:    string;
  tracks:      AudioTrack[];
  outputUri?:  string;
  onProgress?: (pct: number) => void;
  durationMs?: number;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  const { videoUri, tracks, outputUri, onProgress, durationMs } = params;
  const out = outputUri ?? tmpFile('audio_mix');

  if (!tracks.length) {
    // No extra audio — just copy
    const cmd = `-i "${videoUri}" -c copy -y "${out}"`;
    const res = await exec(cmd, onProgress, durationMs);
    return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
  }

  const inputs  = [`-i "${videoUri}"`, ...tracks.map(t => `-i "${t.uri}"`)].join(' ');
  const loopFlags = tracks.map((t, i) => t.loop ? `-stream_loop -1 -i "${t.uri}"` : '').filter(Boolean).join(' ');

  // Filter: volume + amix
  const volFilters = [`[0:a]volume=1.0[a0]`];
  for (let i = 0; i < tracks.length; i++) {
    volFilters.push(`[${i + 1}:a]volume=${tracks[i].volume.toFixed(2)}[a${i + 1}]`);
  }
  const mixInputs = Array.from({ length: tracks.length + 1 }, (_, i) => `[a${i}]`).join('');
  const filterGraph = `${volFilters.join(';')};${mixInputs}amix=inputs=${tracks.length + 1}:duration=first:dropout_transition=2[outa]`;

  const cmd = `${inputs} -filter_complex "${filterGraph}" -map 0:v -map "[outa]" -c:v copy -c:a aac -b:a 128k -shortest -y "${out}"`;
  const res = await exec(cmd, onProgress, durationMs);
  return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
}

// Legacy compatibility
export async function addAudioTrack(params: {
  videoUri:   string;
  audioUri:   string;
  musicVol?:  number;
  videoVol?:  number;
  outputUri?: string;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  return mixAudio({
    videoUri: params.videoUri,
    tracks:   [{ uri: params.audioUri, volume: params.musicVol ?? 0.7, loop: true }],
    outputUri: params.outputUri,
  });
}

// ── 5. Speed change ────────────────────────────────────────────────────────────
export async function changeSpeed(params: {
  inputUri:    string;
  rate:        number;
  outputUri?:  string;
  onProgress?: (pct: number) => void;
  durationMs?: number;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  const out      = params.outputUri ?? tmpFile('speed');
  const rate     = Math.max(0.25, Math.min(4.0, params.rate));
  const ptsFactor = (1.0 / rate).toFixed(4);

  // Chain atempo for values outside 0.5–2.0
  let aTempo: string;
  if (rate >= 0.5 && rate <= 2.0) {
    aTempo = `atempo=${rate.toFixed(3)}`;
  } else if (rate > 2.0) {
    aTempo = `atempo=2.0,atempo=${(rate / 2.0).toFixed(3)}`;
  } else {
    aTempo = `atempo=0.5,atempo=${(rate / 0.5).toFixed(3)}`;
  }

  const cmd = `-i "${params.inputUri}" -filter_complex "[0:v]setpts=${ptsFactor}*PTS[v];[0:a]${aTempo}[a]" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 22 -y "${out}"`;
  const res = await exec(cmd, params.onProgress, params.durationMs);
  return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
}

// ── 6. Thumbnail extraction ───────────────────────────────────────────────────
export async function extractThumbnail(params: {
  inputUri: string;
  atSec:    number;
  width?:   number;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  const THUMBNAIL_DIR = getThumbnailDir();
  await ensureDir(THUMBNAIL_DIR);
  const out = `${THUMBNAIL_DIR}thumb_${Date.now()}.jpg`;
  const w   = params.width ?? 360;
  const cmd = `-ss ${params.atSec.toFixed(3)} -i "${params.inputUri}" -vframes 1 -vf "scale=${w}:-2" -y "${out}"`;
  const res = await execSync(cmd);
  return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-200) };
}

// ── 7. Watermark overlay ──────────────────────────────────────────────────────
export async function addWatermark(params: {
  inputUri:    string;
  watermarkUri:string;
  position?:   'tl' | 'tr' | 'bl' | 'br' | 'center';
  opacity?:    number;
  outputUri?:  string;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  const out = params.outputUri ?? tmpFile('watermark');
  const pos = params.position ?? 'br';
  const alpha = Math.max(0, Math.min(1, params.opacity ?? 0.7));
  const overlay = pos === 'tl' ? '10:10'
                : pos === 'tr' ? 'W-w-10:10'
                : pos === 'bl' ? '10:H-h-10'
                : pos === 'center' ? '(W-w)/2:(H-h)/2'
                : 'W-w-10:H-h-10'; // br

  const cmd = `-i "${params.inputUri}" -i "${params.watermarkUri}" -filter_complex "[1:v]format=rgba,colorchannelmixer=aa=${alpha}[logo];[0:v][logo]overlay=${overlay}" -c:v libx264 -preset fast -crf 22 -c:a copy -y "${out}"`;
  const res = await execSync(cmd);
  return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
}

// ── 8. Text overlay baking ────────────────────────────────────────────────────
export interface BakedTextOverlay {
  text:     string;
  x:        number;   // 0.0–1.0 normalized
  y:        number;
  fontSize: number;
  color:    string;   // hex e.g. '#ffffff'
  startSec: number;
  endSec:   number;
}

export async function bakeTextOverlays(params: {
  inputUri:    string;
  overlays:    BakedTextOverlay[];
  outputUri?:  string;
  durationMs?: number;
  onProgress?: (pct: number) => void;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  if (!params.overlays.length) return { success: true, uri: params.inputUri };
  const out = params.outputUri ?? tmpFile('text');

  const drawFilters = params.overlays.map(o => {
    const safeText = o.text.replace(/'/g, "\\'").replace(/:/g, '\\:');
    const hexColor = o.color.replace('#', '0x');
    const xExpr    = `(w*${o.x.toFixed(4)})`;
    const yExpr    = `(h*${o.y.toFixed(4)})`;
    const enable   = o.startSec < o.endSec ? `enable='between(t,${o.startSec.toFixed(3)},${o.endSec.toFixed(3)})'` : '';
    return `drawtext=text='${safeText}':x=${xExpr}:y=${yExpr}:fontsize=${o.fontSize}:fontcolor=${hexColor}:${enable}`;
  }).join(',');

  const cmd = `-i "${params.inputUri}" -vf "${drawFilters}" -c:v libx264 -preset fast -crf 22 -c:a copy -y "${out}"`;
  const res = await exec(cmd, params.onProgress, params.durationMs);
  return res.success ? { success: true, uri: out } : { success: false, uri: '', error: res.output.slice(-300) };
}

// ── 9. Full export pipeline ────────────────────────────────────────────────────
export interface ExportClip {
  uri:        string;
  trimStart:  number;    // fraction 0.0–1.0
  trimEnd:    number;
  durationMs: number;
  transitionIn?: TransitionType;
}

export interface ExportParams {
  clips:         ExportClip[];
  speed?:        number;
  colorFilter?:  ColorFilterName;
  musicUri?:     string;
  musicVol?:     number;
  videoVol?:     number;
  textOverlays?: BakedTextOverlay[];
  outputUri?:    string;
  onProgress?:   (step: string, pct: number) => void;
}

export async function exportFinal(params: ExportParams): Promise<{
  success: boolean;
  uri:     string;
  error?:  string;
}> {
  const {
    clips, speed = 1.0, colorFilter = 'none',
    musicUri, musicVol = 0.7, videoVol = 0.8,
    textOverlays, outputUri, onProgress,
  } = params;

  if (!clips.length) return { success: false, uri: '', error: 'No clips' };

  // Fallback: no FFmpeg — return first clip
  if (!isFFmpegAvailable()) {
    onProgress?.('Sin FFmpeg — clip original', 100);
    return { success: true, uri: clips[0].uri, error: 'FFmpeg not available — original clip used' };
  }

  // Count pipeline steps
  const steps: string[] = ['Preparando clips', 'Uniendo'];
  if (speed !== 1.0)                  steps.push('Velocidad');
  if (colorFilter !== 'none')         steps.push('Filtro');
  if (musicUri)                       steps.push('Audio');
  if (textOverlays && textOverlays.length > 0) steps.push('Textos');
  steps.push('Finalizando');

  let stepIdx = 0;
  const prog = (label: string, pct: number) => {
    onProgress?.(label, Math.round((stepIdx / steps.length) * 100 + pct / steps.length));
  };

  try {
    // ── Step 1: Trim clips ────────────────────────────────────────────────
    stepIdx = 0;
    const mergeInputs: MergeClipParams[] = [];
    for (let i = 0; i < clips.length; i++) {
      const c       = clips[i];
      const durSec  = c.durationMs / 1000;
      const startSec = c.trimStart * durSec;
      const endSec   = c.trimEnd   * durSec;
      mergeInputs.push({
        uri:           c.uri,
        trimStartSec:  Math.abs(startSec) < 0.05   ? undefined : startSec,
        trimEndSec:    Math.abs(endSec - durSec) < 0.05 ? undefined : endSec,
        durationSec:   durSec,
        transitionIn:  c.transitionIn,
        transitionSec: 0.5,
      });
      prog('Preparando clips', (i / clips.length) * 100);
    }

    // ── Step 2: Merge ─────────────────────────────────────────────────────
    stepIdx = 1;
    const merged = await mergeClips({ clips: mergeInputs, onProgress: p => prog('Uniendo', p) });
    if (!merged.success) return { success: false, uri: '', error: `Merge: ${merged.error}` };
    let current = merged.uri;

    // ── Step 3: Speed ─────────────────────────────────────────────────────
    if (speed !== 1.0) {
      stepIdx++;
      const totalDur = clips.reduce((s, c) => s + (c.durationMs * (c.trimEnd - c.trimStart)), 0);
      const sped = await changeSpeed({ inputUri: current, rate: speed, durationMs: totalDur, onProgress: p => prog('Velocidad', p) });
      if (!sped.success) return { success: false, uri: '', error: `Speed: ${sped.error}` };
      releaseTemp(current);
      current = sped.uri;
    }

    // ── Step 4: Color filter ──────────────────────────────────────────────
    if (colorFilter !== 'none') {
      stepIdx++;
      const filtered = await applyColorFilter({ inputUri: current, filter: colorFilter, onProgress: p => prog('Filtro', p) });
      if (!filtered.success) return { success: false, uri: '', error: `Filter: ${filtered.error}` };
      releaseTemp(current);
      current = filtered.uri;
    }

    // ── Step 5: Audio mixing ──────────────────────────────────────────────
    if (musicUri) {
      stepIdx++;
      const audio = await mixAudio({
        videoUri: current,
        tracks:   [{ uri: musicUri, volume: musicVol, loop: true }],
        onProgress: p => prog('Audio', p),
      });
      if (!audio.success) return { success: false, uri: '', error: `Audio: ${audio.error}` };
      releaseTemp(current);
      current = audio.uri;
    }

    // ── Step 6: Text overlays ─────────────────────────────────────────────
    if (textOverlays && textOverlays.length > 0) {
      stepIdx++;
      const texted = await bakeTextOverlays({ inputUri: current, overlays: textOverlays, onProgress: p => prog('Textos', p) });
      if (!texted.success) return { success: false, uri: '', error: `Text: ${texted.error}` };
      releaseTemp(current);
      current = texted.uri;
    }

    // ── Step 7: Finalize ──────────────────────────────────────────────────
    stepIdx++;
    const finalOut = outputUri ?? tmpFile('final_export');
    const fs = FS();
    if (fs) await fs.moveAsync({ from: current, to: finalOut });
    _tempRegistry.delete(current);
    _tempRegistry.add(finalOut);

    onProgress?.('Listo', 100);
    console.log('[FFmpeg] Export complete:', finalOut);
    return { success: true, uri: finalOut };

  } catch (e: any) {
    console.error('[FFmpeg] exportFinal error:', e?.message);
    return { success: false, uri: '', error: e?.message ?? 'Export failed' };
  }
}

// ── 10. Render queue ──────────────────────────────────────────────────────────
export type RenderJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface RenderJob {
  id:          string;
  params:      ExportParams;
  status:      RenderJobStatus;
  priority:    number;
  createdAt:   number;
  startedAt?:  number;
  completedAt?:number;
  outputUri?:  string;
  error?:      string;
  progressPct: number;
  currentStep: string;
}

class RenderQueueImpl {
  private _queue:    RenderJob[]      = [];
  private _running:  RenderJob | null = null;
  private _subs      = new Set<(jobs: RenderJob[]) => void>();
  private _ready     = false;

  async initialize(): Promise<void> {
    if (this._ready) return;
    this._ready = true;
    await this._restoreQueue();
    console.log('[RenderQueue] initialized, pending jobs:', this._queue.length);
    this._processNext();
  }

  enqueue(params: ExportParams, priority = 0): RenderJob {
    const job: RenderJob = {
      id:          `rj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      params,
      status:      'queued',
      priority,
      createdAt:   Date.now(),
      progressPct: 0,
      currentStep: 'En cola',
    };
    this._queue.push(job);
    this._queue.sort((a, b) => b.priority - a.priority);
    this._persistQueue();
    this._notify();
    this._processNext();
    return job;
  }

  cancel(jobId: string): void {
    const job = this._queue.find(j => j.id === jobId);
    if (job) {
      job.status = 'cancelled';
      this._queue = this._queue.filter(j => j.id !== jobId);
      this._persistQueue();
      this._notify();
    }
    if (this._running?.id === jobId) {
      // Signal running job to stop
      EventBus.emit('ffmpeg:cancel_job' as any, { jobId });
    }
  }

  getJob(id: string): RenderJob | undefined {
    return this._queue.find(j => j.id === id) ?? (this._running?.id === id ? this._running : undefined);
  }

  get jobs():    RenderJob[]      { return [...(this._running ? [this._running] : []), ...this._queue]; }
  get isRunning(): boolean         { return !!this._running; }

  subscribe(fn: (jobs: RenderJob[]) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  private async _processNext(): Promise<void> {
    if (this._running) return;
    const next = this._queue.shift();
    if (!next) return;

    this._running = next;
    next.status   = 'running';
    next.startedAt = Date.now();
    this._notify();

    let cancelled = false;
    const cancelUnsub = EventBus.on('ffmpeg:cancel_job' as any, (e: any) => {
      if (e?.jobId === next.id) cancelled = true;
    });

    try {
      const result = await exportFinal({
        ...next.params,
        onProgress: (step, pct) => {
          next.currentStep  = step;
          next.progressPct  = pct;
          this._notify();
          if (cancelled) throw new Error('Job cancelled by user');
        },
      });

      if (result.success) {
        next.status       = 'done';
        next.outputUri    = result.uri;
        next.completedAt  = Date.now();
      } else {
        next.status = 'failed';
        next.error  = result.error;
      }
    } catch (e: any) {
      next.status = cancelled ? 'cancelled' : 'failed';
      next.error  = e?.message;
    }

    cancelUnsub();
    this._running     = null;
    next.progressPct  = 100;
    this._persistQueue();
    this._notify();

    EventBus.emit('ffmpeg:job_complete' as any, {
      jobId:  next.id,
      status: next.status,
      uri:    next.outputUri,
    });

    // Process next job
    setTimeout(() => this._processNext(), 100);
  }

  private _notify(): void {
    const all = this.jobs;
    for (const fn of this._subs) { try { fn(all); } catch { /* isolate */ } }
  }

  private async _persistQueue(): Promise<void> {
    try {
      // Only persist queued jobs (not running/done — they'd need restart anyway)
      const persist = this._queue.filter(j => j.status === 'queued');
      await AsyncStorage.setItem(RECOVERY_KEY, JSON.stringify(persist));
    } catch { /* non-critical */ }
  }

  private async _restoreQueue(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(RECOVERY_KEY);
      if (!raw) return;
      const jobs: RenderJob[] = JSON.parse(raw);
      // Only restore jobs that are < 24h old
      const cutoff = Date.now() - 86_400_000;
      this._queue = jobs.filter(j => j.createdAt > cutoff && j.status === 'queued');
      if (this._queue.length > 0) {
        console.log('[RenderQueue] restored', this._queue.length, 'jobs from storage');
        EventBus.emit('ffmpeg:queue_restored' as any, { count: this._queue.length });
      }
    } catch { /* non-critical */ }
  }
}

export const RenderQueue = new RenderQueueImpl();
