import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
function load(source, imports={}, globals={}) {
  const module={exports:{}};
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  Function('require','module','exports',...Object.keys(globals),code)(n=>{assert.ok(n in imports,n);return imports[n];},module,module.exports,...Object.values(globals));return module.exports;
}
function extract(path,name,env) {
  const f=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true);let value;
  function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(f)===name)value=n.initializer;
    if(ts.isPropertyAssignment(n)&&n.name.getText(f)===name)value=n.initializer;ts.forEachChild(n,visit);}visit(f);
  assert.ok(value,name);return load('export const value='+value.getText(f),{},env).value;
}
const spectator=load(read('services/liveBattleSpectatorService.ts'),{'@/template':{}});
const completed={status:'completed',series:{status:'completed',version:3,rematchRequestStatus:'expired'}};
test('RED terminal authority removes the completed Stage for both screens',()=>{
  assert.equal(spectator.isLiveBattleStageStatus(completed.status,completed),false);
});
test('RED controlled relay update retains the expected remote surface on offline reason zero',()=>{
  let uids=[42];
  const offline=extract('hooks/useAgoraEngine.native.ts','onUserOffline',{
    logAgora(){},safeJoinKey:'safe',mountedRef:{current:true},isCurrentConnection:()=>true,
    remoteVideoTransitionRef:{current:{uid:42,pendingRemoval:false,deadline:Infinity}},
    setRemoteUids:fn=>{uids=fn(uids);},performance:{now:()=>0},
  });
  offline({},42,0);assert.deepEqual(uids,[42]);
});
const native={ChannelMediaRelayState:{RelayStateIdle:0,RelayStateConnecting:1,RelayStateRunning:2,RelayStateFailure:3},ChannelMediaRelayError:{RelayOk:0}};
class RelayError extends Error{constructor(code){super(code);this.code=code;}}
function relayHarness(){
  let clock=0,ttl=360,route='destination',uid=91,connected=3;
  const handlers=new Set(),calls=[],logs=[];
  const engine={registerEventHandler:h=>(handlers.add(h),true),unregisterEventHandler:h=>(handlers.delete(h),true),getConnectionState:()=>connected,startOrUpdateChannelMediaRelay:c=>(calls.push(c),0),stopChannelMediaRelay:()=>0};
  const C=load(read('services/liveBattleRelayService.native.ts'),{'react-native-agora':native,'./liveBattleRelayContract':{LiveBattleRelayError:RelayError}},{}).LiveBattleRelayService;
  const relay=new C(engine,{now:()=>clock,logger:(...v)=>logs.push(v),requestCredentials:async battleId=>({appId:'app',battleRelay:{battleId,expiresIn:ttl,source:{liveSessionId:'source',channel:'source',uid:0,token:'SECRET-SOURCE'},destination:{liveSessionId:route,channel:route,uid,token:'SECRET-DEST'}}})});
  const running=()=>{for(const h of handlers)h.onChannelMediaRelayStateChanged(2,0);};
  return {relay,calls,logs,handlers,running,set:v=>{clock=v.clock??clock;ttl=v.ttl??ttl;route=v.route??route;uid=v.uid??uid;connected=v.connected??connected;}};
}
test('RED freshly authorized same route reuses sufficient active credentials across logical Battles',async()=>{
  const h=relayHarness();try{await h.relay.start('battle-1');h.running();h.set({ttl:300});await h.relay.transition('battle-2');assert.equal(h.calls.length,1);assert.equal(h.relay.getSnapshot().battleId,'battle-2');assert.equal(h.relay.getSnapshot().state,'running');}finally{await h.relay.dispose();}
});

