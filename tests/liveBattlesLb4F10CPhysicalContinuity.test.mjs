import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
function load(source, imports={}, globals={}) {
  const module={exports:{}};
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  Function('require','module','exports',...Object.keys(globals),code)(n=>{assert.ok(n in imports,n);return imports[n];},module,module.exports,...Object.values(globals));return module.exports;
}
function hooks(){const slots=[];let cursor=0,pending=[];const changed=(a,b)=>!a||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));const react={
  useRef(v){const i=cursor++;return slots[i]??={current:v};},
  useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],n=>{slots[i]=typeof n==='function'?n(slots[i]):n;}];},
  useCallback(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},
  useEffect(fn,deps){const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))pending.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
};return{react,render(fn){cursor=0;pending=[];const value=fn();pending.forEach(f=>f());return value;},unmount(){slots.forEach(s=>s?.cleanup?.());}};}
async function videoHarness(authority){
  const runner=hooks(),timers=new Map(),listeners=new Set(),calls=[],logs=[];let clock=0,sequence=0;
  const props={remoteVideoAuthority:authority,channelName:'session-a',uid:11,role:'publisher',profile:'live-broadcasting',liveSessionId:'session-a',liveRequestedRole:'host'};
  const engine=new Proxy({registerEventHandler:h=>(listeners.add(h),true),unregisterEventHandler:h=>(listeners.delete(h),true),getConnectionState:()=>3},{get:(o,k)=>o[k]??((...args)=>{calls.push([k,...args]);return 0;})});
  const globals={__DEV__:true,console:{log(){},info:(...args)=>logs.push(args),error(){}},performance:{now:()=>clock},setTimeout:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const source=load(read('hooks/useAgoraEngine.native.ts'),{'react':runner.react,'react-native':{Platform:{OS:'android'}},'@/services/agoraService':{createAgoraRtcEngine:()=>engine,isAgoraAvailable:()=>true,fetchAgoraToken:async()=>({token:'test-only',appId:'app',channel:props.channelName,uid:11}),getAgoraAppId:()=>'',ChannelProfileType:{},ClientRoleType:{},ConnectionStateType:{ConnectionStateConnected:3,ConnectionStateReconnecting:4,ConnectionStateDisconnected:1,ConnectionStateFailed:5},AudioSessionOperationRestriction:{}},'@/services/callAudioControlService':{applyPendingAgoraCallMute(){},registerActiveCallAudioController:()=>()=>{}},'@/services/iosCallKitService':{}},globals);
  const render=()=>runner.render(()=>source.useAgoraEngine(props));
  let api=render();await api.join();const handler=[...listeners][0];assert.ok(handler);handler.onJoinChannelSuccess({localUid:11});handler.onUserJoined({},42);api=render();assert.deepEqual(api.remoteUids,[42]);
  return {render,props,handler,calls,timers,listeners,logs,unmount:()=>runner.unmount(),advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}},grace:source.REMOTE_VIDEO_TRANSITION_GRACE_MS};
}
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
const spectator=load(read('services/liveBattleSpectatorService.ts'),{'@/template':{}});
test('incoming peer refresh retains the visible UID even without a local outgoing update',async()=>{
  const h=await videoHarness({scopeKey:'session-a:battle-a',remoteUid:42});
  try{h.handler.onUserOffline({},42,0);assert.deepEqual(h.render().remoteUids,[42]);h.advance(700);h.handler.onUserJoined({},42);assert.deepEqual(h.render().remoteUids,[42]);assert.equal(h.timers.size,0);}finally{h.unmount();}
});
test('validated stop_terminal hides Stage before stopping relay while public authority still awaits rematch',async()=>{
  const h=runtimeHarness();let suppressed=null,visibleAtStop;
  h.controller.dependencies.onTerminalAuthority=id=>{suppressed=id;};
  const stop=h.controller.dependencies.relay.stop;
  h.controller.dependencies.relay.stop=async()=>{visibleAtStop=spectator.isLiveBattleStageStatus(h.state.status,h.state,suppressed);await stop();};
  try{await h.activate();await h.complete();h.expire();h.state.series.status='awaiting_rematch';h.state.series.rematchRequestStatus=null;await h.controller.reconcileNow();assert.equal(visibleAtStop,false);assert.equal(suppressed,h.state.battleId);}finally{await h.controller.dispose();}
});

