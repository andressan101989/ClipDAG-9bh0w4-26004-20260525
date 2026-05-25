/**
 * services/ffmpegService.ts
 *
 * Real video processing via ffmpeg-kit-react-native.
 * Requires EAS Build with @config-plugins/ffmpeg-kit-react-native in app.json.
 *
 * Capabilities:
 *  - trim (cut start/end of a clip)
 *  - merge (concatenate multiple clips)
 *  - applyColorFilter (LUT-style color grading overlay)
 *  - addAudioTrack (mix background music into video)
 *  - changeSpeed (slow/fast motion via PTS manipulation)
 *  - exportFinal (full pipeline: merge → filter → audio → export)
 *
 * Falls back gracefully when ffmpeg-kit-react-native is not compiled in
 * (e.g., running in Expo Go without EAS Build).
 */

import * as FileSystem from 'expo-file-system';

// ── Lazy-load FFmpeg Kit ─────────────────────────────────────────────────────
let FFmpegKit: any    = null;
let ReturnCode: any   = null;
let FFmpegSession: any = null;

try {
  const kit   = require('ffmpeg-kit-react-native');
  FFmpegKit   = kit.FFmpegKit   ?? null;
  ReturnCode  = kit.ReturnCode  ?? null;
  FFmpegSession = kit.FFmpegSession ?? null;
} catch {
  // Not compiled in — fallback mode
}

export const isFFmpegAvailable = () => !!FFmpegKit;

// ── Temp dir helper ──────────────────────────────────────────────────────────
const tmpDir = () => `${FileSystem.cacheDirectory}ffmpeg_tmp/`;

async function ensureTmpDir() {
  const info = await FileSystem.getInfoAsync(tmpDir());
  if (!info.exists) await FileSystem.makeDirectoryAsync(tmpDir(), { intermediates: true });
}

function tmpFile(name: string) {
  return `${tmpDir()}${name}_${Date.now()}.mp4`;
}