test('initial and duplicate starts have one SDK call and one native handler',async()=>{
  const h=relayHarness();try{await Promise.all([h.relay.start('one'),h.relay.start('one')]);h.running();await h.relay.start('one');assert.equal(h.calls.length,1);assert.equal(h.handlers.size,1);}finally{await h.relay.dispose();assert.equal(h.handlers.size,0);}
});
for(const [name,change] of [['channel',{route:'different'}],['uid',{uid:92}],['near expiry',{clock:350000}],['expired',{clock:361000}],['disconnected',{connected:4}]]){
  test(name+' requires native reauthorization',async()=>{const h=relayHarness();try{await h.relay.start('one');h.running();h.set({ttl:300,...change});await h.relay.transition('two');assert.equal(h.calls.length,2);}finally{await h.relay.dispose();}});
}
test('a reconnect followed by connected invalidates the previous credential reuse',async()=>{
  const h=relayHarness();try{await h.relay.start('one');h.running();for(const handler of h.handlers){handler.onConnectionStateChanged({},4);handler.onConnectionStateChanged({},3);}h.set({ttl:300});await h.relay.transition('two');assert.equal(h.calls.length,2);}finally{await h.relay.dispose();}
});
test('short post-round credentials cannot cover the next full round',async()=>{
  const h=relayHarness();try{h.set({ttl:45});await h.relay.start('one');h.running();h.set({ttl:318});await h.relay.transition('two');assert.equal(h.calls.length,2);}finally{await h.relay.dispose();}
});
test('a sufficient recent refresh avoids a second native reconfiguration on transition',async()=>{
  const h=relayHarness();try{h.set({ttl:15});await h.relay.start('one');h.running();h.set({ttl:360});await h.relay.refreshCredentials('one');h.running();h.set({ttl:300});await h.relay.transition('two');assert.equal(h.calls.length,2);assert.equal(h.relay.getSnapshot().state,'running');}finally{await h.relay.dispose();}
});
test('reuse does not reset the expiry or retain an obsolete logical callback',async()=>{
  const h=relayHarness();try{await h.relay.start('one');h.running();const old=[...h.handlers][0];h.set({ttl:300});await h.relay.transition('two');old.onChannelMediaRelayStateChanged(0,0);assert.equal(h.relay.getSnapshot().battleId,'two');h.running();h.set({ttl:300,clock:60000});await h.relay.transition('three');assert.equal(h.calls.length,2);}finally{await h.relay.dispose();}
});
test('relay development events never contain credentials or full canonical identifiers',async()=>{
  const h=relayHarness();try{await h.relay.start('12345678-1234-4321-8123-123456789abc');h.running();h.set({ttl:300});await h.relay.transition('87654321-1234-4321-8123-123456789def');const output=JSON.stringify(h.logs);assert.doesNotMatch(output,/SECRET|12345678-1234|87654321-1234/);assert.match(output,/transition_reused/);}finally{await h.relay.dispose();}
});

