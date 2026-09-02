import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const stageSource = await read('components/live/LiveBattleStage.tsx');
const headerSource = await read('components/live/LiveSessionHeader.tsx');
const watchSource = await read('app/live/watch/[streamId].tsx');
const broadcastSource = await read('app/live/broadcast/[streamId].tsx');
const giftSheetSource = await read('components/live/gifts/LiveGiftSheet.tsx');

function parseTsx(source, name) {
  const sourceFile = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(sourceFile.parseDiagnostics, [], `${name} must parse without syntax errors`);
  return sourceFile;
}

const stageAst = parseTsx(stageSource, 'LiveBattleStage.tsx');
parseTsx(headerSource, 'LiveSessionHeader.tsx');
const watchAst = parseTsx(watchSource, 'watch.tsx');
const broadcastAst = parseTsx(broadcastSource, 'broadcast.tsx');

function collect(root, predicate) {
  const matches = [];
  const visit = node => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function jsxTagName(node) {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return null;
  return node.tagName.getText(node.getSourceFile());
}

function jsxNodes(sourceFile, tagName) {
  return collect(sourceFile, node => jsxTagName(node) === tagName);
}

function jsxAttribute(node, attributeName) {
  return node.attributes.properties.find(property =>
    ts.isJsxAttribute(property) && property.name.getText(node.getSourceFile()) === attributeName
  );
}

function jsxByStyle(sourceFile, styleName) {
  return collect(sourceFile, node => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return false;
    const style = jsxAttribute(node, 'style');
    return Boolean(style?.initializer?.getText(sourceFile).includes(`styles.${styleName}`));
  });
}

function enclosingGuardText(node, sourceFile) {
  const guards = [];
  let current = node.parent;
  while (current) {
    if (ts.isConditionalExpression(current)) guards.push(current.condition.getText(sourceFile));
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      guards.push(current.left.getText(sourceFile));
    }
    current = current.parent;
  }
  return guards.join(' && ');
}

function variableInitializers(sourceFile) {
  const result = new Map();
  for (const declaration of collect(sourceFile, ts.isVariableDeclaration)) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
      result.set(declaration.name.text, declaration.initializer);
    }
  }
  return result;
}

function transitiveDependencies(name, declarations, seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  const initializer = declarations.get(name);
  if (!initializer) return seen;
  for (const identifier of collect(initializer, ts.isIdentifier)) {
    if (ts.isPropertyAccessExpression(identifier.parent) && identifier.parent.name === identifier) continue;
    if (ts.isPropertyAssignment(identifier.parent) && identifier.parent.name === identifier) continue;
    if (declarations.has(identifier.text)) transitiveDependencies(identifier.text, declarations, seen);
  }
  return seen;
}

