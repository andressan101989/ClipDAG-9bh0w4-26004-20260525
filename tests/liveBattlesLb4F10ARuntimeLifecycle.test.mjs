import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function load(source, imports = {}, globals = {}) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } });
  const module = { exports: {} };
  Function('require', 'module', 'exports', ...Object.keys(globals), compiled.outputText)(name => {
    assert.ok(name in imports, 'Unexpected import ' + name); return imports[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const S = '20000000-0000-4000-8000-000000000001', T = '20000000-0000-4000-8000-000000000002';
const ID = '30000000-0000-4000-8000-000000000001';
const now = Date.parse('2026-09-06T12:00:00Z');
const raw = (extra = {}) => ({ id: ID, challengerUserId: A, opponentUserId: B, challengerSessionId: S, opponentSessionId: T, status: 'active', version: 3, endedAt: null, scheduledStartAt: new Date(now - 3000).toISOString(), scheduledEndAt: new Date(now + 300000).toISOString(), ...extra });
const context = (extra = {}) => ({ liveSessionId: S, hostUserId: A, isCanonicalHost: true, isSessionLive: true, isOpponentSessionLive: true, engineReady: true, joined: true, isForeground: true, ...extra });
const series = { id: ID, format: 'best_of_5', status: 'awaiting_rematch', roundNumber: 1, roundsCompleted: 1, maxRounds: 5, winsRequired: 3, challengerWins: 0, opponentWins: 0, ties: 1, championUserId: null, version: 2, rematchWindowExpiresAt: new Date(now + 30000).toISOString(), rematchRequestStatus: null, rematchRequestId: null, rematchRequestAfterBattleId: null };
const projection = (extra = {}) => ({ sessionId: S, battleId: ID, localHostUserId: A, opponentHostUserId: B, opponentSessionId: T, status: 'active', version: 3, projectionVersion: 3, series: null, ...extra });
const anchor = { serverEpochMsAtAnchor: now, monotonicMsAtAnchor: 0 };
const policy = load(read('services/liveBattlePostRoundRelayPolicy.ts'));
const service = { isLiveBattleUuid: v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v) };
const { LiveBattleRuntimeController: Controller } = load(read('services/liveBattleRuntimeController.ts'), { './liveBattleService': service, './liveBattlePostRoundRelayPolicy': policy });
const settle = async c => { await new Promise(r => setImmediate(r)); await c.waitForIdle(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function harness() {
  const timers = new Map(), signals = []; let sequence=0, candidates=[], battle=raw(), publicState=projection();
  const calls={ start:[], stop:0, reconciles:[], disposed:0, subscribed:0, unsubscribed:0 };
  let relaySnapshot={state:'idle', battleId:null}; const listeners=new Set();
  const emit = value => { relaySnapshot=value; for(const fn of listeners)fn(value); };
  const relay={ async start(id){ calls.start.push(id); emit({state:'running',battleId:id}); }, async refreshCredentials(){}, async transition(id){ calls.start.push(id); emit({state:'running',battleId:id}); }, async stop(){calls.stop++;emit({state:'idle',battleId:null});}, stopImmediately(){ if(relaySnapshot.battleId)calls.stop++;emit({state:'idle',battleId:null}); }, async dispose(){calls.disposed++;listeners.clear();}, getSnapshot:()=>relaySnapshot, subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);} };
  const controller=new Controller({relay, now:()=>now, monotonicNow:()=>0,
    setTimer:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay});return id;}, clearTimer:id=>timers.delete(id),
    discover:async()=>candidates, reconcile:async id=>{calls.reconciles.push(id);return battle;},
    subscribe:(_id,signal,error)=>{calls.subscribed++;signals.push({signal,error});return {unsubscribe:async()=>{calls.unsubscribed++;}};},
    readPublicAuthority:async()=>({state:publicState,clockAnchor:anchor,serverNow:new Date(now).toISOString()}),
    validateSessionPair:async state=>({localSessionId:state.sessionId,opponentSessionId:state.opponentSessionId,localHostUserId:state.localHostUserId,opponentHostUserId:state.opponentHostUserId,localSessionLive:true,opponentSessionLive:true}),
  });
  return {controller,calls,timers,signals,listeners,relay, set:(b,p=projection())=>{battle=b;publicState=p;}, discover:v=>{candidates=v;}, activate:async c=>{controller.updateContext(context(c));await settle(controller);}, public:p=>controller.updatePublicAuthority(p,anchor)};
}