// Minimal React scheduler: the production hook owns all UID state and timers.
function hooks(){const slots=[];let cursor=0,pending=[];const changed=(a,b)=>!a||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));const react={
  useRef(v){const i=cursor++;return slots[i]??={current:v};},
  useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],n=>{slots[i]=typeof n==='function'?n(slots[i]):n;}];},
  useCallback(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))pending.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
};return{react,render(fn){cursor=0;pending=[];const value=fn();pending.forEach(f=>f());return value;},unmount(){slots.forEach(s=>s?.cleanup?.());}};}
async function videoHarness(){
  const runner=hooks(),timers=new Map(),listeners=new Set(),calls=[];let clock=0,sequence=0;
  const props={channelName:'session-a',uid:11,role:'publisher',profile:'live-broadcasting',liveSessionId:'session-a',liveRequestedRole:'host'};
  const engine=new Proxy({registerEventHandler:h=>(listeners.add(h),true),unregisterEventHandler:h=>(listeners.delete(h),true),getConnectionState:()=>3},{get:(o,k)=>o[k]??((...args)=>{calls.push([k,...args]);return 0;})});
  const globals={console:{log(){},info(){},error(){}},performance:{now:()=>clock},setTimeout:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const source=load(read('hooks/useAgoraEngine.native.ts'),{'react':runner.react,'react-native':{Platform:{OS:'android'}},'@/services/agoraService':{createAgoraRtcEngine:()=>engine,isAgoraAvailable:()=>true,fetchAgoraToken:async()=>({token:'test-only',appId:'app',channel:props.channelName,uid:11}),getAgoraAppId:()=>'',ChannelProfileType:{},ClientRoleType:{},ConnectionStateType:{ConnectionStateConnected:3,ConnectionStateReconnecting:4,ConnectionStateDisconnected:1,ConnectionStateFailed:5},AudioSessionOperationRestriction:{}},'@/services/callAudioControlService':{applyPendingAgoraCallMute(){},registerActiveCallAudioController:()=>()=>{}},'@/services/iosCallKitService':{}},globals);
  const render=()=>runner.render(()=>source.useAgoraEngine(props));
  let api=render();await api.join();const handler=[...listeners][0];assert.ok(handler);handler.onJoinChannelSuccess({localUid:11});handler.onUserJoined({},42);api=render();assert.deepEqual(api.remoteUids,[42]);
  return {render,props,handler,calls,timers,listeners,unmount:()=>runner.unmount(),advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}},grace:source.REMOTE_VIDEO_TRANSITION_GRACE_MS};
}
test('controlled offline/rejoin preserves the real hook UID and cancels all grace handles',async()=>{
  const h=await videoHarness();try{h.render().beginRemoteVideoTransition(42);h.handler.onUserOffline({},42,0);assert.deepEqual(h.render().remoteUids,[42]);h.advance(700);h.handler.onUserJoined({},42);assert.equal(h.timers.size,0);h.advance(5000);assert.deepEqual(h.render().remoteUids,[42]);}finally{h.unmount();}
});
test('a missing peer expires after exactly the bounded grace interval',async()=>{
  const h=await videoHarness();try{assert.equal(h.grace,1500);h.render().beginRemoteVideoTransition(42);h.handler.onUserOffline({},42,0);h.advance(1499);assert.deepEqual(h.render().remoteUids,[42]);h.advance(1);assert.deepEqual(h.render().remoteUids,[]);assert.equal(h.timers.size,0);}finally{h.unmount();}
});
test('duplicate transition signals cannot extend a missing peer indefinitely',async()=>{
  const h=await videoHarness();try{h.render().beginRemoteVideoTransition(42);h.handler.onUserOffline({},42,0);h.advance(1000);h.render().beginRemoteVideoTransition(42);h.advance(500);assert.deepEqual(h.render().remoteUids,[]);}finally{h.unmount();}
});
for(const [name,uid,reason,begin] of [['other UID',99,0,true],['real reason',42,1,true],['outside transition',42,0,false]]){
  test(name+' is removed immediately',async()=>{const h=await videoHarness();try{h.handler.onUserJoined({},uid);if(begin)h.render().beginRemoteVideoTransition(42);h.handler.onUserOffline({},uid,reason);assert.equal(h.render().remoteUids.includes(uid),false);}finally{h.unmount();assert.equal(h.timers.size,0);}});
}
test('terminal cleanup overrides grace without leaving or releasing the main LIVE',async()=>{
  const h=await videoHarness();try{h.render().beginRemoteVideoTransition(42);h.handler.onUserOffline({},42,0);const before=h.calls.length;h.render().clearRemoteVideoTransition(42);assert.equal(h.timers.size,0);assert.deepEqual(h.render().remoteUids,[]);assert.equal(h.render().joined,true);assert.equal(h.render().localVideoReady,true);assert.equal(h.calls.length,before);}finally{h.unmount();}
});
test('session change cancels grace and obsolete callbacks cannot remove a new peer',async()=>{
  const h=await videoHarness();try{h.render().beginRemoteVideoTransition(42);h.handler.onUserOffline({},42,0);const late=[...h.timers.values()][0].fn;h.props.channelName='session-b';h.props.liveSessionId='session-b';h.render();assert.equal(h.timers.size,0);await h.render().join();const next=[...h.listeners][0];next.onJoinChannelSuccess({localUid:11});next.onUserJoined({},42);late();h.handler.onUserOffline({},42,0);assert.deepEqual(h.render().remoteUids,[42]);}finally{h.unmount();}
});
test('unmount and engine release leave zero timer/listener handles',async()=>{
  const h=await videoHarness();h.render().beginRemoteVideoTransition(42);h.handler.onUserOffline({},42,0);h.unmount();assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
});
test('obsolete connection-state callbacks cannot clear a new session transition',async()=>{
  const h=await videoHarness();try{h.props.channelName='session-b';h.props.liveSessionId='session-b';h.render();await h.render().join();const next=[...h.listeners][0];next.onJoinChannelSuccess({localUid:11});next.onUserJoined({},42);h.render().beginRemoteVideoTransition(42);next.onUserOffline({},42,0);h.handler.onConnectionStateChanged({},4,0);assert.equal(h.timers.size,1);assert.deepEqual(h.render().remoteUids,[42]);next.onUserJoined({},42);assert.equal(h.timers.size,0);}finally{h.unmount();}
});

