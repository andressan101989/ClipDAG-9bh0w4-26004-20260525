import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const paths = ['components/feature/StoryViewer.native.tsx', 'components/feature/StoryViewer.tsx'];
const parse = path => ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
function descendants(node, predicate) {
  const matches = [];
  const visit = item => { if (predicate(item)) matches.push(item); ts.forEachChild(item, visit); };
  visit(node);
  return matches;
}

test('native and web viewers share the same optional canonical preflight callback type', () => {
  const context = parse('contexts/StoriesContext.tsx');
  const alias = context.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'StoryQuestionAnswerPreflight');
  assert.ok(alias, 'one canonical QA preflight type must be exported by StoriesContext');
  assert.ok(alias.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
  for (const path of paths) {
    const ast = parse(path);
    const props = ast.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'StoryViewerProps');
    const seam = props.members.find(node => node.name?.getText(ast) === 'onPrepareStoryQuestionAnswer');
    assert.ok(seam?.questionToken, `${path}: preflight must remain optional for existing B1 callers`);
    assert.equal(seam.type.getText(ast), 'StoryQuestionAnswerPreflight');
    const canonicalImport = ast.statements.find(node => ts.isImportDeclaration(node)
      && node.moduleSpecifier.text === '@/contexts/StoriesContext');
    assert.ok(canonicalImport.importClause.namedBindings.elements.some(node => node.name.text === 'StoryQuestionAnswerPreflight'));
  }
});

test('all three canonical viewer consumers forward preflight and their authenticated current actor', () => {
  for (const path of ['app/(tabs)/index.tsx', 'app/(tabs)/profile.tsx', 'app/creator/[id].tsx']) {
    const ast = parse(path);
    const binding = descendants(ast, node => ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'useStories')[0];
    assert.ok(binding.name.elements.some(node => node.name.getText(ast) === 'prepareStoryQuestionAnswer'), `${path}: canonical context method must be bound`);
    const viewers = descendants(ast, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'StoryViewer');
    assert.equal(viewers.length, 1);
    const attributes = viewers[0].attributes.properties;
    const preflight = attributes.find(node => node.name?.text === 'onPrepareStoryQuestionAnswer');
    assert.equal(preflight?.initializer?.expression?.getText(ast), 'prepareStoryQuestionAnswer', path);
    const actor = attributes.find(node => node.name?.text === 'currentUserId');
    assert.ok(['user.id', 'user?.id'].includes(actor.initializer.expression.getText(ast)), path);
  }
});

test('optional seam accepts ordinary B1 props and rejects malformed preflight source/results in both viewer contracts', () => {
  const context = parse('contexts/StoriesContext.tsx');
  const alias = context.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'StoryQuestionAnswerPreflight');
  assert.ok(alias, 'canonical preflight signature must exist before checking its consumers');
  const source = parse('services/storyQuestionHandoffRuntime.d.ts').statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'StoryQuestionReplySource');
  const prepared = parse('services/storyQuestionAnswerClient.ts').statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'PreparedStoryQuestionAnswer');
  for (const path of paths) {
    const ast = parse(path);
    const props = ast.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'StoryViewerProps');
    // Use the actual declarations. Unrelated B1 authority types are opaque in this focal compiler program.
    const names = new Set(descendants(props, ts.isTypeReferenceNode).map(node => node.typeName.getText(ast)));
    const opaque = [...names].filter(name => !['Promise', 'StoryQuestionAnswerPreflight'].includes(name)).map(name => `type ${name}=unknown;`).join('\n');
    const text = `${source.getText()}\n${prepared.getText()}\n${alias.getText()}\n${opaque}\n${props.getText()}\n
      const ordinary: StoryViewerProps = { visible: true, storyGroup: null, onClose() {} };
      const supplied: StoryViewerProps = { ...ordinary, onPrepareStoryQuestionAnswer: async source => ({ question: 'Question', respondentId: source.respondentId }) };
      // @ts-expect-error source requires the complete private tuple
      supplied.onPrepareStoryQuestionAnswer?.({ storyId: 'story' });
      // @ts-expect-error strict preflight result cannot coerce question text
      const malformed: StoryViewerProps = { ...ordinary, onPrepareStoryQuestionAnswer: async () => ({ question: 1, respondentId: 'recipient' }) };
    `;
    const fileName = 'qa-viewer-seam-contract.ts';
    const options = { noEmit: true, strict: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022 };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (file, languageVersion, ...rest) => file === fileName ? ts.createSourceFile(file, text, languageVersion, true) : original(file, languageVersion, ...rest);
    const program = ts.createProgram([fileName], options, host);
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [], path);
  }
});