function evaluateBattleLayout() {
  const constants = ['BATTLE_LAYOUT_GAP', 'BATTLE_HOST_ACTION_HEIGHT']
    .map(name => {
      const declaration = collect(broadcastAst, node =>
        ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
      )[0];
      assert.ok(declaration, `${name} must exist`);
      return `const ${name} = ${declaration.initializer.getText(broadcastAst)};`;
    });
  const functionNode = collect(broadcastAst, node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'resolveBattleBroadcastLayout'
  )[0];
  assert.ok(functionNode, 'resolveBattleBroadcastLayout must exist');
  const functionText = functionNode.getText(broadcastAst).replace(/^export\s+/, '');
  const javascript = ts.transpileModule([...constants, functionText].join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return Function(`${javascript}\nreturn resolveBattleBroadcastLayout;`)();
}

test('Battle stage keeps exactly two equal, edge-to-edge video surfaces', () => {
  const hostPanels = jsxNodes(stageAst, 'HostPanel');
  assert.equal(hostPanels.length, 2);
  assert.deepEqual(
    hostPanels.map(node => jsxAttribute(node, 'side')?.initializer?.getText(stageAst)).sort(),
    ['"local"', '"opponent"'],
  );
  const styleDeclarations = variableInitializers(stageAst);
  assert.match(styleDeclarations.get('styles')?.getText(stageAst) ?? stageSource, /panels: \{ flex: 1, flexDirection: 'row' \}/);
  assert.doesNotMatch(stageSource, /panels:[^\n]*gap:/);
});

test('sanitized host identities align to their canonical sides', () => {
  const hostNameNodes = jsxByStyle(stageAst, 'hostName');
  assert.equal(hostNameNodes.length, 2);
  assert.ok(hostNameNodes.some(node => node.parent.getText(stageAst).includes('localHost.username')));
  assert.ok(hostNameNodes.some(node => node.parent.getText(stageAst).includes('opponentHost.username')));
  assert.match(stageSource, /localName: \{[^}]*textAlign: 'left'/);
  assert.match(stageSource, /opponentName: \{[^}]*textAlign: 'right'/);
});

test('watch and broadcast expose only their two canonical Battle surfaces', () => {
  for (const [sourceFile, label] of [[watchAst, 'watch'], [broadcastAst, 'broadcast']]) {
    const stage = jsxNodes(sourceFile, 'LiveBattleStage');
    assert.equal(stage.length, 1, `${label} must mount one Battle stage`);
    for (const attributeName of ['localSurface', 'opponentSurface']) {
      const attribute = jsxAttribute(stage[0], attributeName);
      assert.ok(attribute, `${label} must define ${attributeName}`);
      assert.equal(jsxNodes(attribute, 'RtcSurfaceView').length, 1, `${label} ${attributeName} must own one surface`);
    }
  }
});

test('additional cohost strips are structurally excluded during Battle and return afterward', () => {
  const watchStrip = jsxByStyle(watchAst, 'coHostStrip');
  const broadcastStrip = jsxByStyle(broadcastAst, 'remoteStrip');
  assert.equal(watchStrip.length, 1);
  assert.equal(broadcastStrip.length, 1);
  assert.match(enclosingGuardText(watchStrip[0], watchAst), /!battleState/);
  assert.match(enclosingGuardText(broadcastStrip[0], broadcastAst), /!battleState/);
  assert.match(enclosingGuardText(watchStrip[0], watchAst), /coHostUids\.length > 0/);
  assert.match(enclosingGuardText(broadcastStrip[0], broadcastAst), /cohostRemoteUids\.length > 0/);
});

test('Battle broadcast layout is pure, composer-based, and independent of products', () => {
  const resolveLayout = evaluateBattleLayout();
  assert.deepEqual(
    resolveLayout({ keyboardHeight: 0, composerClearance: 74, actionsBottom: 130 }),
    { panelBottom: 190, chatBottom: 190, railBottom: 190 },
  );
  assert.deepEqual(
    resolveLayout({ keyboardHeight: 300, composerClearance: 360, actionsBottom: 416 }),
    { panelBottom: 368, chatBottom: 368, railBottom: 368 },
  );

  const declarations = variableInitializers(broadcastAst);
  const banned = new Set([
    'featuredLiveProduct', 'featuredProductMeasurement', 'effectiveProductHeight',
    'PRODUCT_HEIGHT_FALLBACK', 'PRODUCT_PLACEHOLDER_HEIGHT', 'productBottom',
    'productOverlayClearance',
  ]);
  for (const variable of ['battleLayout', 'battlePanelsBottom', 'battleChatBottom', 'battleRailBottom', 'battleChatMaxHeight']) {
    const dependencies = transitiveDependencies(variable, declarations);
    assert.equal([...dependencies].filter(name => banned.has(name)).length, 0, `${variable} must not depend on commerce`);
  }
  assert.ok(transitiveDependencies('chatBottom', declarations).has('productOverlayClearance'));
});

test('broadcast Battle chat, panels, rail, and composer use Battle-specific positioning', () => {
  const chat = jsxByStyle(broadcastAst, 'chatArea')[0];
  const rail = jsxByStyle(broadcastAst, 'engagementRail')[0];
  const composer = jsxByStyle(broadcastAst, 'inputRow')[0];
  const chatStyle = jsxAttribute(chat, 'style').initializer.getText(broadcastAst);
  assert.match(chatStyle, /bottom: chatBottom/);
  assert.match(chatStyle, /battleState && styles\.battleChatArea/);
  assert.match(chatStyle, /battleState && \{ bottom: battleChatBottom, maxHeight: battleChatMaxHeight \}/);
  assert.ok(chatStyle.indexOf('bottom: battleChatBottom') > chatStyle.indexOf('bottom: chatBottom'));
  assert.match(jsxAttribute(rail, 'style').initializer.getText(broadcastAst), /battleState \? \{ bottom: battleRailBottom \} : \{ top:/);
  assert.match(jsxAttribute(composer, 'style').initializer.getText(broadcastAst), /battleState && styles\.battleInputRow/);

  for (const styleName of ['requestPanel', 'audiencePanel', 'moderationPanel', 'giftActivityPanel']) {
    const panel = jsxByStyle(broadcastAst, styleName)[0];
    assert.ok(panel, `${styleName} must remain available`);
    const panelStyle = jsxAttribute(panel, 'style').initializer.getText(broadcastAst);
    assert.match(panelStyle, /bottom: productOverlayClearance/);
    assert.match(panelStyle, /battleState && \{ bottom: battlePanelsBottom/);
    assert.ok(panelStyle.lastIndexOf('bottom: battlePanelsBottom') > panelStyle.indexOf('bottom: productOverlayClearance'));
  }
});

test('watch Battle chat and composer stay above the keyboard using composer clearance', () => {
  const chat = jsxByStyle(watchAst, 'bottomSection')[0];
  const composer = jsxByStyle(watchAst, 'inputRow')[0];
  const chatStyle = jsxAttribute(chat, 'style').initializer.getText(watchAst);
  const composerStyle = jsxAttribute(composer, 'style').initializer.getText(watchAst);
  assert.match(chatStyle, /battleState \? composerClearance \+ 8 : composerClearance \+ 86/);
  assert.match(chatStyle, /battleState && styles\.battleBottomSection/);
  assert.match(composerStyle, /battleState && styles\.battleInputRow/);
  assert.match(composerStyle, /bottom: composerBottom \+ 8/);
});

test('timer remains server-anchored with one one-second interval and cleanup', () => {
  assert.match(stageSource, /estimateLiveBattleServerNow\(clockAnchor, monotonicNow\)/);
  assert.match(stageSource, /readLiveBattleMonotonicNow\(\)/);
  assert.match(stageSource, /if \(!clockAnchor\)[\s\S]*setMonotonicNow\(null\)/);
  assert.match(stageSource, /return '--:--'/);
  assert.equal((stageSource.match(/setInterval\(/g) ?? []).length, 1);
  assert.match(stageSource, /setInterval\([\s\S]*1_000\)/);
  assert.equal((stageSource.match(/clearInterval\(/g) ?? []).length, 1);
  assert.doesNotMatch(stageSource, /Date\.now\(|\brpc\(|poll|setTimeout/i);
});

test('illustrative Figma scores and rounds are replaced by the accessible canonical projection', () => {
  assert.doesNotMatch(stageSource, /12,480|11,920|RONDA\s*1/i);
  assert.match(stageSource, /accessibilityLabel=\{`Marcador \$\{competitive\.localScore\} a \$\{competitive\.rivalScore\}`\}/);
  assert.match(stageSource, /competitive\.localRoseProgressUnits/);
  assert.match(stageSource, /competitive\.rivalRoseProgressUnits/);
  assert.match(stageSource, /terminalLabel/);
  assert.doesNotMatch(stageSource, /live_gift|financial|ledger/i);
});

test('watch closes and fully hides commerce during Battle while retaining normal LIVE commerce', () => {
  assert.match(watchSource, /if \(!battleStageVisible\) return;[\s\S]*setCommerceVisible\(false\);[\s\S]*setCommerceProductId\(null\)/);
  for (const component of ['LiveCommerceButton', 'LiveProductRail', 'LiveViewerCommerce']) {
    const nodes = jsxNodes(watchAst, component);
    assert.ok(nodes.length > 0, `${component} must remain in normal LIVE`);
    for (const node of nodes) assert.match(enclosingGuardText(node, watchAst), /!battleState/);
  }
});

test('broadcast closes and hides product controls, CTA, feed, and manager during Battle', () => {
  assert.match(broadcastSource, /if \(!battleStageVisible\) return;[\s\S]*setCommerceVisible\(false\)/);
  for (const component of ['LiveProductRail', 'LiveHostPurchaseFeed', 'LiveHostProductManager']) {
    const nodes = jsxNodes(broadcastAst, component);
    assert.ok(nodes.length > 0, `${component} must remain in normal LIVE`);
    for (const node of nodes) assert.match(enclosingGuardText(node, broadcastAst), /!battleState/);
  }
  const pinAction = collect(broadcastAst, node =>
    ts.isJsxAttribute(node)
    && node.name.getText(broadcastAst) === 'accessibilityLabel'
    && node.initializer?.getText(broadcastAst).includes('Fijar o cambiar producto destacado')
  )[0];
  assert.ok(pinAction);
  assert.match(enclosingGuardText(pinAction, broadcastAst), /!battleState/);
});

test('watch reuses existing gift, reaction, share, and camera-request flows', () => {
  assert.match(watchSource, /<LiveGiftSheet[\s\S]*onSendGift=\{sendRealGift\}/);
  assert.match(watchSource, /setGiftSheetVisible\(true\)/);
  assert.match(watchSource, /onPress=\{\(\) => sendReaction\('/);
  assert.match(watchSource, /onPress=\{shareLive\}/);
  assert.match(watchSource, /onPress=\{\(\) => requestToJoin\(\)\}/);
  assert.doesNotMatch(watchSource + giftSheetSource, /giftTarget|recipientSelector|Regalo para/);
});

test('broadcast never adds a self-gift action and retains host controls', () => {
  assert.doesNotMatch(broadcastSource, /<LiveGiftButton|setGiftSheetVisible|sendLiveGift/);
  assert.match(broadcastSource, /<LiveBattleHostControls/);
  assert.match(broadcastSource, /onPress=\{toggleMute\}/);
  assert.match(broadcastSource, /onPress=\{switchCamera\}/);
  assert.match(broadcastSource, /onPress=\{toggleCamera\}/);
});

test('Battle controls and close action meet the forty-four pixel touch target', () => {
  assert.match(headerSource, /battleCloseTarget: \{ width: 44, height: 44/);
  assert.match(watchSource, /battleActionButton: \{ width: 48, height: 48/);
  assert.match(broadcastSource, /engagementAction: \{ width: 44, minHeight: 48/);
});

test('the canonical-side migration remains present at the audited F5-A frontier', async () => {
  const migrationNames = await readdir(new URL('../supabase/migrations/', import.meta.url));
  const sqlMigrations = migrationNames.filter(name => name.endsWith('.sql')).sort();
  assert.ok(sqlMigrations.includes(
    '20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql',
  ));
  assert.equal(
    sqlMigrations.at(-1),
    '20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql',
  );
});
