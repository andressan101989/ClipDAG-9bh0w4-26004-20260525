import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { storyQaModuleUrl } from './loadStoryQaModule.mjs';
const require = createRequire(import.meta.url);
const data = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
let fixtureId = 0;

/** Replace only external/platform boundaries. Real screen, React, sessions and public parser execute. */
export async function loadStoryQaComponent(path, fixture, actual = {}) {
  const id = ++fixtureId;
  globalThis.__storyQaComponentFixtures ??= {};
  globalThis.__storyQaComponentFixtures[id] = fixture;
  const source = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
  const replacements = { react: pathToFileURL(require.resolve('react')).href, ...actual };
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node)) continue;
    const specifier = node.moduleSpecifier.text;
    if (replacements[specifier]) continue;
    const exports = [];
    const prefix = `const f=globalThis.__storyQaComponentFixtures[${id}];`;
    const expression = name => `f[${JSON.stringify(name)}] ?? ${/^[A-Z]/.test(name) ? JSON.stringify(name) : `(()=>{throw new Error('Unprovided boundary: ${name}')})`}`;
    if (node.importClause?.name) exports.push(`export default ${expression(node.importClause.name.text)};`);
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        const name = (binding.propertyName ?? binding.name).text;
        exports.push(`export const ${name}=${expression(name)};`);
      }
    } else if (bindings) {
      for (const [name] of Object.entries(fixture.namespaces?.[specifier] ?? {})) {
        exports.push(`export const ${name}=f.namespaces[${JSON.stringify(specifier)}][${JSON.stringify(name)}];`);
      }
    }
    replacements[specifier] = data(`${prefix}${exports.join('\n')}`);
  }
  return import(storyQaModuleUrl(path, replacements));
}
