import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function assertInside(root, candidate) {
  const relativePath = relative(root, candidate);
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) return;
  throw new Error(`business_deployment_write_outside_dist:${candidate}`);
}

function deploymentReferences(html) {
  return [
    ...[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]),
    ...[...html.matchAll(/<link\b(?=[^>]*\brel=["'][^"']*stylesheet[^"']*["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]),
  ];
}

export async function prepareBusinessDeployment({
  distDir = new URL('../dist/', import.meta.url),
  iconSource = new URL('../../../assets/branding/nelyon/v1/nelyon-app-icon.png', import.meta.url),
} = {}) {
  const resolvedDist = resolve(distDir instanceof URL ? fileURLToPath(distDir) : distDir);
  const resolvedIcon = resolve(iconSource instanceof URL ? fileURLToPath(iconSource) : iconSource);
  const indexPath = resolve(resolvedDist, 'index.html');
  const faviconPath = resolve(resolvedDist, 'favicon.png');
  assertInside(resolvedDist, indexPath);
  assertInside(resolvedDist, faviconPath);

  let html;
  try {
    html = await readFile(indexPath, 'utf8');
  } catch (error) {
    throw new Error(`business_deployment_missing_index.html:${error.code ?? 'unknown'}`);
  }

  for (const reference of deploymentReferences(html)) {
    if (!reference.startsWith('/business/')) {
      throw new Error(`business_deployment_reference_must_start_with_/business/:${reference}`);
    }
  }

  const rewritten = html.replaceAll('href="/favicon.png"', 'href="/business/favicon.png"')
    .replaceAll("href='/favicon.png'", "href='/business/favicon.png'");
  await writeFile(indexPath, rewritten);
  await copyFile(resolvedIcon, faviconPath);

  return { distDir: resolvedDist, indexPath, faviconPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareBusinessDeployment();
}
