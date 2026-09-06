import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const element = (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : { type, props: props ?? {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) };
function ui() {
  let cursor = 0; const slots = [], effects = [];
  const react = { createElement: element, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: value => ({ current: value }), useMemo: fn => fn(), useEffect: fn => effects.push(fn) };
  const rn = Object.fromEntries(['ActivityIndicator','Image','Pressable','Text','TextInput','View','FlatList','Modal','KeyboardAvoidingView'].map(n => [n,n]));
  rn.StyleSheet = { create: value => value }; rn.Platform = { OS: 'android' };
  rn.Animated = { Value: class {}, View: 'AnimatedView', timing: () => ({ start: fn => fn?.({ finished: true }) }) };
  const cache = {};
  function load(file) {
    if (cache[file]) return cache[file]; const module = { exports: {} };
    Function('require','module','exports',compile(read(file)))(name => {
      if (name === 'react') return react; if (name === 'react-native') return rn;
      if (name === '@expo/vector-icons') return { MaterialIcons: 'Icon' };
      if (name === './gifts/LiveGiftButton') return load('components/live/gifts/LiveGiftButton.tsx');
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/constants/theme') return Object.fromEntries(['Colors','FontSize','FontWeight','Radius','Spacing'].map(k => [k, new Proxy({}, { get: () => 8 })]));
      throw Error('Unexpected UI import ' + name);
    },module,module.exports); return cache[file] = module.exports;
  }
  return { load, render: (fn, props) => { cursor = 0; effects.length = 0; const tree = fn(props); for (const effect of effects) effect(); return tree; } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.type === 'FlatList' ? tree.props.data.map(item => tree.props.renderItem({ item })) : tree.children ?? [];
  return [tree, ...children.flatMap(nodes)];
}
const texts = tree => nodes(tree).filter(n => n.type === 'Text').flatMap(n => n.children).filter(n => typeof n === 'string').join(' ');
const press = node => { if (!node.props.disabled) return node.props.onPress(); };
const style = (node, pressed = false) => Object.assign({}, ...[typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style].flat(Infinity).filter(Boolean));
const bottomProps = { value: '', sending: false, editable: true, giftsDisabled: false, inputRef: { current: null }, onChangeText() {}, onSubmit() {}, onOpenGifts() {} };
function giftTarget(tree) { return nodes(tree).find(n => n.type === 'Pressable' && nodes(n).some(c => c.type === 'Icon' && c.props.name === 'card-giftcard')); }
test('Battle gift control has no visible Regalos text', () => {
  const { ViewerBottomBar } = ui().load('components/live/LiveBattleViewerChrome.tsx');
  assert.equal(texts(giftTarget(ViewerBottomBar(bottomProps))), '');
});
test('rail uses favorite, ios-share and more-horiz without visible labels', () => {
  const { ViewerActionRail } = ui().load('components/live/LiveBattleViewerChrome.tsx');
  const tree = ViewerActionRail({ onReact() {}, onShare() {}, onMore() {} });
  assert.equal(texts(tree), '');
  assert.deepEqual(nodes(tree).filter(n => n.type === 'Icon').map(n => n.props.name), ['favorite','ios-share','more-horiz']);
  assert.deepEqual(nodes(tree).filter(n => n.type === 'Pressable').map(n => n.props.accessibilityLabel), ['Reaccionar','Compartir','Más opciones']);
});
test('Battle gift is compact circular, at least 44px, and matches canonical LIVE button', () => {
  const h = ui(); const { ViewerBottomBar } = h.load('components/live/LiveBattleViewerChrome.tsx');
  const { LiveGiftButton } = h.load('components/live/gifts/LiveGiftButton.tsx');
  const a = style(giftTarget(ViewerBottomBar(bottomProps))), b = style(LiveGiftButton({ onPress() {} }));
  assert.ok(a.width >= 44 && a.height >= 44); assert.equal(a.width, a.height); assert.equal(a.borderRadius, a.width / 2); assert.deepEqual(a, b);
});
for (const battle of [false,true]) test(`${battle ? 'Battle' : 'LIVE'} gift accessibility, pressed and disabled semantics`, () => {
  const h = ui(); const { ViewerBottomBar } = h.load('components/live/LiveBattleViewerChrome.tsx'); const { LiveGiftButton } = h.load('components/live/gifts/LiveGiftButton.tsx');
  let opens = 0; const render = disabled => giftTarget(battle ? ViewerBottomBar({ ...bottomProps, giftsDisabled: disabled, onOpenGifts: () => opens++ }) : LiveGiftButton({ disabled, onPress: () => opens++ }));
  const active = render(false), disabled = render(true);
  assert.equal(texts(active), ''); assert.equal(active.props.accessibilityRole, 'button'); assert.equal(active.props.accessibilityLabel, 'Abrir regalos'); assert.equal(active.props.accessibilityHint, 'Abre el selector de regalos');
  assert.deepEqual(disabled.props.accessibilityState, { disabled: true }); assert.ok(style(disabled).opacity < 1); assert.notDeepEqual(style(active, true), style(active)); assert.deepEqual(style(disabled, true), style(disabled));
  press(active); press(disabled); assert.equal(opens, 1);
});
test('rail touch targets and callbacks remain intact', () => {
  const { ViewerActionRail } = ui().load('components/live/LiveBattleViewerChrome.tsx'); const calls = [];
  const tree = ViewerActionRail({ onReact: () => calls.push('react'), onShare: () => calls.push('share'), onMore: () => calls.push('more') });
  for (const target of nodes(tree).filter(n => n.type === 'Pressable')) { assert.ok(style(target).width >= 44 && style(target).height >= 44); assert.notDeepEqual(style(target,true), style(target)); press(target); }
  assert.deepEqual(calls, ['react','share','more']);
});
const watch = read('app/live/watch/[streamId].tsx');
const ast = ts.createSourceFile('watch.tsx',watch,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(predicate) { const out=[]; function visit(n) { if(predicate(n))out.push(n); ts.forEachChild(n,visit); } visit(ast); return out; }
const callback = find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'sendRealGift')[0].initializer.arguments[0].getText(ast);
const gift = { id:'rose', name:'Rosa', priceBdag:5, enabled:true, category:'basic', icon:'rose' };
const success = { success:true, new_sender_balance:95, transaction_id:'confirmed' };
function flow(options={}) {
  const state = { visible:true, commerce:true, balance:100, sending:null, feedback:[], trace:[], reconciles:0 };
  const calls=[]; const ref={ current:null }; const mounted={ current:true }; const gate={ current:false }; let nonce=0;
  const env = { streamId:'session', user:{ id:'viewer' }, giftsEnabled:true, walletBalance:100, mountedRef:mounted, sendingGiftRef:gate, pendingGiftAttemptRef:ref,
    battleState: options.battle === false ? null : { status:'active', battleId:'battle', localHostUserId:'host' },
    setSendingGiftId: v => { state.sending=v; state.trace.push('spinner:'+v); }, setWalletBalance: v=>{ state.balance=v; state.trace.push('balance'); }, setWalletBalanceError: ()=>{},
    setGiftSheetVisible:v=>{ state.visible=v; state.trace.push('visible:'+v); }, setCommerceVisible:v=>{state.commerce=v;},
    showGiftFeedback:v=>{state.feedback.push(v); state.trace.push('feedback');}, battleProjection:{ reconcile:()=>{state.reconciles++;state.trace.push('reconcile');} },
    sendLiveGiftForContext:async args=>{calls.push(args);state.trace.push('rpc');return options.rpc ? options.rpc(args) : success;},
    console:{warn(){}}, Date:{now:()=>1000}, Math:{random:()=>++nonce/100}, ...options.env };
  const evaluate = code => Function(...Object.keys(env),compile(`const fn = ${code};`)+'; return fn;')(...Object.values(env));
  const opening = (component, prop) => {
    const tags=find(n=>(ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n))&&n.tagName.getText(ast)===component);
    const tag=tags.find(n=>n.attributes.properties.some(p=>p.name?.text===prop));
    return evaluate(tag.attributes.properties.find(p=>p.name?.text===prop).initializer.expression.getText(ast));
  };
  return { state,calls,ref,mounted,gate,env, send:()=>evaluate(callback)(gift), open:opening(options.battle===false?'LiveGiftButton':'ViewerBottomBar',options.battle===false?'onPress':'onOpenGifts'), close:opening('LiveGiftSheet','onClose') };
}
for (const battle of [false,true]) test(`${battle ? 'Battle':'LIVE'} opens once, closes only after authoritative success, updates balance and confirms`, async () => {
  let resolve; const h=flow({battle,rpc:()=>new Promise(r=>{resolve=r;})}); h.state.visible=false;
  h.open(); assert.equal(h.state.visible,true); assert.equal(h.state.commerce,false); assert.deepEqual(h.state.trace,['visible:true']);
  const flight=h.send(); assert.equal(h.state.visible,true); assert.equal(h.state.sending,'rose'); assert.equal(h.state.feedback.length,0);
  resolve(success); await flight;
  assert.equal(h.state.visible,false); assert.equal(h.state.balance,95); assert.deepEqual(h.state.feedback,['Rosa enviado']); assert.equal(h.ref.current,null); assert.equal(h.gate.current,false); assert.equal(h.state.sending,null); assert.equal(h.state.reconciles,battle?1:0);
  assert.ok(h.state.trace.indexOf('balance')<h.state.trace.indexOf('visible:false')); assert.ok(h.state.trace.indexOf('visible:false')<h.state.trace.indexOf('feedback'));
});
for (const kind of ['false','exception','insufficient','disabled','balance unavailable','Battle normalized']) test(`${kind} keeps sheet open without success feedback or reconciliation`, async () => {
  const env=kind==='insufficient'?{walletBalance:0}:kind==='disabled'?{giftsEnabled:false}:kind==='balance unavailable'?{walletBalance:null}:{};
  const h=flow({env,rpc:async()=>{if(kind==='exception')throw Error('private detail');return {success:false,error:kind==='Battle normalized'?'La Battle ya no acepta regalos':undefined};}});
  await h.send(); assert.equal(h.state.visible,true); assert.equal(h.state.balance,100); assert.equal(h.state.reconciles,0); assert.equal(h.gate.current,false); assert.equal(h.state.sending,null);
  assert.equal(h.state.feedback.length,1); assert.doesNotMatch(h.state.feedback[0],/enviado|private detail/); assert.ok(!h.state.trace.includes('visible:false'));
  assert.equal(h.calls.length,['insufficient','disabled','balance unavailable'].includes(kind)?0:1);
});
test('double press has one RPC and key; spinner clears after completion', async () => {
  let resolve;const h=flow({rpc:()=>new Promise(r=>{resolve=r;})});const first=h.send();const key=h.ref.current.idempotencyKey;
  await h.send();assert.equal(h.calls.length,1);assert.equal(h.ref.current.idempotencyKey,key);assert.equal(h.state.sending,'rose');resolve(success);await first;assert.equal(h.state.sending,null);assert.equal(h.gate.current,false);
});
test('ambiguous retry preserves its key across manual close and reopen', async () => {
  let fail=true;const h=flow({rpc:async()=>{if(fail)throw Error('network');return success;}});
  await h.send();const key=h.ref.current.idempotencyKey;h.close();assert.equal(h.ref.current.idempotencyKey,key);assert.equal(h.calls.length,1);h.open();fail=false;await h.send();assert.equal(h.calls[1].idempotencyKey,key);assert.equal(h.state.visible,false);
});
test('manual close during flight neither clears key nor creates a send or false confirmation',async()=>{
  let resolve;const h=flow({rpc:()=>new Promise(r=>{resolve=r;})});const flight=h.send();const key=h.ref.current.idempotencyKey;
  h.close();assert.equal(h.calls.length,1);assert.equal(h.ref.current.idempotencyKey,key);assert.deepEqual(h.state.feedback,[]);
  h.open();await h.send();assert.equal(h.calls.length,1);resolve({success:false,error:'La Battle ya no acepta regalos'});await flight;
  assert.equal(h.state.visible,true);assert.equal(h.ref.current.idempotencyKey,key);assert.equal(h.gate.current,false);assert.doesNotMatch(h.state.feedback.join(' '),/enviado/);
});
test('stale send callback after unmount is a no-op',async()=>{
  const h=flow();h.mounted.current=false;await h.send();assert.equal(h.calls.length,0);assert.deepEqual(h.state.trace,[]);assert.equal(h.ref.current,null);
});
test('two separate open/select/send cycles create exactly two keys', async () => {
  const h=flow();h.open();await h.send();assert.equal(h.state.visible,false);assert.equal(h.calls.length,1);
  h.open();await h.send();assert.equal(h.calls.length,2);assert.notEqual(h.calls[0].idempotencyKey,h.calls[1].idempotencyKey);assert.equal(h.state.visible,false);
});
for(const throws of [false,true]) test(`in-flight unmount (throws=${throws}) cannot update UI or reconcile`,async()=>{
  let resolve,reject;const h=flow({rpc:()=>new Promise((a,b)=>{resolve=a;reject=b;})});const flight=h.send();h.mounted.current=false;const before=[...h.state.trace];
  if(throws)reject(Error('network'));else resolve(success);await flight;assert.deepEqual(h.state.trace,before);assert.equal(h.state.reconciles,0);assert.equal(h.gate.current,false);
});
function sheet(overrides={}) {
  const h=ui(),{LiveGiftSheet}=h.load('components/live/gifts/LiveGiftSheet.tsx');let closed=0,sends=0;
  const props={visible:true,balance:100,catalog:[gift],sendingGiftId:null,giftsEnabled:true,onSendGift:()=>sends++,onClose:()=>closed++,...overrides};
  return {props,render:()=>h.render(LiveGiftSheet,props),closed:()=>closed,sends:()=>sends};
}
test('sheet selection requires send, disables cards/send and shows spinner while in flight',()=>{
  const h=sheet();let tree=h.render();const card=nodes(tree).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel?.startsWith('Rosa,'));press(card);assert.equal(h.sends(),0);tree=h.render();
  const send=nodes(tree).find(n=>n.type==='Pressable'&&texts(n).startsWith('Enviar Rosa'));press(send);assert.equal(h.sends(),1);h.props.sendingGiftId='rose';tree=h.render();
  const cards=nodes(tree).filter(n=>n.type==='Pressable'&&(n.props.accessibilityLabel?.startsWith('Rosa,')||texts(n).startsWith('Enviar Rosa')));assert.equal(cards.length,2);
  for(const c of cards){assert.equal(c.props.disabled,true);press(c);}assert.equal(h.sends(),1);assert.equal(nodes(tree).filter(n=>n.type==='ActivityIndicator').length,2);
});
test('X, backdrop and Android back close manually without sending',()=>{
  const h=sheet();const tree=h.render();const close=nodes(tree).filter(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='Cerrar regalos');assert.equal(close.length,2);for(const target of close)press(target);tree.props.onRequestClose();assert.equal(h.closed(),3);assert.equal(h.sends(),0);
});
test('hidden sheet resets selection, so second gift requires reopening and selecting',()=>{
  const h=sheet();let tree=h.render();press(nodes(tree).find(n=>n.props.accessibilityLabel?.startsWith('Rosa,')));h.render();h.props.visible=false;h.render();tree=h.render();assert.equal(tree.props.visible,false);
  h.props.visible=true;h.render();tree=h.render();assert.equal(tree.props.visible,true);const send=nodes(tree).find(n=>n.type==='Pressable'&&texts(n)==='Selecciona un regalo');assert.equal(send.props.disabled,true);press(send);assert.equal(h.sends(),0);
});
test('gift animations remain server-event driven through the existing single overlay',()=>{
  assert.doesNotMatch(callback,/enqueue|addFloatingReaction|setActiveGift|atomic_ledger_transfer|\.rpc\(/);
  assert.match(watch,/useLiveGiftAnimations/);assert.match(watch,/enqueueGift\(giftEvent\)/);assert.match(watch,/<LiveGiftOverlay/);assert.match(read('components/live/gifts/LiveGiftOverlay.tsx'),/return <LiveGiftPresentationLayer \{\.\.\.props\}/);
});