for(const status of ['awaiting_rematch','rematch_pending'])test(status+' stays visible while canonical authority permits it even at local zero',()=>{
  const state={status:'completed',series:{status,rematchRequestStatus:status==='rematch_pending'?'pending':null,rematchWindowExpiresAt:'2000-01-01',rematchRequestExpiresAt:'2000-01-01'}};
  assert.equal(spectator.isLiveBattleStageStatus(state.status,state),true);
});
for(const status of ['completed','cancelled'])test('series '+status+' hides the Stage',()=>{const state={...completed,series:{status}};assert.equal(spectator.isLiveBattleStageStatus(state.status,state),false);});
for(const status of ['expired','rejected','cancelled'])test('canonical request '+status+' hides the Stage',()=>{const state={...completed,series:{status:'rematch_pending',rematchRequestStatus:status}};assert.equal(spectator.isLiveBattleStageStatus(state.status,state),false);});
test('late completed-round projection cannot resurrect expired authority; a later Battle can start',()=>{
  const terminal={...completed,battleId:'old',projectionVersion:9,updatedAt:'2026-09-06T12:00:00Z'};
  const late={...terminal,projectionVersion:8,series:{status:'awaiting_rematch'}};
  const reduced=spectator.reduceLiveBattlePublicState(terminal,late);assert.equal(reduced,terminal);assert.equal(spectator.isLiveBattleStageStatus(reduced.status,reduced),false);
  const next={battleId:'new',status:'countdown',series:{status:'active'},projectionVersion:1,updatedAt:'2026-09-06T12:01:00Z'};
  assert.equal(spectator.reduceLiveBattlePublicState(terminal,next),next);assert.equal(spectator.isLiveBattleStageStatus(next.status,next),true);
});
test('both screen render gates execute the same authority-aware predicate',()=>{
  for(const screen of ['broadcast','watch']){
    const path=`app/live/${screen}/[streamId].tsx`;const file=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let initializer;
    function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(file)==='battleState')initializer=n.initializer;ts.forEachChild(n,visit);}visit(file);assert.ok(initializer);
    for(const state of [completed,{status:'active',series:null}]){
      const result=load('export const state='+initializer.getText(file),{},{battleProjection:{state},isLiveBattleStageStatus:spectator.isLiveBattleStageStatus}).state;
      assert.equal(result,state===completed?null:state);
    }
  }
});