// ── Execute & await ──────────────────────────────────────────────────────────
async function exec(command: string): Promise<{ success: boolean; output: string }> {
  if (!FFmpegKit) return { success: false, output: 'FFmpegKit not available — EAS Build required' };
  const session = await FFmpegKit.execute(command);
  const rc      = await session.getReturnCode();
  const output  = await session.getOutput();
  const success = ReturnCode?.isSuccess(rc) ?? false;
  if (!success) console.warn('[FFmpeg] Command failed:', command, '\nOutput:', output);
  return { success, output: output ?? '' };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. TRIM — cut a video between startSec and endSec
// ═══════════════════════════════════════════════════════════════════════════
export async function trimVideo(params: {
  inputUri:  string;
  startSec:  number;
  endSec:    number;
  outputUri?: string;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  await ensureTmpDir();
  const out = params.outputUri ?? tmpFile('trim');
  const dur = params.endSec - params.startSec;
  if (dur <= 0) return { success: false, uri: '', error: 'Invalid trim range' };

  const cmd = `-i "${params.inputUri}" -ss ${params.startSec} -t ${dur} -c:v copy -c:a copy -avoid_negative_ts make_zero "${out}"`;
  const { success, output } = await exec(cmd);
  return success
    ? { success: true, uri: out }
    : { success: false, uri: '', error: output };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. MERGE — concatenate an ordered list of clip URIs into one video
// ═══════════════════════════════════════════════════════════════════════════
export async function mergeClips(params: {
  clips:     string[];
  outputUri?: string;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  await ensureTmpDir();
  const out = params.outputUri ?? tmpFile('merge');

  if (params.clips.length === 1) {
    // Single clip — just copy
    const cmd = `-i "${params.clips[0]}" -c copy "${out}"`;
    const { success, output } = await exec(cmd);
    return success ? { success: true, uri: out } : { success: false, uri: '', error: output };
  }

  // Write concat list file
  const listPath = `${tmpDir()}concat_${Date.now()}.txt`;
  const content  = params.clips.map(c => `file '${c}'`).join('\n');
  await FileSystem.writeAsStringAsync(listPath, content, { encoding: FileSystem.EncodingType.UTF8 });

  const cmd = `-f concat -safe 0 -i "${listPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "${out}"`;
  const { success, output } = await exec(cmd);

  // Cleanup list file
  FileSystem.deleteAsync(listPath, { idempotent: true }).catch(() => {});

  return success
    ? { success: true, uri: out }
    : { success: false, uri: '', error: output };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. COLOR FILTER — apply a color grading effect to video
//    filterName: 'vintage' | 'cine' | 'frio' | 'calido' | 'bn' | 'neon' | 'none'
// ═══════════════════════════════════════════════════════════════════════════
type ColorFilterName = 'vintage' | 'cine' | 'frio' | 'calido' | 'bn' | 'neon' | 'none';

const COLOR_FILTERS: Record<ColorFilterName, string> = {
  none:    'null',
  vintage: 'curves=r=\'0/0 0.3/0.4 1/1\':g=\'0/0 0.3/0.28 1/0.9\':b=\'0/0 1/0.75\',vignette=PI/4',
  cine:    'curves=all=\'0/0 0.5/0.4 1/1\',vignette=PI/3,colorchannelmixer=.8:.1:.1:0:.1:.8:.1:0:.1:.1:.8:0',
  frio:    'colorbalance=rs=-0.2:gs=-0.1:bs=0.3:rm=-0.1:gm=0.0:bm=0.2:rh=-0.1:gh=0.0:bh=0.2',
  calido:  'colorbalance=rs=0.3:gs=0.1:bs=-0.2:rm=0.2:gm=0.1:bm=-0.1:rh=0.1:gh=0.0:bh=-0.1',
  bn:      'hue=s=0,curves=all=\'0/0 0.5/0.6 1/1\'',
  neon:    'hue=s=2.5,curves=r=\'0/0.1 0.5/0.7 1/1\':g=\'0/0 0.5/0.3 1/0.6\':b=\'0/0.2 0.5/0.8 1/1\',gblur=sigma=0.8',
};

export async function applyColorFilter(params: {
  inputUri:   string;
  filter:     ColorFilterName;
  outputUri?: string;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  await ensureTmpDir();
  const out    = params.outputUri ?? tmpFile('filtered');
  const vf     = COLOR_FILTERS[params.filter] ?? 'null';
  const cmd    = `-i "${params.inputUri}" -vf "${vf}" -c:v libx264 -preset fast -crf 22 -c:a copy "${out}"`;
  const result = await exec(cmd);
  return result.success
    ? { success: true, uri: out }
    : { success: false, uri: '', error: result.output };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. ADD AUDIO TRACK — mix music into video
//    musicVol: 0.0–1.0 volume for music track
//    videoVol: 0.0–1.0 volume for original audio
// ═══════════════════════════════════════════════════════════════════════════
export async function addAudioTrack(params: {
  videoUri:   string;
  audioUri:   string;
  musicVol?:  number;
  videoVol?:  number;
  outputUri?: string;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  await ensureTmpDir();
  const out      = params.outputUri ?? tmpFile('audio');
  const mvol     = params.musicVol ?? 0.7;
  const vvol     = params.videoVol ?? 0.8;
  // Mix: original audio at vvol + music loop trimmed to video length at mvol
  const cmd = [
    `-i "${params.videoUri}"`,
    `-i "${params.audioUri}"`,
    `-filter_complex`,
    `"[0:a]volume=${vvol}[va];[1:a]volume=${mvol}[ma];[va][ma]amix=inputs=2:duration=first:dropout_transition=2[outa]"`,
    `-map 0:v`,
    `-map "[outa]"`,
    `-c:v copy`,
    `-c:a aac`,
    `-b:a 128k`,
    `-shortest`,
    `"${out}"`,
  ].join(' ');
  const result = await exec(cmd);
  return result.success
    ? { success: true, uri: out }
    : { success: false, uri: '', error: result.output };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. CHANGE SPEED — slow motion or fast motion
//    rate: 0.25 (very slow) to 4.0 (very fast)
// ═══════════════════════════════════════════════════════════════════════════
export async function changeSpeed(params: {
  inputUri:   string;
  rate:       number;
  outputUri?: string;
}): Promise<{ success: boolean; uri: string; error?: string }> {
  await ensureTmpDir();
  const out      = params.outputUri ?? tmpFile('speed');
  const rate     = Math.max(0.25, Math.min(4.0, params.rate));
  const ptsFactor = 1.0 / rate; // inverse for setpts
  const audioTempo = rate;      // atempo range 0.5–2.0
  // Chain atempo if needed (ffmpeg atempo limited to 0.5–2.0 per filter)
  let aTempo = '';
  if (audioTempo >= 0.5 && audioTempo <= 2.0) {
    aTempo = `atempo=${audioTempo}`;
  } else if (audioTempo > 2.0) {
    aTempo = `atempo=2.0,atempo=${Math.min(audioTempo / 2.0, 2.0)}`;
  } else {
    aTempo = `atempo=0.5,atempo=${Math.max(audioTempo / 0.5, 0.5)}`;
  }

  const cmd = `-i "${params.inputUri}" -filter_complex "[0:v]setpts=${ptsFactor}*PTS[v];[0:a]${aTempo}[a]" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 22 "${out}"`;
  const result = await exec(cmd);
  return result.success
    ? { success: true, uri: out }
    : { success: false, uri: '', error: result.output };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. EXPORT FINAL — full pipeline
//    trim → merge → speed → colorFilter → audio → output
// ═══════════════════════════════════════════════════════════════════════════
export interface ExportParams {
  clips:         Array<{ uri: string; trimStart: number; trimEnd: number; durationMs: number }>;
  speed?:        number;
  colorFilter?:  ColorFilterName;
  musicUri?:     string;
  musicVol?:     number;
  videoVol?:     number;
  outputUri?:    string;
  onProgress?:   (step: string, pct: number) => void;
}

export async function exportFinal(params: ExportParams): Promise<{
  success: boolean; uri: string; error?: string
}> {
  const {
    clips, speed = 1.0, colorFilter = 'none',
    musicUri, musicVol = 0.7, videoVol = 0.8,
    outputUri, onProgress,
  } = params;

  if (!isFFmpegAvailable()) {
    // Graceful fallback — return first clip URI so app still works
    return { success: true, uri: clips[0]?.uri ?? '', error: 'FFmpeg not available — original clip used' };
  }

  const total = clips.length + (speed !== 1 ? 1 : 0) + (colorFilter !== 'none' ? 1 : 0) + (musicUri ? 1 : 0) + 1;
  let step = 0;
  const progress = (label: string) => {
    step++;
    onProgress?.(label, Math.round((step / total) * 100));
  };

  try {
    // Step 1 — Trim each clip
    const trimmed: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const dur  = clip.durationMs / 1000;
      const st   = clip.trimStart * dur;
      const en   = clip.trimEnd   * dur;
      if (Math.abs(st) < 0.1 && Math.abs(en - dur) < 0.1) {
        // No actual trim needed
        trimmed.push(clip.uri);
      } else {
        progress(`Recortando clip ${i + 1}`);
        const res = await trimVideo({ inputUri: clip.uri, startSec: st, endSec: en });
        if (!res.success) return { success: false, uri: '', error: `Trim clip ${i + 1}: ${res.error}` };
        trimmed.push(res.uri);
      }
    }

    // Step 2 — Merge clips
    progress('Uniendo clips');
    const merged = await mergeClips({ clips: trimmed });
    if (!merged.success) return { success: false, uri: '', error: `Merge: ${merged.error}` };

    let current = merged.uri;

    // Step 3 — Speed change (optional)
    if (speed !== 1.0) {
      progress(`Ajustando velocidad ${speed}×`);
      const sped = await changeSpeed({ inputUri: current, rate: speed });
      if (!sped.success) return { success: false, uri: '', error: `Speed: ${sped.error}` };
      current = sped.uri;
    }

    // Step 4 — Color filter (optional)
    if (colorFilter !== 'none') {
      progress(`Aplicando filtro ${colorFilter}`);
      const filtered = await applyColorFilter({ inputUri: current, filter: colorFilter });
      if (!filtered.success) return { success: false, uri: '', error: `Filter: ${filtered.error}` };
      current = filtered.uri;
    }

    // Step 5 — Add music (optional)
    if (musicUri) {
      progress('Mezclando música');
      const audio = await addAudioTrack({ videoUri: current, audioUri: musicUri, musicVol, videoVol });
      if (!audio.success) return { success: false, uri: '', error: `Audio: ${audio.error}` };
      current = audio.uri;
    }

    // Step 6 — Move to final output
    const finalOut = outputUri ?? tmpFile('export_final');
    await FileSystem.moveAsync({ from: current, to: finalOut });
    progress('Listo');

    // Cleanup temp files (except final output)
    trimmed.forEach(u => {
      if (u !== finalOut && !params.clips.map(c => c.uri).includes(u)) {
        FileSystem.deleteAsync(u, { idempotent: true }).catch(() => {});
      }
    });

    return { success: true, uri: finalOut };
  } catch (e: any) {
    return { success: false, uri: '', error: e?.message ?? String(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. CLEANUP — remove all temp files
// ═══════════════════════════════════════════════════════════════════════════
export async function cleanupTempFiles() {
  try {
    await FileSystem.deleteAsync(tmpDir(), { idempotent: true });
  } catch (_) {}
}