test('an incoming update after the local grace expired still gets its own bounded retention',async()=>{
  const h=await videoHarness({scopeKey:'session-a:battle-a',remoteUid:42});try{h.render().beginRemoteVideoTransition(42);h.advance(1600);assert.equal(h.timers.size,0);h.handler.onUserOffline({},42,0);assert.deepEqual(h.render().remoteUids,[42]);h.advance(700);h.handler.onUserJoined({},42);assert.deepEqual(h.render().remoteUids,[42]);assert.equal(h.timers.size,0);}finally{h.unmount();}
});
test('incoming grace expires without reconnection and duplicate offlines cannot extend it',async()=>{
  const h=await videoHarness({scopeKey:'session-a:battle-a',remoteUid:42});try{h.handler.onUserOffline({},42,0);h.advance(1000);h.handler.onUserOffline({},42,0);h.advance(499);assert.deepEqual(h.render().remoteUids,[42]);h.advance(1);assert.deepEqual(h.render().remoteUids,[]);assert.equal(h.timers.size,0);}finally{h.unmount();}
});
test('other UIDs and non-transient reasons are not hidden by Battle authority',async()=>{
  const h=await videoHarness({scopeKey:'session-a:battle-a',remoteUid:42});try{h.handler.onUserJoined({},99);h.handler.onUserOffline({},99,0);assert.deepEqual(h.render().remoteUids,[42]);h.handler.onUserOffline({},42,1);assert.deepEqual(h.render().remoteUids,[]);assert.equal(h.timers.size,0);}finally{h.unmount();}
});
test('changing the canonical peer clears retention and never preserves the old surface',async()=>{
  const h=await videoHarness({scopeKey:'session-a:battle-a',remoteUid:42});try{h.handler.onUserOffline({},42,0);const old=[...h.timers.values()][0].fn;h.props.remoteVideoAuthority={scopeKey:'session-a:battle-b',remoteUid:99};h.render();assert.deepEqual(h.render().remoteUids,[]);assert.equal(h.timers.size,0);h.handler.onUserJoined({},99);old();assert.deepEqual(h.render().remoteUids,[99]);}finally{h.unmount();}
});
test('same-peer next round retains the surface but cancels callbacks belonging to the previous round',async()=>{
  const h=await videoHarness({scopeKey:'session-a:battle-a',remoteUid:42});try{h.handler.onUserOffline({},42,0);const old=[...h.timers.values()][0].fn;h.props.remoteVideoAuthority={scopeKey:'session-a:battle-b',remoteUid:42};h.render();old();assert.deepEqual(h.render().remoteUids,[42]);assert.equal(h.timers.size,1);h.handler.onUserJoined({},42);assert.equal(h.timers.size,0);}finally{h.unmount();}
});
test('five independently timed rematches do not accumulate timers/listeners or lose the visible UID',async()=>{
  const h=await videoHarness({scopeKey:'session-a:round-1',remoteUid:42});try{for(let round=1;round<=5;round++){h.props.remoteVideoAuthority={scopeKey:`session-a:round-${round}`,remoteUid:42};h.render();h.advance(1700);h.handler.onUserOffline({},42,0);assert.deepEqual(h.render().remoteUids,[42]);h.advance(500);h.handler.onUserJoined({},42);assert.equal(h.timers.size,0);assert.equal(h.listeners.size,1);assert.deepEqual(h.render().remoteUids,[42]);}}finally{h.unmount();assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);}
});
test('terminal authority clears incoming retention without leaving LIVE or changing capture',async()=>{
  const h=await videoHarness({scopeKey:'session-a:battle-a',remoteUid:42});try{h.handler.onUserOffline({},42,0);const count=h.calls.length;h.props.remoteVideoAuthority=null;h.render();assert.deepEqual(h.render().remoteUids,[]);assert.equal(h.timers.size,0);assert.equal(h.render().joined,true);assert.equal(h.render().localVideoReady,true);assert.equal(h.render().isMuted,false);assert.equal(h.props.channelName,'session-a');assert.equal(h.calls.length,count);}finally{h.unmount();}
});

