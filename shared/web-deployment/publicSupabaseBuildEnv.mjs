import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export const EXPECTED_PUBLIC_SUPABASE_PROJECT_REF = 'aewwdlvbwpczqyvkwvvj';
export const CANONICAL_PUBLIC_KEY_SHA256 = new Set([
  '39af884ed9844858e2745c4bcb2afb5d9e43d454834473430a16de1bd7dd9bc0',
  '8949b5c27068dbd02e176bb3633ebece904fc45b5e5735e71044a998c3c759f4',
]);

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const allowedViteVariables = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
]);

function parseDotEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function candidate(values, family) {
  if (family === 'vite') {
    const url = values.VITE_SUPABASE_URL;
    const key = values.VITE_SUPABASE_PUBLISHABLE_KEY ?? values.VITE_SUPABASE_ANON_KEY;
    const present = Boolean(url || key);
    return { present, url, key };
  }
  const url = values.EXPO_PUBLIC_SUPABASE_URL;
  const key = values.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return { present: Boolean(url || key), url, key };
}

function decodeLegacyPublicKey(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function validateUrl(value) {
  if (!value) throw new Error('public_supabase_url_required');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('public_supabase_url_invalid');
  }
  const expectedHost = `${EXPECTED_PUBLIC_SUPABASE_PROJECT_REF}.supabase.co`;
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('public_supabase_project_mismatch');
  }
  return `https://${expectedHost}`;
}

function validateKey(value, allowedKeySha256) {
  if (!value) throw new Error('public_supabase_key_required');
  if (value.startsWith('sb_secret_')) throw new Error('public_supabase_server_key_forbidden');
  if (value.startsWith('sb_publishable_')) {
    if (!/^sb_publishable_[A-Za-z0-9_-]{20,128}$/.test(value)) throw new Error('public_supabase_key_invalid');
  } else {
    const payload = decodeLegacyPublicKey(value);
    if (!payload || payload.role !== 'anon') throw new Error('public_supabase_key_invalid');
    if (payload.ref !== EXPECTED_PUBLIC_SUPABASE_PROJECT_REF) {
      throw new Error('public_supabase_key_project_mismatch');
    }
  }
  const keySha256 = createHash('sha256').update(value).digest('hex');
  if (!allowedKeySha256.has(keySha256)) {
    throw new Error('public_supabase_key_project_mismatch');
  }
  return keySha256;
}

function rejectUnexpectedViteVariables(environment) {
  for (const name of Object.keys(environment)) {
    if (name.startsWith('VITE_') && !allowedViteVariables.has(name)) {
      throw new Error(`public_web_unapproved_vite_variable:${name}`);
    }
  }
}

async function readEnvironmentFile(path) {
  try {
    return parseDotEnv(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function selectCandidate(values, source) {
  for (const family of ['vite', 'expo_public']) {
    const item = candidate(values, family);
    if (!item.present) continue;
    if (!item.url) throw new Error('public_supabase_url_required');
    if (!item.key) throw new Error('public_supabase_key_required');
    return { ...item, source: `${source}:${family}` };
  }
  return null;
}

export async function resolvePublicSupabaseBuildEnv({
  environment = process.env,
  loadFallbackFile = true,
  allowedKeySha256 = CANONICAL_PUBLIC_KEY_SHA256,
} = {}) {
  rejectUnexpectedViteVariables(environment);
  let selected = selectCandidate(environment, 'environment');

  if (!selected && loadFallbackFile) {
    const explicitPath = environment.NELYON_PUBLIC_ENV_FILE;
    if (explicitPath) {
      const fileValues = await readEnvironmentFile(resolve(explicitPath));
      if (!fileValues) throw new Error('public_supabase_env_file_unavailable');
      selected = selectCandidate(fileValues, 'file:explicit');
    } else {
      const fileValues = await readEnvironmentFile(join(repositoryRoot, '.env'));
      if (fileValues) selected = selectCandidate(fileValues, 'file:repository_root');
    }
  }

  if (!selected) throw new Error('public_supabase_url_required');
  const url = validateUrl(selected.url);
  const keySha256 = validateKey(selected.key, allowedKeySha256);

  return {
    source: selected.source.replace(/:(vite|expo_public)$/, selected.source.startsWith('environment') ? ':$1' : ''),
    projectRef: EXPECTED_PUBLIC_SUPABASE_PROJECT_REF,
    keySha256,
    buildEnvironment: {
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_PUBLISHABLE_KEY: selected.key,
      VITE_SUPABASE_ANON_KEY: selected.key,
    },
  };
}

export function sanitizedBuildEnvironment(environment, publicEnvironment) {
  const result = { ...environment };
  for (const name of Object.keys(result)) {
    if (name.startsWith('VITE_')) delete result[name];
  }
  return { ...result, ...publicEnvironment };
}