test('the real relay signals the existing UID owner and terminal stop overrides reconfiguration',async()=>{
  const video=await videoHarness(),h=relayHarness();let stops=0;
  h.relay.engine.stopChannelMediaRelay=()=>{stops++;return 0;};
  h.relay.setVisualContinuityHandlers({onReconfigure:()=>video.render().beginRemoteVideoTransition(42),onStopped:()=>video.render().clearRemoteVideoTransition(42)});
  try{await h.relay.start('one');h.running();await h.relay.refreshCredentials('one');video.handler.onUserOffline({},42,0);assert.deepEqual(video.render().remoteUids,[42]);await Promise.all([h.relay.stop(),h.relay.stop()]);assert.equal(stops,1);assert.deepEqual(video.render().remoteUids,[]);assert.equal(video.timers.size,0);assert.equal(video.render().joined,true);}finally{await h.relay.dispose();video.unmount();}
});

const policy=load(read('services/liveBattlePostRoundRelayPolicy.ts'));
const IDs=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001'];
function runtimeHarness(){
  const [a,b,s,t,id]=IDs;let now=100000,sequence=0;const timers=new Map(),calls={start:0,stop:0,read:0};
  let battle={id,challengerUserId:a,opponentUserId:b,challengerSessionId:s,opponentSessionId:t,status:'active',version:3,endedAt:null,scheduledStartAt:new Date(99000).toISOString(),scheduledEndAt:new Date(110000).toISOString()};
  const series={id,format:'best_of_5',status:'awaiting_rematch',roundNumber:1,roundsCompleted:1,maxRounds:5,winsRequired:3,challengerWins:0,opponentWins:0,championUserId:null,version:2,rematchRequestStatus:null,rematchWindowExpiresAt:new Date(140000).toISOString()};
  let state={battleId:id,sessionId:s,localHostUserId:a,opponentHostUserId:b,opponentSessionId:t,projectionVersion:4,status:'completed',series};
  let snap={state:'idle',battleId:null};const listeners=new Set();const emit=v=>{snap=v;listeners.forEach(f=>f(v));};
  const relay={start:async()=>{calls.start++;emit({state:'running',battleId:id});},refreshCredentials:async()=>{},stop:async()=>{calls.stop++;emit({state:'idle',battleId:null});},stopImmediately(){},dispose:async()=>{},getSnapshot:()=>snap,subscribe:f=>(listeners.add(f),()=>listeners.delete(f))};
  const C=load(read('services/liveBattleRuntimeController.ts'),{'./liveBattleService':{isLiveBattleUuid:()=>true},'./liveBattlePostRoundRelayPolicy':policy}).LiveBattleRuntimeController;
  const controller=new C({relay,now:()=>now,monotonicNow:()=>now,discover:async()=>[battle],reconcile:async()=>battle,subscribe:()=>({unsubscribe:async()=>{}}),
    readPublicAuthority:async()=>{calls.read++;return {state,serverNow:new Date(now).toISOString(),clockAnchor:{serverEpochMsAtAnchor:now,monotonicMsAtAnchor:now}};},
    validateSessionPair:async()=>({localSessionId:s,opponentSessionId:t,localHostUserId:a,opponentHostUserId:b,localSessionLive:true,opponentSessionLive:true}),
    setTimer:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id),
  });
  return {controller,calls,timers, get state(){return state;},activate:async()=>{controller.updateContext({liveSessionId:s,hostUserId:a,isCanonicalHost:true,isSessionLive:true,isOpponentSessionLive:true,engineReady:true,joined:true,isForeground:true});await controller.waitForIdle();},complete:async()=>{battle={...battle,status:'completed',version:4,endedAt:new Date(110000).toISOString()};now=110000;await controller.applyAuthoritativeBattle(battle);},expire:()=>{now=140001;state={...state,projectionVersion:5,series:{...series,status:'completed',version:3,rematchRequestStatus:'expired'}};}};
}
test('deadline only requests authority; terminal series stops once, advances UI authority key and cancels timers',async()=>{
  const h=runtimeHarness();try{await h.activate();await h.complete();const key=h.controller.getSnapshot().publicAuthorityKey;assert.equal(h.calls.stop,0);assert.equal(spectator.isLiveBattleStageStatus(h.state.status,h.state),true);assert.equal(h.timers.size,1);
    h.expire();assert.equal(h.calls.stop,0);const timer=[...h.timers.values()][0];h.timers.clear();timer.fn();await h.controller.waitForIdle();assert.equal(h.calls.stop,1);assert.notEqual(h.controller.getSnapshot().publicAuthorityKey,key);assert.equal(spectator.isLiveBattleStageStatus(h.state.status,h.state),false);await h.controller.reconcileNow();assert.equal(h.calls.stop,1);assert.equal(h.timers.size,0);
  }finally{await h.controller.dispose();}
});
test('series-only authority change refreshes the existing public projection without recreating runtime',async()=>{
  const runner=hooks();let publish,reconciles=0,created=0;const engine={};const guards=new Set();
  class C{constructor(){created++;}subscribe(f){publish=f;return()=>{};}updateContext(){}updatePublicAuthority(){}dispose(){} }
  const hook=load(read('hooks/live/useLiveBattleRelayRuntime.native.ts'),{'react':runner.react,'@/services/liveBattleRelayService':{LiveBattleRelayService:class{}},'@/services/liveBattleRuntimeController':{LiveBattleRuntimeController:C},'@/services/liveBattleService':{},'@/services/liveBattleSpectatorService':{}}).useLiveBattleRelayRuntime;
  const props={joined:true,getEngine:()=>engine,registerBeforeEngineRelease:f=>(guards.add(f),()=>guards.delete(f)),reconnectEpoch:0,reconcilePublicAuthority:async()=>{reconciles++;}};
  try{runner.render(()=>hook(props));const snapshot={battleId:IDs[4],version:4,status:'relaying',battle:{status:'completed'},publicAuthorityKey:'series:2'};publish(snapshot);runner.render(()=>hook(props));await Promise.resolve();assert.equal(reconciles,1);publish({...snapshot,publicAuthorityKey:'series:3'});runner.render(()=>hook(props));await Promise.resolve();assert.equal(reconciles,2);assert.equal(created,1);assert.equal(guards.size,1);runner.render(()=>hook(props));assert.equal(reconciles,2);}finally{runner.unmount();assert.equal(guards.size,0);}
});
test('existing rematch single-flight and transition gate reject duplicate taps and duplicate next rounds',async()=>{
  const states=load(read('services/liveBattleSeriesState.ts'));const flight=new states.LiveBattleSeriesSingleFlight();let resolve,calls=0;const operation=()=>{calls++;return new Promise(r=>{resolve=r;});};const first=flight.run(operation);assert.equal(flight.run(operation),null);await Promise.resolve();assert.equal(calls,1);resolve();await first;
  const gate=new states.LiveBattleSeriesTransitionGate(),state={battleId:IDs[4],series:{id:IDs[4],roundNumber:1,maxRounds:5}},next={sourceBattleId:IDs[4],seriesId:IDs[4],battleId:IDs[3],roundNumber:2};assert.equal(gate.accept(state,next),true);assert.equal(gate.accept(state,next),false);
});