function screenAuthority(screen,state,terminalBattleId=null){
  const path=`app/live/${screen}/[streamId].tsx`,f=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let value;
  function visit(n){if(ts.isPropertyAssignment(n)&&n.name.getText(f)==='remoteVideoAuthority')value=n.initializer;ts.forEachChild(n,visit);}visit(f);assert.ok(value,'screen must wire incoming authority');
  return load('export const value='+value.getText(f),{},{battleProjection:{state,terminalBattleId},getLiveBattleVideoAuthority:spectator.getLiveBattleVideoAuthority}).value;
}
function renderedStage(screen,state,uids){
  const path=`app/live/${screen}/[streamId].tsx`,f=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let stage;
  function visit(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(f)==='LiveBattleStage')stage=n;ts.forEachChild(n,visit);}visit(f);assert.ok(stage);
  const element=(type,props,...children)=>typeof type==='function'?type({...props,children}):{type,props:props??{},children:children.flat(Infinity).filter(v=>v!==null&&v!==false&&v!==undefined)};
  const react={createElement:element,Fragment:'Fragment',useState:v=>[typeof v==='function'?v():v,()=>{}],useMemo:fn=>fn(),useEffect(){}};
  const rn={...Object.fromEntries(['ActivityIndicator','Image','Pressable','Text','View'].map(x=>[x,x])),StyleSheet:{create:x=>x,absoluteFillObject:{}}};
  const theme=Object.fromEntries(['Colors','FontSize','FontWeight','Radius','Spacing'].map(k=>[k,new Proxy({},{get:()=>8})]));
  const Stage=load(read('components/live/LiveBattleStage.tsx'),{'react':react,'react-native':rn,'@expo/vector-icons':{MaterialIcons:'Icon'},'@/constants/theme':theme,'@/components/live/LiveBattleViewerHUD':{LiveBattleViewerHUD:()=>null},'@/hooks/live/useRemoteVideoPresentationGrace':{useRemoteVideoPresentationGrace:surface=>surface},'@/services/liveBattleSpectatorService':spectator}).LiveBattleStage;
  const props={React:react,LiveBattleStage:Stage,battleState:state,battleProjection:{clockAnchor:null,clientState:'available'},insets:{top:0},user:{id:'host',username:'host'},session:{hostUsername:'host'},RtcSurfaceView:'NativeVideo',localVideoReady:true,isCameraOff:false,remoteUids:uids,styles:{battleVideo:{}},glovePending:false,gloveError:null,handleActivateBattleGlove(){}};
  return load('export const tree='+stage.getText(f),{},props).tree;
}
const nodes=t=>!t||typeof t!=='object'?[]:[t,...(t.children??[]).flatMap(nodes)];
for(const screen of ['broadcast','watch'])test(screen+' wires the authoritative incoming UID to the actual Stage surface without Conectando',async()=>{
  const state={sessionId:'session-a',battleId:'battle-a',status:'completed',localHostUserId:'host',opponentHostUserId:'peer',localHostAgoraUid:11,opponentHostAgoraUid:42,localBattleSide:'challenger',challengerScore:1,opponentScore:1,outcome:'tie',series:{status:'awaiting_rematch'}};
  const h=await videoHarness(screenAuthority(screen,state));try{h.handler.onUserJoined({},11);const assertSurface=()=>{const tree=renderedStage(screen,state,h.render().remoteUids);assert.ok(nodes(tree).some(n=>n.type==='NativeVideo'&&n.props.canvas.uid===42));assert.equal(nodes(tree).some(n=>n.props.accessibilityLabel==='Rival conectando'),false);};assertSurface();h.handler.onUserOffline({},42,0);assertSurface();h.advance(700);h.handler.onUserJoined({},42);assertSurface();assert.equal(screenAuthority(screen,state,'battle-a'),null);}finally{h.unmount();}
});

