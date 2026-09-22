import { access, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '..', '..');

export const requiredFiles = Object.freeze([
  'index.html',
  'business.html',
  'business/index.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'site.webmanifest',
]);

function assertSafeOutput(output, allowedRoot) {
  const resolvedOutput = resolve(output);
  const resolvedRoot = resolve(allowedRoot);
  const rel = relative(resolvedRoot, resolvedOutput);
  if (!rel || rel.startsWith('..') || rel.includes(':')) {
    throw new Error(`Unsafe assembly output: ${resolvedOutput}`);
  }
}

export async function assemble({
  publicDist = resolve(repoRoot, 'apps', 'public-web', 'dist'),
  businessDist = resolve(repoRoot, 'apps', 'business-web', 'dist'),
  output = resolve(appRoot, 'dist'),
  allowedRoot = appRoot,
} = {}) {
  const resolvedOutput = resolve(output);
  assertSafeOutput(resolvedOutput, allowedRoot);
  await access(resolve(publicDist, 'index.html'));
  await access(resolve(businessDist, 'index.html'));

  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });
  await cp(resolve(publicDist), resolvedOutput, { recursive: true });
  await cp(resolve(businessDist), resolve(resolvedOutput, 'business'), { recursive: true });

  for (const file of requiredFiles) await access(resolve(resolvedOutput, file));
  return { output: resolvedOutput, requiredFiles: [...requiredFiles] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await assemble();
  console.log(`Assembled Nelyon web artifact: ${result.output}`);
}
