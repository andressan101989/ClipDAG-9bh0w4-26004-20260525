import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the production TypeScript, resolving real local runtime imports from data URLs.
export function storyQaModuleUrl(path, replacements = {}) {
  const url = new URL(`../../${path}`, import.meta.url);
  if (!existsSync(url)) return null;
  let output = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  output = output.replace(/from ['"]([^'"]+)['"]/g, (match, specifier) => {
    if (replacements[specifier]) return `from '${replacements[specifier]}'`;
    if (specifier.endsWith('.mjs')) return `from '${new URL(specifier, url).href}'`;
    return match;
  });
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
}
export async function loadStoryQaModule(path, replacements = {}) {
  const url = storyQaModuleUrl(path, replacements);
  return url ? import(url) : {};
}