test('public active authority wakes a runtime whose initial discovery was empty', async()=>{
  const h=harness(); try {await h.activate(); h.discover([raw()]);h.public(projection());await settle(h.controller);assert.deepEqual(h.calls.start,[ID]);}finally{await h.controller.dispose();}
});
test('public completed authority rehydrates the result when open discovery has no rows', async()=>{
  const h=harness();try{await h.activate();h.set(raw({status:'completed',endedAt:new Date(now).toISOString(),version:4}),projection({status:'completed',version:4,series}));h.public(projection({status:'completed',version:4,series}));await settle(h.controller);assert.equal(h.controller.getSnapshot().battle?.status,'completed');assert.deepEqual(h.calls.reconciles,[ID]);}finally{await h.controller.dispose();}
});
test('public version advance reconciles an existing pending round without a local action',async()=>{
  const h=harness();try{h.discover([raw({status:'pending',version:1})]);h.set(raw({status:'pending',version:1}));await h.activate();h.set(raw());h.discover([raw()]);h.public(projection());await settle(h.controller);assert.deepEqual(h.calls.start,[ID]);}finally{await h.controller.dispose();}
});
test('fresh public authority recovers a subscription-suspended eligible runtime',async()=>{
  const h=harness();try{await h.activate();await h.signals[0].error();h.discover([raw()]);h.public(projection());await settle(h.controller);assert.deepEqual(h.calls.start,[ID]);assert.equal(h.calls.subscribed-h.calls.unsubscribed,1);}finally{await h.controller.dispose();}
});
test('duplicate public and realtime signals start only one relay',async()=>{
  const h=harness();try{h.discover([raw()]);await h.activate();for(let i=0;i<20;i++){h.public(projection());h.signals.at(-1).signal({battleId:ID,version:3});}await settle(h.controller);assert.deepEqual(h.calls.start,[ID]);}finally{await h.controller.dispose();}
});
test('both hosts reconcile the same authoritative pair from remote signals',async()=>{
  for(const side of [{},{liveSessionId:T,hostUserId:B}]){const h=harness();try{await h.activate(side);h.discover([raw()]);h.signals[0].signal({battleId:ID,version:3});await settle(h.controller);assert.deepEqual(h.calls.start,[ID]);assert.equal(h.controller.getSnapshot().battle.opponentSessionId,T);}finally{await h.controller.dispose();}}
});
test('a mismatched session is rejected rather than relinked to the active Battle',async()=>{
  const h=harness();try{h.discover([raw()]);await h.activate({liveSessionId:'20000000-0000-4000-8000-000000000003'});assert.equal(h.calls.start.length,0);assert.equal(h.controller.getSnapshot().errorCode,'live_battle_host_authority_changed');}finally{await h.controller.dispose();}
});
test('late subscription error from an obsolete session cannot suspend the new subscription',async()=>{
  const h=harness();try{await h.activate();const old=h.signals[0];await h.activate({liveSessionId:T,hostUserId:B});old.error();h.discover([raw()]);h.signals.at(-1).signal({battleId:ID,version:3});await settle(h.controller);assert.deepEqual(h.calls.start,[ID]);}finally{await h.controller.dispose();}
});
test('authoritative completion holds post-round and stops on terminal decision without ending LIVE',async()=>{
  const h=harness();try{h.discover([raw()]);await h.activate();const done=raw({status:'completed',endedAt:new Date(now).toISOString(),version:4});h.set(done,projection({status:'completed',version:4,series}));h.discover([]);await h.controller.reconcileNow();assert.equal(h.controller.getSnapshot().battle.status,'completed');assert.equal(h.calls.stop,0);assert.equal(h.timers.size,1);h.set(done,projection({status:'completed',version:4,series:{...series,status:'completed'}}));await h.controller.reconcileNow();assert.equal(h.calls.stop,1);}finally{await h.controller.dispose();}
});
test('cleanup removes timers, subscriptions and listeners and ignores a late reconciliation',async()=>{
  const h=harness();h.discover([raw()]);await h.activate();await h.controller.dispose();await h.controller.dispose();h.signals[0].signal({battleId:ID,version:99});assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);assert.equal(h.calls.subscribed,h.calls.unsubscribed);assert.equal(h.calls.disposed,1);assert.equal(h.calls.start.length,1);
});

