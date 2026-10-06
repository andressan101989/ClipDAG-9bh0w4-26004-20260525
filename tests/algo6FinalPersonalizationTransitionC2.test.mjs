import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const gate = readFileSync(
  new URL('../components/feature/PersonalizationGate.tsx', import.meta.url),
  'utf8',
);
const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const onboarding = readFileSync(
  new URL('../app/onboarding/personalization.tsx', import.meta.url),
  'utf8',
);

const gateAst = ts.createSourceFile(
  'PersonalizationGate.tsx',
  gate,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findFunction(name) {
  let result;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node;
    ts.forEachChild(node, visit);
  };
  visit(gateAst);
  return result;
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function componentReturns(component) {
  const returns = [];
  const visit = node => {
    if (node !== component && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, visit);
  };
  visit(component.body);
  return returns;
}

test('status checking keeps children mounted and renders a touch-blocking overlay', () => {
  const component = findFunction('PersonalizationGate');
  assert.ok(component?.body, 'PersonalizationGate function must exist');

  const topLevelReturns = componentReturns(component);
  assert.equal(topLevelReturns.length, 1, 'the gate must have one unconditional component return');

  const renderedTree = topLevelReturns[0].expression?.getText(gateAst) ?? '';
  assert.match(renderedTree, /\{children\}/, 'children must always remain in the rendered tree');
  assert.match(renderedTree, /blockingOverlay\s*\?/, 'the loader must be conditional overlay content');
  assert.match(renderedTree, /pointerEvents=["']auto["']/, 'the overlay must intercept touches');
  assert.match(renderedTree, /accessibilityViewIsModal/, 'the blocking state must also isolate accessibility focus');

  assert.match(gate, /StyleSheet\.absoluteFillObject/);
  assert.match(gate, /backgroundColor:\s*Colors\.bg/);
  assert.match(gate, /<ActivityIndicator[^>]+Colors\.primary/);
  assert.doesNotMatch(gate, /if\s*\(\s*checking\s*\|\|\s*awaitingAuthenticatedCheck\s*\)\s*\{?\s*return/i);
});

test('gate invalidates stale checks and completion cache when authenticated identity changes', () => {
  assert.match(gate, /activeUserId\s*=\s*useRef<string\s*\|\s*null>/);
  assert.match(gate, /requestGeneration\.current\s*\+=\s*1/);
  assert.match(gate, /activeUserId\.current\s*!==\s*userId[\s\S]*completedUserId\.current\s*=\s*null[\s\S]*setResolvedUserId\(null\)/);

  const generationIndex = gate.indexOf('requestGeneration.current += 1');
  const unauthenticatedBranchIndex = gate.indexOf('if (!isAuthReady || !userId)');
  assert.ok(generationIndex >= 0 && generationIndex < unauthenticatedBranchIndex,
    'every auth/path change must invalidate an older in-flight check before an early return');
});

test('route decisions remain single, non-oscillating, and fail open', () => {
  assert.equal(occurrences(gate, /router\.replace\(['"]\/onboarding\/personalization['"]\)/g), 1);
  assert.match(gate, /pathname\.startsWith\(['"]\/onboarding\/personalization['"]\)[\s\S]*return/);
  assert.match(gate, /completedUserId\.current\s*===\s*userId[\s\S]*return/);
  assert.match(gate, /Fail open[\s\S]*setResolvedUserId\(userId\)/i);
  assert.doesNotMatch(gate, /setTimeout|setInterval/);

  assert.equal(occurrences(onboarding, /router\.replace\(isEditing\s*\?\s*['"]\/settings['"]\s*:\s*['"]\/\(tabs\)['"]\)/g), 1);
  assert.doesNotMatch(onboarding, /setTimeout|setInterval/);
});

test('root Stack and provider tree remain singular under one persistent gate', () => {
  assert.equal(occurrences(layout, /<PersonalizationGate>/g), 1);
  assert.equal(occurrences(layout, /<FeedProvider>/g), 1);
  assert.equal(occurrences(layout, /<StoriesProvider>/g), 1);
  assert.equal(occurrences(layout, /<MessagesProvider>/g), 1);
  assert.equal(occurrences(layout, /<NotificationsProvider>/g), 1);
  assert.equal(occurrences(layout, /<ShopProvider>/g), 1);
  assert.equal(occurrences(layout, /<MarketplaceCartProvider>/g), 1);
  assert.equal(occurrences(layout, /<AgoraCallProvider>/g), 1);
  assert.equal(occurrences(layout, /<Stack\s/g), 1);

  const gateOpen = layout.indexOf('<PersonalizationGate>');
  const stack = layout.indexOf('<Stack ');
  const gateClose = layout.indexOf('</PersonalizationGate>');
  assert.ok(gateOpen >= 0 && gateOpen < stack && stack < gateClose,
    'one persistent gate must wrap the one provider/navigation tree');
});

test('root navigation content uses the canonical Nelyon dark background', () => {
  assert.match(layout, /import\s*\{\s*Colors\s*\}\s*from\s*['"]@\/constants\/theme['"]/);
  assert.match(layout, /<Stack\s+screenOptions=\{\{[\s\S]*contentStyle:\s*\{\s*backgroundColor:\s*Colors\.bg\s*\}/);
  assert.match(layout, /!isAuthReady[\s\S]*backgroundColor:\s*Colors\.bg/);
});

test('C2 does not introduce a second Feed load or onboarding authority', () => {
  assert.doesNotMatch(gate, /getRankedFeed|loadVideos|refreshVideos|FeedContext/);
  assert.doesNotMatch(onboarding, /getRankedFeed|loadVideos|refreshVideos/);
  assert.equal(occurrences(layout, /<PersonalizationGate>/g), 1,
    'layout should mount only one gate');
});