function projectionHarness(runtimeManaged=false){
  const runner=hooks(),timers=new Map(),calls={subscribe:0,unsubscribe:0,reconcile:0};let clock=0,sequence=0,callbacks,reply;
  runner.react.useMemo=(fn,deps)=>runner.react.useCallback(fn,deps)();
  const globals={__DEV__:false,performance:{now:()=>clock},setTimeout:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const states=load(read('services/liveBattleSeriesState.ts'));
  const props={sessionId:IDs[2],enabled:true};
  const emit=(state,epoch)=>{callbacks.anchor({serverEpochMsAtAnchor:epoch,monotonicMsAtAnchor:clock,roundTripMs:0});callbacks.change(state);};
  const hook=load(read('hooks/live/useLiveBattleSpectatorState.ts'),{
    'react':runner.react,'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'@react-native-community/netinfo':{addEventListener:()=>()=>{}},'expo-crypto':{randomUUID:()=>IDs[4]},
    '@/services/liveBattlePostRoundRelayPolicy':policy,
    '@/services/liveBattleSpectatorService':{getLiveBattlePostRoundDeadline:spectator.getLiveBattlePostRoundDeadline,isLiveBattleStageStatus:spectator.isLiveBattleStageStatus,subscribeToLiveBattlePublicState:(_id,change,error,anchor)=>{calls.subscribe++;callbacks={change,error,anchor};return{reconcile:async()=>{calls.reconcile++;if(reply)emit(reply.state,reply.epoch);},unsubscribe:async()=>{calls.unsubscribe++;}};}},
    '@/services/liveBattleService':{getLiveBattlePublicProfiles:async()=>[]},'@/services/liveBattleSeriesState':states,'@/services/liveBattleSeriesService':{safeLiveBattleSeriesErrorMessage:()=>null,LiveBattleSeriesServiceError:class extends Error{}},
  },globals).useLiveBattleSpectatorState;
  const render=()=>runner.render(()=>hook(props.sessionId,props.enabled,'viewer',runtimeManaged));render();
  const state={battleId:IDs[4],sessionId:IDs[2],localHostUserId:IDs[0],opponentHostUserId:IDs[1],status:'completed',series:{id:IDs[4],format:'best_of_5',status:'awaiting_rematch',version:2,roundNumber:1,maxRounds:5,rematchRequestStatus:null,rematchWindowExpiresAt:new Date(110000).toISOString()}};
  emit(state,100000);render();
  return {state,props,calls,timers,render,emit,get callbacks(){return callbacks;},setReply:(s,epoch)=>{reply={state:s,epoch};},advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}},unmount:()=>runner.unmount()};
}
test('watcher deadline reconciles once and closes using fresh server time despite awaiting_rematch projection',async()=>{
  const h=projectionHarness();try{h.setReply(h.state,110025);h.advance(10025);h.render().checkDecisionDeadline(110025);await Promise.resolve();const p=h.render();assert.equal(h.calls.reconcile,1);assert.equal(p.terminalBattleId,h.state.battleId);assert.equal(spectator.isLiveBattleStageStatus(p.state.status,p.state,p.terminalBattleId),false);assert.equal(h.timers.size,0);assert.equal(h.calls.subscribe,1);}finally{h.unmount();assert.equal(h.calls.unsubscribe,1);}
});
test('local deadline alone cannot close Stage when returned server authority is still before expiry',async()=>{
  const h=projectionHarness();try{h.setReply(h.state,109000);h.advance(10025);h.render().checkDecisionDeadline(110025);await Promise.resolve();const p=h.render();assert.equal(h.calls.reconcile,1);assert.equal(p.terminalBattleId,null);assert.equal(spectator.isLiveBattleStageStatus(p.state.status,p.state,p.terminalBattleId),true);}finally{h.unmount();assert.equal(h.timers.size,0);}
});
test('host reuses the runtime scheduler and confirmed suppression survives stale and null projections',()=>{
  const h=projectionHarness(true);try{assert.equal(h.timers.size,0);h.render().confirmTerminalBattle(h.state.battleId);h.emit(h.state,100000);let p=h.render();assert.equal(spectator.isLiveBattleStageStatus(p.state.status,p.state,p.terminalBattleId),false);h.emit(null,100000);h.render();h.emit(h.state,100000);p=h.render();assert.equal(p.terminalBattleId,h.state.battleId);assert.equal(h.calls.subscribe,1);}finally{h.unmount();}
});
test('only a valid new Battle clears suppression; stale terminal callbacks cannot suppress it',()=>{
  const h=projectionHarness(true);try{const old=h.render().confirmTerminalBattle;old(h.state.battleId);const next={...h.state,battleId:IDs[3],status:'countdown',series:{...h.state.series,status:'active',version:3,roundNumber:2}};h.emit(next,100000);old(h.state.battleId);const p=h.render();assert.equal(p.terminalBattleId,null);assert.equal(spectator.isLiveBattleStageStatus(p.state.status,p.state,p.terminalBattleId),true);}finally{h.unmount();}
});
test('pending request expiry is confirmed by server timestamp, and null clock cannot fabricate expiry',()=>{
  const h=projectionHarness();try{const pending={...h.state,series:{...h.state.series,status:'rematch_pending',rematchRequestStatus:'pending',rematchRequestExpiresAt:new Date(105000).toISOString()}};h.emit(pending,104999);assert.equal(h.render().terminalBattleId,null);h.callbacks.anchor(null);assert.equal(h.render().terminalBattleId,null);h.emit(pending,105000);assert.equal(h.render().terminalBattleId,h.state.battleId);assert.equal(h.timers.size,0);}finally{h.unmount();}
});
test('projection cleanup cancels deadline and ignores old subscription callbacks',()=>{
  const h=projectionHarness();const old=h.callbacks;h.unmount();old.anchor({serverEpochMsAtAnchor:999999,monotonicMsAtAnchor:0});old.change(h.state);assert.equal(h.timers.size,0);assert.equal(h.calls.unsubscribe,1);
});
test('the shared deadline always respects the earlier canonical window or request',()=>{
  const s={series:{status:'rematch_pending',rematchRequestStatus:'pending',rematchWindowExpiresAt:'2026-09-06T12:00:00Z',rematchRequestExpiresAt:'2026-09-06T12:00:15Z'}};assert.equal(policy.getLiveBattleRelayDecisionDeadline(s),s.series.rematchWindowExpiresAt);
});
test('video diagnostics expose the real incoming UID and bounded lifecycle without full identifiers or tokens',async()=>{
  const h=await videoHarness({scopeKey:`${IDs[2]}:${IDs[4]}`,remoteUid:42});try{h.handler.onUserOffline({},42,0);h.advance(700);h.handler.onUserJoined({},42);h.handler.onUserOffline({},42,0);h.advance(1500);const logs=JSON.stringify(h.logs);for(const name of ['transition_begin','offline_deferred','transition_join_cancel','transition_expired','transition_clear'])assert.ok(logs.includes('[LIVE-BATTLE-VIDEO] '+name),name);assert.ok(h.logs.some(([event,data])=>event.endsWith('offline_deferred')&&data.uid===42&&data.reason==='incoming_peer'));assert.equal(logs.includes(IDs[2]),false);assert.equal(logs.includes(IDs[4]),false);assert.doesNotMatch(logs,/test-only|token|credential/i);}finally{h.unmount();}
});
test('disabling and re-enabling the same session subscription cannot resurrect its terminated Battle',()=>{
  const h=projectionHarness(true);try{h.render().confirmTerminalBattle(h.state.battleId);h.props.enabled=false;h.render();h.props.enabled=true;h.render();h.emit(h.state,100000);const p=h.render();assert.equal(p.terminalBattleId,h.state.battleId);assert.equal(spectator.isLiveBattleStageStatus(p.state.status,p.state,p.terminalBattleId),false);}finally{h.unmount();}
});
test('transport or authority read failure alone never fabricates a terminal Battle decision',async()=>{
  const h=runtimeHarness();let terminal=0;h.controller.dependencies.onTerminalAuthority=()=>terminal++;try{await h.activate();await h.complete();h.controller.dependencies.readPublicAuthority=async()=>{throw Error('test unavailable');};await h.controller.reconcileNow();assert.equal(terminal,0);}finally{await h.controller.dispose();}
});
test('native runtime connects terminal authority to the current UI owner and blocks obsolete-session callbacks',()=>{
  const runner=hooks();let dependency;const closed=[];class Controller{constructor(d){dependency=d;}subscribe(){return()=>{};}updateContext(){}updatePublicAuthority(){}dispose(){}}
  const hook=load(read('hooks/live/useLiveBattleRelayRuntime.native.ts'),{'react':runner.react,'@/services/liveBattleRelayService':{LiveBattleRelayService:class{}},'@/services/liveBattleRuntimeController':{LiveBattleRuntimeController:Controller},'@/services/liveBattleService':{},'@/services/liveBattleSeriesService':{},'@/services/liveBattleSpectatorService':{}}).useLiveBattleRelayRuntime;
  const engine={},props={liveSessionId:IDs[2],joined:true,getEngine:()=>engine,registerBeforeEngineRelease:()=>()=>{},reconnectEpoch:0,confirmTerminalBattle:id=>closed.push(id)};
  try{runner.render(()=>hook(props));dependency.onTerminalAuthority(IDs[4]);assert.deepEqual(closed,[IDs[4]]);props.liveSessionId=IDs[3];runner.render(()=>hook(props));dependency.onTerminalAuthority(IDs[4]);assert.deepEqual(closed,[IDs[4]]);}finally{runner.unmount();dependency.onTerminalAuthority(IDs[4]);assert.deepEqual(closed,[IDs[4]]);}
});