// Effect runner preserves hook slots and uses Object.is dependencies like React.
function hooks() {
  const slots=[];let cursor=0,pending=[],writes=0;
  const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
  const react={useRef(v){const i=cursor++;return slots[i]??=( {current:v});},useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],n=>{writes++;slots[i]=typeof n==='function'?n(slots[i]):n;}];},useCallback(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps)){pending.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});}}};
  return {react,render(fn){cursor=0;pending=[];const result=fn();pending.forEach(fn=>fn());return result;},unmount(){for(const slot of slots)slot?.cleanup?.();},get writes(){return writes;}};
}
function hookHarness() {
  const runner=hooks(), calls={created:0,disposed:0,authorities:[],contexts:[]}, engine={}, guards=new Set();
  const register=fn=>{guards.add(fn);return()=>guards.delete(fn);};
  class FakeController{constructor(){calls.created++;}subscribe(fn){calls.publish=fn;return()=>{};}updateContext(c){calls.contexts.push(c);}updatePublicAuthority(p){calls.authorities.push(p);}handleEngineRelease(){}async dispose(){calls.disposed++;}async reconcileNow(){} }
  const hook=load(read('hooks/live/useLiveBattleRelayRuntime.native.ts'),{'react':runner.react,'@/services/liveBattleRelayService':{LiveBattleRelayService:class{}},'@/services/liveBattleService':{},'@/services/liveBattleRuntimeController':{LiveBattleRuntimeController:FakeController},'@/services/liveBattleSeriesService':{},'@/services/liveBattleSpectatorService':{}}).useLiveBattleRelayRuntime;
  const props={...context(),getEngine:()=>engine,registerBeforeEngineRelease:register,reconnectEpoch:0,publicBattleState:projection(),publicClockAnchor:anchor};
  return {runner,calls,guards,props,render:()=>runner.render(()=>hook(props))};
}
test('public authority received before join is delivered when the native controller is created',()=>{
  const h=hookHarness();try{h.props.joined=false;h.render();h.props.joined=true;h.render();assert.equal(h.calls.authorities.at(-1),h.props.publicBattleState);assert.equal(h.calls.created,1);}finally{h.runner.unmount();}
});
test('stable engine callbacks do not recreate an eligible controller during public clock updates',()=>{
  const h=hookHarness();try{h.render();for(let i=0;i<10;i++){h.props.publicClockAnchor={...anchor};h.render();}assert.equal(h.calls.created,1);assert.equal(h.calls.disposed,0);assert.equal(h.guards.size,1);}finally{h.runner.unmount();}assert.equal(h.guards.size,0);assert.equal(h.calls.disposed,1);
});
test('context recovery reapplies the current projection even if its object identity is unchanged',()=>{
  const h=hookHarness();try{h.render();const n=h.calls.authorities.length;h.props.isForeground=false;h.render();h.props.isForeground=true;h.render();assert.ok(h.calls.authorities.length>n);}finally{h.runner.unmount();}
});
test('authoritative runtime completion refreshes the UI snapshot without relying on a second realtime delivery',async()=>{
  const h=hookHarness();let reconciles=0;h.props.reconcilePublicAuthority=async()=>{reconciles++;};try{h.render();h.calls.publish({status:'observing',battleId:ID,version:4,battle:raw({status:'completed',version:4,endedAt:new Date(now).toISOString()})});h.render();await Promise.resolve();assert.equal(reconciles,1);h.render();assert.equal(reconciles,1);}finally{h.runner.unmount();}
});

