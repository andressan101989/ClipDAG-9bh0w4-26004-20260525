/**
 * services/logger.ts — Centralized Logger v1
 *
 * Provides structured, tagged logging with per-module level control.
 * In production (EAS) non-error logs are silenced automatically.
 *
 * Usage:
 *   import { createLogger } from '@/services/logger';
 *   const log = createLogger('DeepAR');
 *   log.info('Camera ready');
 *   log.warn('Filter download slow', { id: 'lion' });
 *   log.error('Crash', err);
 *   log.perf('filter-apply', 240);
 *   log.native('initialized', payload);
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts:      number;
  level:   LogLevel;
  tag:     string;
  msg:     string;
  data?:   unknown;
}

export interface ModuleLogger {
  debug:  (msg: string, data?: unknown) => void;
  info:   (msg: string, data?: unknown) => void;
  warn:   (msg: string, data?: unknown) => void;
  error:  (msg: string, data?: unknown) => void;
  /** Log a native event (DeepAR, camera, etc.) */
  native: (event: string, payload?: unknown) => void;
  /** Log render / computation timing in ms */
  perf:   (label: string, ms: number) => void;
  /** Conditionally log based on a flag */
  assert: (condition: boolean, msg: string, data?: unknown) => void;
}

// ── Config ─────────────────────────────────────────────────────────────────────
const IS_DEV = process.env.NODE_ENV !== 'production' && process.env.EXPO_PUBLIC_ENV !== 'production';

/** Set to false to silence a module globally */
const MODULE_ENABLED: Record<string, boolean> = {
  DeepAR:       true,
  Camera:       true,
  Video:        true,
  VideoEditor:  true,
  Avatar:       true,
  Wallet:       true,
  Feed:         true,
  Auth:         true,
  Music:        true,
  Metro:        true,
  Perf:         true,
};

/** Circular ring buffer — last 500 entries readable via getRecentLogs() */
const LOG_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];

function pushBuffer(entry: LogEntry) {
  if (logBuffer.length >= LOG_BUFFER_SIZE) logBuffer.shift();
  logBuffer.push(entry);
}

/** Retrieve last N log entries (useful for in-app debug panel) */
export function getRecentLogs(n = 100): LogEntry[] {
  return logBuffer.slice(-n);
}

/** Filter entries for a specific tag */
export function getTagLogs(tag: string, n = 50): LogEntry[] {
  return logBuffer.filter(e => e.tag === tag).slice(-n);
}

/** Clear the buffer */
export function clearLogs() { logBuffer.length = 0; }

// ── Core ───────────────────────────────────────────────────────────────────────
function formatTag(tag: string) { return `[${tag}]`; }

function emit(level: LogLevel, tag: string, msg: string, data?: unknown) {
  const entry: LogEntry = { ts: Date.now(), level, tag, msg, data };
  pushBuffer(entry);

  if (!IS_DEV && level !== 'error') return;
  if (MODULE_ENABLED[tag] === false) return;

  const prefix = formatTag(tag);
  const styled = data !== undefined ? [prefix, msg, data] : [prefix, msg];

  switch (level) {
    case 'debug': console.debug(...styled); break;
    case 'info':  console.log  (...styled); break;
    case 'warn':  console.warn (...styled); break;
    case 'error': console.error(...styled); break;
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────
export function createLogger(tag: string): ModuleLogger {
  return {
    debug:  (msg, data)       => emit('debug',  tag, msg, data),
    info:   (msg, data)       => emit('info',   tag, msg, data),
    warn:   (msg, data)       => emit('warn',   tag, msg, data),
    error:  (msg, data)       => emit('error',  tag, msg, data),
    native: (event, payload)  => emit('debug',  tag, `⬦ native:${event}`, payload),
    perf:   (label, ms)       => emit('debug',  'Perf', `${tag}/${label} → ${ms}ms`),
    assert: (ok, msg, data)   => { if (!ok) emit('warn', tag, `ASSERT FAIL: ${msg}`, data); },
  };
}

// ── Singleton loggers for every module ────────────────────────────────────────
export const log = {
  deepar:  createLogger('DeepAR'),
  camera:  createLogger('Camera'),
  video:   createLogger('Video'),
  editor:  createLogger('VideoEditor'),
  avatar:  createLogger('Avatar'),
  wallet:  createLogger('Wallet'),
  feed:    createLogger('Feed'),
  auth:    createLogger('Auth'),
  music:   createLogger('Music'),
  perf:    createLogger('Perf'),
};

// ── NativeModule availability checker ─────────────────────────────────────────
export interface NativeModuleStatus {
  name:      string;
  available: boolean;
  source?:   string;
}

export function checkNativeModules(): NativeModuleStatus[] {
  const results: NativeModuleStatus[] = [];

  const checks: { name: string; check: () => boolean; source?: string }[] = [
    { name: 'expo-camera',      check: () => { try { const m = require('expo-camera'); return !!(m.Camera ?? m.CameraView ?? m.default); } catch { return false; } }, source: 'expo-camera' },
    { name: 'expo-file-system', check: () => { try { const m = require('expo-file-system'); return typeof m.downloadAsync === 'function'; } catch { return false; } }, source: 'expo-file-system' },
    { name: 'expo-video',       check: () => { try { const m = require('expo-video'); return !!(m.VideoView ?? m.default); } catch { return false; } }, source: 'expo-video' },
    { name: 'expo-av',          check: () => { try { const m = require('expo-av'); return !!(m.Audio ?? m.Video); } catch { return false; } }, source: 'expo-av' },
    { name: 'expo-media-library', check: () => { try { require('expo-media-library'); return true; } catch { return false; } }, source: 'expo-media-library' },
    { name: 'react-native-deepar', check: () => { try { const m = require('react-native-deepar'); return !!(m.default ?? m.Camera); } catch { return false; } }, source: 'react-native-deepar' },
    { name: 'ffmpeg-kit-react-native', check: () => { try { require('ffmpeg-kit-react-native'); return true; } catch { return false; } }, source: 'ffmpeg-kit-react-native' },
  ];

  for (const { name, check, source } of checks) {
    let available = false;
    try { available = check(); } catch { available = false; }
    results.push({ name, available, source });
  }

  return results;
}

/** Log a full native-module availability report */
export function logNativeModuleReport() {
  const statuses = checkNativeModules();
  const logger   = createLogger('Metro');
  logger.info('── Native Module Report ──────────────────');
  for (const s of statuses) {
    if (s.available) logger.info(`  ✓ ${s.name}`);
    else             logger.warn(`  ✗ ${s.name} — NOT available (EAS Build required)`);
  }
  logger.info('─────────────────────────────────────────');
  return statuses;
}
