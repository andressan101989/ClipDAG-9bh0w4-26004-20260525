import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolvePublicSupabaseBuildEnv,
  sanitizedBuildEnvironment,
} from './publicSupabaseBuildEnv.mjs';

export function runNpmBuild({
  npmEntrypoint = process.env.npm_execpath,
  cwd = process.cwd(),
  environment = process.env,
  nodeExecutable = process.execPath,
} = {}) {
  if (!npmEntrypoint) throw new Error('npm_entrypoint_required');
  const result = spawnSync(nodeExecutable, [npmEntrypoint, 'run', 'build'], {
    cwd,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function main() {
  const config = await resolvePublicSupabaseBuildEnv();
  console.log([
    'public_supabase_config_ready',
    `source=${config.source}`,
    `project_ref=${config.projectRef}`,
    `key_sha256=${config.keySha256}`,
  ].join(' '));

  process.exitCode = runNpmBuild({
    environment: sanitizedBuildEnvironment(process.env, config.buildEnvironment),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