function callback(name, env) {
  const file=ts.createSourceFile('screen.tsx',read('app/live/broadcast/[streamId].tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
  function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name&&ts.isCallExpression(n.initializer))found=n.initializer.arguments[0];ts.forEachChild(n,visit);}visit(file);assert.ok(found,name);
  const code=ts.transpileModule('const callback='+found.getText(file),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return Function(...Object.keys(env),code+';return callback;')(...Object.values(env));
}
test('a failed LIVE authority read does not masquerade as an ended session or clear the Battle',async()=>{
  const changes=[];const query={select(){return this;},in:async()=>({data:null,error:{message:'network'}})};
  const poll=callback('poll',{streamId:S,battleOpponentSessionId:T,battleOpponentHostUserId:B,supabase:{from:()=>query},mountedRef:{current:true},pollGenerationRef:{current:0},user:{id:A},setViewerCount(){},setSessionIsCanonicalLive:v=>changes.push(v),setBattleOpponentSessionIsLive:v=>changes.push(v),stopBattleRuntime:()=>changes.push('stop')});
  await poll();assert.deepEqual(changes,[]);
});
test('an obsolete poll response cannot mutate the authority of the current session pair',async()=>{
  const flight=deferred(),generation={current:0},changes=[];const query={select(){return this;},in:()=>flight.promise};
  const poll=callback('poll',{streamId:S,battleOpponentSessionId:T,battleOpponentHostUserId:B,supabase:{from:()=>query},mountedRef:{current:true},pollGenerationRef:generation,user:{id:A},setViewerCount:v=>changes.push(v),setSessionIsCanonicalLive:v=>changes.push(v),setBattleOpponentSessionIsLive:v=>changes.push(v),stopBattleRuntime:()=>changes.push('stop')});
  const pending=poll();generation.current++;flight.resolve({data:[],error:null});await pending;assert.deepEqual(changes,[]);
});

const states=load(read('services/liveBattleSeriesState.ts'));
test('both authorized hosts get rematch availability while viewers get only the result',()=>{
  const p=projection({status:'completed',series});for(const actor of [A,B])assert.equal(states.deriveLiveBattleSeriesClientState(p,actor,'idle',null,false),'available');assert.equal(states.deriveLiveBattleSeriesClientState(p,'viewer','idle',null,false),'round_finished');
});
test('double rematch tap has one flight and one accepted next-round transition',async()=>{
  const flight=deferred(),single=new states.LiveBattleSeriesSingleFlight();let calls=0;const op=()=>{calls++;return flight.promise;};const first=single.run(op);assert.equal(single.run(op),null);await Promise.resolve();assert.equal(calls,1);flight.resolve();await first;const gate=new states.LiveBattleSeriesTransitionGate();const p=projection({status:'completed',series});const next={sourceBattleId:ID,seriesId:ID,battleId:'30000000-0000-4000-8000-000000000002',roundNumber:2};assert.equal(gate.accept(p,next),true);assert.equal(gate.accept(p,next),false);
});
test('reject and expiry are derived from authoritative decisions, never inferred as an accepted rematch',()=>{
  for(const status of ['rejected','expired']){const p=projection({status:'completed',series:{...series,status:'completed',rematchRequestId:ID,rematchRequestAfterBattleId:ID,rematchRequestStatus:status,rematchRequestedByUserId:A,rematchRequestExpiresAt:new Date(now).toISOString()}});assert.equal(states.deriveLiveBattleSeriesClientState(p,A,'idle',null,false),status);}
});

function stageHarness() {
  const timers=new Set(),effects=[];
  const element=(type,props,...children)=>typeof type==='function'?type({...props,children}):{type,props:props??{},children:children.flat(Infinity).filter(v=>v!==null&&v!==false&&v!==undefined)};
  const react={createElement:element,Fragment:'Fragment',useState:v=>[typeof v==='function'?v():v,()=>{}],useMemo:fn=>fn(),useEffect:fn=>effects.push(fn)};
  const spectator=load(read('services/liveBattleSpectatorService.ts'),{'@/template':{getSupabaseClient(){throw Error('No network in UI proof');}}});
  const theme=Object.fromEntries(['Colors','FontSize','FontWeight','Radius','Spacing'].map(k=>[k,new Proxy({},{get:()=>8})]));
  const rn={...Object.fromEntries(['ActivityIndicator','Image','Pressable','Text','View'].map(x=>[x,x])),StyleSheet:{create:x=>x,absoluteFillObject:{position:'absolute',top:0,bottom:0,left:0,right:0}}};
  const {LiveBattleStage}=load(read('components/live/LiveBattleStage.tsx'),{'react':react,'react-native':rn,'@expo/vector-icons':{MaterialIcons:'Icon'},'@/constants/theme':theme,'@/components/live/LiveBattleViewerHUD':{LiveBattleViewerHUD:props=>element('HUD',props)},'@/hooks/live/useRemoteVideoPresentationGrace':{useRemoteVideoPresentationGrace:surface=>surface},'@/services/liveBattleSpectatorService':spectator},{setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)});
  const state=projection({localBattleSide:'challenger',challengerScore:10,opponentScore:10,outcome:'tie',winnerUserId:null,challengerX2Window:null,opponentX2Window:null,challengerX3Window:null,opponentX3Window:null,scheduledStartAt:raw().scheduledStartAt,scheduledEndAt:raw().scheduledEndAt,challengerGloveUsesRemaining:1,opponentGloveUsesRemaining:1});
  const props={state,clockAnchor:anchor,localHost:{username:'A',avatarUrl:null},opponentHost:{username:'B',avatarUrl:null},localSurface:element('LocalVideo'),opponentSurface:null,actorUserId:A};
  return {props,timers,render:()=>LiveBattleStage(props),mountEffects:()=>effects.map(fn=>fn()).filter(Boolean),spectator};
}
function nodes(tree){return !tree||typeof tree!=='object'?[]:[tree,...(tree.children??[]).flatMap(nodes)];}
const textOf=tree=>nodes(tree).filter(n=>n.type==='Text').flatMap(n=>n.children).filter(v=>typeof v==='string').join(' ');
test('missing remote UID retains both panels and the authoritative countdown/active Stage',()=>{
  const h=stageHarness();for(const status of ['countdown','active']){h.props.state={...h.props.state,status};const tree=h.render();assert.equal(tree.props.pointerEvents,'box-none');assert.equal(nodes(tree).filter(n=>n.type==='LocalVideo').length,1);assert.ok(nodes(tree).some(n=>n.props.accessibilityLabel==='Rival conectando'));assert.equal(h.spectator.isLiveBattleStageStatus(status),true);}
});
test('clock expiry alone neither removes Stage nor fabricates a completed round',()=>{
  const h=stageHarness();h.props.state={...h.props.state,scheduledEndAt:new Date(now-10000).toISOString()};const tree=h.render();assert.ok(textOf(tree).includes('0:00'));assert.equal(h.props.state.status,'active');assert.ok(nodes(tree).some(n=>n.props.accessibilityLabel==='Rival conectando'));const cleanup=h.mountEffects();assert.equal(h.timers.size,1);cleanup.forEach(fn=>fn());assert.equal(h.timers.size,0);
});
test('post-round renders result and real rematch handler for both hosts with touch-safe ancestry',async()=>{
  for(const actor of [A,B]){const h=stageHarness();h.props.state={...h.props.state,status:'completed',series};h.props.actorUserId=actor;h.props.seriesClientState='available';let calls=0;h.props.onRequestRematch=async()=>{calls++;};const tree=h.render();const button=nodes(tree).find(n=>n.props.accessibilityLabel==='Solicitar revancha');assert.ok(button);assert.equal(button.props.disabled,false);assert.ok(textOf(tree).includes('EMPATE'));assert.equal(tree.props.pointerEvents,'box-none');assert.equal(tree.props.style.zIndex,3);button.props.onPress();await Promise.resolve();assert.equal(calls,1);function check(n,blocked=false){if(!n||typeof n!=='object')return;const next=blocked||n.props.pointerEvents==='none';if(n===button)assert.equal(next,false);(n.children??[]).forEach(c=>check(c,next));}check(tree);}
});
test('viewer result has no host rematch or glove controls and pending host request is disabled',()=>{
  const h=stageHarness();h.props.state={...h.props.state,status:'completed',series};h.props.viewerMode=true;h.props.actorUserId=null;assert.equal(nodes(h.render()).filter(n=>n.type==='Pressable').length,0);h.props.viewerMode=false;h.props.actorUserId=A;h.props.seriesClientState='available';h.props.seriesActionPending=true;assert.equal(nodes(h.render()).find(n=>n.props.accessibilityLabel==='Solicitar revancha').props.disabled,true);
});
test('unmounted controller ignores a late authority response and creates no relay or timers',async()=>{
  const h=harness(),flight=deferred();h.controller.discover=()=>flight.promise;h.controller.updateContext(context());await h.controller.dispose();flight.resolve([raw()]);await settle(h.controller);assert.equal(h.calls.start.length,0);assert.equal(h.timers.size,0);assert.equal(h.controller.getSnapshot().status,'disposed');
});
test('development runtime diagnostics abbreviate identifiers and are silent in production',async()=>{
  for(const dev of [false,true]){const logs=[];const C=load(read('services/liveBattleRuntimeController.ts'),{'./liveBattleService':service,'./liveBattlePostRoundRelayPolicy':policy},{__DEV__:dev,console:{info:(...a)=>logs.push(a)}}).LiveBattleRuntimeController;const h=harness();await h.controller.dispose();const c=new C({relay:h.relay,discover:async()=>[],reconcile:async()=>raw(),subscribe:()=>({unsubscribe:async()=>{}})});c.updateContext(context());await settle(c);await c.dispose();const output=JSON.stringify(logs);assert.equal(output.includes(S),false);assert.equal(output.includes(A),false);assert.equal(logs.length>0,dev);if(dev){assert.ok(output.includes('controller_created'));assert.ok(output.includes('eligibility_changed'));assert.ok(output.includes('controller_disposed'));}}
});