test('same-peer round change still expires a pending disconnect without a rejoin',async()=>{
  const h=await videoHarness({scopeKey:'session-a:battle-a',remoteUid:42});try{h.handler.onUserOffline({},42,0);h.props.remoteVideoAuthority={scopeKey:'session-a:battle-b',remoteUid:42};h.render();h.advance(1500);assert.deepEqual(h.render().remoteUids,[]);assert.equal(h.timers.size,0);}finally{h.unmount();}
});
test('the existing Stage clock signals projection reconciliation through both screen callbacks',()=>{
  const path='components/live/LiveBattleStage.tsx',f=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(f)==='useEffect'&&n.arguments[0]?.getText(f).includes('onDecisionClockTick'))effect=n.arguments[0];ts.forEachChild(n,visit);}visit(f);assert.ok(effect);
  for(const screen of ['broadcast','watch']){const source=read(`app/live/${screen}/[streamId].tsx`),sf=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback;function find(n){if(ts.isJsxAttribute(n)&&n.name.getText(sf)==='onDecisionClockTick')callback=n.initializer.expression;ts.forEachChild(n,find);}find(sf);assert.ok(callback);const values=[];const fn=load('export const callback='+callback.getText(sf),{},{battleProjection:{checkDecisionDeadline:v=>values.push(v)}}).callback;load('export const effect='+effect.getText(f),{},{onDecisionClockTick:fn,serverNow:110025}).effect();assert.deepEqual(values,[110025]);}
});

test('validated terminal authority during a null projection prevents its delayed remount',()=>{
  const h=projectionHarness(true);try{h.emit(null,100000);h.render().confirmTerminalBattle(h.state.battleId);h.emit(h.state,100000);const p=h.render();assert.equal(p.terminalBattleId,h.state.battleId);assert.equal(spectator.isLiveBattleStageStatus(p.state.status,p.state,p.terminalBattleId),false);}finally{h.unmount();}
});

test('half-RTT visual clock compensation cannot prematurely confirm terminal authority',()=>{
  const h=projectionHarness();try{h.callbacks.anchor({serverEpochMsAtAnchor:110050,monotonicMsAtAnchor:0,roundTripMs:200});assert.equal(h.render().terminalBattleId,null);h.callbacks.anchor({serverEpochMsAtAnchor:110100,monotonicMsAtAnchor:0,roundTripMs:200});assert.equal(h.render().terminalBattleId,h.state.battleId);}finally{h.unmount();}
});