test('stop cancels an authorization in flight; its late result cannot revive relay or visual grace',async()=>{
  const h=relayHarness();let resolve,reconfigures=0;h.relay.setVisualContinuityHandlers({onReconfigure:()=>reconfigures++});
  try{await h.relay.start('one');h.running();const authorize=h.relay.requestCredentials;h.relay.requestCredentials=()=>new Promise(r=>{resolve=r;});const transition=h.relay.transition('two');const rejection=assert.rejects(transition);await Promise.resolve();const stop=h.relay.stop();resolve(await authorize('two'));await rejection;await stop;assert.equal(h.calls.length,1);assert.equal(reconfigures,0);assert.equal(h.relay.getSnapshot().state,'idle');assert.equal(h.handlers.size,0);}finally{await h.relay.dispose();}
});
test('SDK failure while awaiting new authority prevents reuse of the previously running route',async()=>{
  const h=relayHarness();let resolve;try{await h.relay.start('one');h.running();h.set({ttl:300});const authorize=h.relay.requestCredentials;h.relay.requestCredentials=()=>new Promise(r=>{resolve=r;});const pending=h.relay.transition('two');await Promise.resolve();[...h.handlers][0].onChannelMediaRelayStateChanged(3,8);resolve(await authorize('two'));await pending;assert.equal(h.calls.length,2);assert.equal(h.relay.getSnapshot().state,'connecting');}finally{await h.relay.dispose();}
});
test('a throwing SDK update stops the previous transport and invalidates visual retention',async()=>{
  const h=relayHarness();let stops=0,clears=0;h.relay.setVisualContinuityHandlers({onStopped:()=>clears++});
  try{await h.relay.start('one');h.running();h.relay.engine.startOrUpdateChannelMediaRelay=()=>{throw Error('test SDK failure');};h.relay.engine.stopChannelMediaRelay=()=>{stops++;return 0;};await assert.rejects(h.relay.transition('two'));assert.equal(stops,1);assert.equal(h.handlers.size,0);assert.equal(h.relay.getSnapshot().state,'failed');assert.ok(clears>0);}finally{await h.relay.dispose();}
});
test('terminal host/viewer render branches contain only the ordinary LIVE surface',()=>{
  for(const screen of ['broadcast','watch']){const path=`app/live/${screen}/[streamId].tsx`,f=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression;
    function visit(n){if(ts.isConditionalExpression(n)&&n.condition.getText(f)==='battleState'&&n.whenTrue.getText(f).includes('<LiveBattleStage'))expression=n;ts.forEachChild(n,visit);}visit(f);assert.ok(expression);
    const tree=load('export const tree='+expression.getText(f),{},{React:{createElement:(type,props,...children)=>({type,props,children})},battleState:null,RtcSurfaceView:'NativeVideo',localVideoReady:true,isCameraOff:false,remoteUid:11,styles:{videoStream:'normal'}}).tree;
    assert.equal(tree.type,'NativeVideo');assert.equal(tree.props.style,'normal');assert.equal(tree.props.canvas.uid,screen==='broadcast'?0:11);assert.deepEqual(tree.children,[]);
  }
});
test('terminal null projection clears the last canonical rival without allowing old owners to touch a new session',()=>{
  const runner=hooks(),cleared=[];let handlers;const engine={};
  class Relay{setVisualContinuityHandlers(value){handlers=value;}}
  class Controller{subscribe(){return()=>{};}updateContext(){}updatePublicAuthority(){}dispose(){handlers.onStopped();}}
  const hook=load(read('hooks/live/useLiveBattleRelayRuntime.native.ts'),{'react':runner.react,'@/services/liveBattleRelayService':{LiveBattleRelayService:Relay},'@/services/liveBattleRuntimeController':{LiveBattleRuntimeController:Controller},'@/services/liveBattleService':{},'@/services/liveBattleSpectatorService':{}}).useLiveBattleRelayRuntime;
  const props={liveSessionId:'session-a',joined:true,getEngine:()=>engine,registerBeforeEngineRelease:()=>()=>{},reconnectEpoch:0,publicBattleState:{opponentHostAgoraUid:42},clearRemoteVideoTransition:uid=>cleared.push(uid)};
  try{runner.render(()=>hook(props));props.publicBattleState=null;runner.render(()=>hook(props));handlers.onStopped();assert.deepEqual(cleared,[42]);props.liveSessionId='session-b';props.publicBattleState={opponentHostAgoraUid:99};runner.render(()=>hook(props));handlers.onStopped();assert.deepEqual(cleared,[42]);}finally{runner.unmount();assert.deepEqual(cleared,[42]);}
});
