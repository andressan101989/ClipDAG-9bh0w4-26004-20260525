import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { verifyHermeticMigrationWorkspace, verifyHermeticMigrationManifest, verifyHermeticGitSource } from './nelyon-b2-hermetic-workspace.mjs';
import { verifyMigrationDryRun, executeB2ProtectedMutation, verifyB2ProtectedReleaseMutation } from './nelyon-production-release.mjs';
import {
  beginB2FunctionDeploymentAttempt,
  b2FunctionManifestSha256,
  createB2FunctionDeploymentNotStarted,
  markB2FunctionDeploymentIntent,
  reconcileB2FunctionDeploymentTransition,
  resumeB2FunctionDeploymentAttempt,
  verifyB2FunctionDeploymentAttempt,
  verifyB2FunctionDeploymentProof,
} from './nelyon-b2-function-deployment-proof.mjs';

// Integration candidate only. Intentionally has no default network/process adapters
// and no command-line entry point. Must NOT be wired into a workflow until the
// protected caller implements and independently verifies every context gate.
const PROJECT = 'aewwdlvbwpczqyvkwvvj';
const DIRECT_HOST = `db.${PROJECT}.supabase.co`;
const POOLER_CONFIG_URL = `https://api.supabase.com/v1/projects/${PROJECT}/config/database/pooler`;
const LOGIN_ROLE_URL = `https://api.supabase.com/v1/projects/${PROJECT}/cli/login-role`;
const SESSION_POOLER_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pooler\.supabase\.com$/;
const READINESS_SQL = "select session_user = 'cli_login_postgres' and current_user = 'postgres' and current_database() = 'postgres' as ok";
const READINESS_ATTEMPTS = 9;
const READINESS_TIMEOUT_MS = 15000;
const PUSH_TIMEOUT_MS = 120000;
const ROLE_EXPIRY_SAFETY_MS = 5000;
const fail = () => { throw new Error('B2_EXPLICIT_CONNECTION_FAILED'); };
const connectionDiagnostics = new WeakMap();
const CONNECTION_DIAGNOSTIC_BOUNDARIES = new Set([
  'POOLER_CONFIG', 'LOGIN_ROLE', 'READINESS', 'DRY_RUN', 'APPLY', 'HERMETIC_POSTCHECK',
]);
const CONNECTION_DIAGNOSTIC_KINDS = new Set([
  'TRANSPORT', 'SPAWN', 'TIMEOUT', 'EXIT_NONZERO', 'OUTPUT_INVALID',
  'WORKSPACE_DRIFT', 'CONTEXT_INVALID', 'EXPIRY_BUDGET',
]);
const MAX_DIAGNOSTIC_ELAPSED_MS = 300000;
const MAX_DIAGNOSTIC_BYTES = 1048577;
const MAX_PROCESS_EXIT_CODE = 0xffffffff;

export function readB2ExplicitConnectionDiagnostic(error) {
  return connectionDiagnostics.get(error);
}

function boundedBytes(value) {
  if (typeof value !== 'string') return 0;
  return Math.min(Buffer.byteLength(value, 'utf8'), MAX_DIAGNOSTIC_BYTES);
}

function boundedElapsed(startedAt, completedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) return 0;
  return Math.min(Math.max(Math.ceil(completedAt - startedAt), 0), MAX_DIAGNOSTIC_ELAPSED_MS);
}

function connectionDiagnosticError({ boundary, kind, attempt = 0, elapsedMs = 0,
  exitCode = null, stdoutBytes = 0, stderrBytes = 0 }) {
  if (!CONNECTION_DIAGNOSTIC_BOUNDARIES.has(boundary) || !CONNECTION_DIAGNOSTIC_KINDS.has(kind)
    || !Number.isSafeInteger(attempt) || attempt < 0 || attempt > READINESS_ATTEMPTS
    || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > MAX_DIAGNOSTIC_ELAPSED_MS
    || !(exitCode === null || (Number.isSafeInteger(exitCode) && exitCode >= 0 && exitCode <= MAX_PROCESS_EXIT_CODE))
    || ![stdoutBytes, stderrBytes].every(value => Number.isSafeInteger(value)
      && value >= 0 && value <= MAX_DIAGNOSTIC_BYTES)) fail();
  const error = new Error('B2_EXPLICIT_CONNECTION_FAILED');
  Object.defineProperty(error, 'stack', { value: 'Error: B2_EXPLICIT_CONNECTION_FAILED' });
  connectionDiagnostics.set(error, Object.freeze({
    phase: 'B2_EXPLICIT_CONNECTION', boundary, kind, attempt, elapsedMs,
    exitCode, stdoutBytes, stderrBytes,
  }));
  return Object.freeze(error);
}

function snapshotExecutionResult(result) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return null;
  try {
    const prototype = Object.getPrototypeOf(result);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(result);
    const exitCode = descriptors.exitCode;
    const stdout = descriptors.stdout;
    const stderr = descriptors.stderr;
    if (!exitCode || !Object.hasOwn(exitCode, 'value')
      || (stdout && !Object.hasOwn(stdout, 'value'))
      || (stderr && !Object.hasOwn(stderr, 'value'))) return null;
    if (!Number.isSafeInteger(exitCode.value) || exitCode.value < 0
      || exitCode.value > MAX_PROCESS_EXIT_CODE) return null;
    return Object.freeze({
      exitCode: exitCode.value,
      stdout: stdout?.value,
      stderr: stderr?.value,
    });
  } catch {
    return null;
  }
}

function classifyChildProcessError(error) {
  if (error === null || typeof error !== 'object') return Object.freeze({kind:'SPAWN',exitCode:null});
  try {
    const descriptors = Object.getOwnPropertyDescriptors(error);
    const killed = descriptors.killed && Object.hasOwn(descriptors.killed, 'value')
      ? descriptors.killed.value : undefined;
    const code = descriptors.code && Object.hasOwn(descriptors.code, 'value')
      ? descriptors.code.value : undefined;
    if (killed === true) return Object.freeze({kind:'TIMEOUT',exitCode:null});
    if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return Object.freeze({kind:'OUTPUT_INVALID',exitCode:null});
    }
    if (Number.isSafeInteger(code) && code >= 0 && code <= MAX_PROCESS_EXIT_CODE) {
      return Object.freeze({kind:'EXIT_NONZERO',exitCode:code});
    }
  } catch {}
  return Object.freeze({kind:'SPAWN',exitCode:null});
}

function executionFailure({ boundary, attempt, elapsedMs, result, inherited }) {
  if (inherited) {
    return connectionDiagnosticError({ ...inherited,
      boundary: inherited.kind === 'WORKSPACE_DRIFT' ? 'HERMETIC_POSTCHECK' : boundary,
      attempt, elapsedMs });
  }
  return connectionDiagnosticError({
    boundary,
    kind: result ? 'EXIT_NONZERO' : 'SPAWN',
    attempt,
    elapsedMs,
    exitCode: Number.isSafeInteger(result?.exitCode) && result.exitCode >= 0 ? result.exitCode : null,
    stdoutBytes: boundedBytes(result?.stdout),
    stderrBytes: boundedBytes(result?.stderr),
  });
}

function primarySessionPooler(configs) {
  if (!Array.isArray(configs) || configs.length === 0 || configs.length > 64) fail();
  const primary = configs.filter(config => config !== null && typeof config === 'object'
    && !Array.isArray(config) && config.database_type === 'PRIMARY');
  if (primary.length !== 1) fail();
  const config = primary[0];
  if (typeof config.connection_string !== 'string'
    || (Object.hasOwn(config, 'connectionString') && config.connection_string !== config.connectionString)
    || Buffer.byteLength(config.connection_string, 'utf8') > 4096
    || /[\r\n\0]/u.test(config.connection_string)) fail();
  let url;
  try { url = new URL(config.connection_string); } catch { fail(); }
  let user;
  let password;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch { fail(); }
  const poolerHost = url.hostname;
  if (url.protocol !== 'postgresql:' || user !== `postgres.${PROJECT}`
    || password !== '[YOUR-PASSWORD]' || !SESSION_POOLER_HOST.test(poolerHost)
    || poolerHost !== poolerHost.toLowerCase() || !['5432', '6543'].includes(url.port)
    || url.pathname !== '/postgres' || url.search !== '' || url.hash !== ''
    || config.db_host !== poolerHost || config.db_port !== Number(url.port)
    || config.db_name !== 'postgres' || config.db_user !== `postgres.${PROJECT}`
    || !['session', 'transaction'].includes(config.pool_mode)) fail();
  return Object.freeze({ host: poolerHost });
}

export async function runB2ExplicitConnection({ phase, projectRef, host, token, cwd, manifest, verifyContext, request, execute,
  wait = sleep, clock = Date.now, monotonicClock = performance.now.bind(performance) }) {
  try {
    if (projectRef !== PROJECT || host !== DIRECT_HOST
      || !['dry-run','apply'].includes(phase) || typeof cwd !== 'string' || !cwd
      || typeof token !== 'string' || !token || /[\r\n\0]/.test(token)
      || ![verifyContext,request,execute,wait,clock,monotonicClock].every(fn=>typeof fn === 'function')) fail();
    let lastClock = -1;
    const readClock = () => {
      const observed = clock();
      if (!Number.isSafeInteger(observed) || observed < 0 || observed < lastClock) fail();
      lastClock = observed;
      return observed;
    };
    // Caller must enforce existing authority, receipts, freshness, manifest bytes,
    // backup/snapshots, exact binary and equivalence of effective remotes config.
    // This callback contract is NOT itself a replacement for any of those gates.
    let context;
    try { context = await verifyContext({ phase, projectRef, cwd, manifest }); }
    catch {
      throw connectionDiagnosticError({ boundary:'POOLER_CONFIG', kind:'CONTEXT_INVALID', attempt:0 });
    }
    if (context?.cliVersion !== '2.120.0' || context?.effectiveConfigVerified !== true) {
      throw connectionDiagnosticError({ boundary:'POOLER_CONFIG', kind:'CONTEXT_INVALID', attempt:0 });
    }
    const poolerStartedAt = monotonicClock();
    let poolerResponse;
    try {
      poolerResponse = await request({
        url:POOLER_CONFIG_URL,
        method:'GET', redirect:'error', timeoutMs:15000,
        headers:{Authorization:`Bearer ${token}`},
      });
    } catch (error) {
      const inherited = readB2ExplicitConnectionDiagnostic(error);
      if (inherited?.kind === 'OUTPUT_INVALID') {
        throw connectionDiagnosticError({ ...inherited, boundary:'POOLER_CONFIG', attempt:0,
          elapsedMs:boundedElapsed(poolerStartedAt,monotonicClock()) });
      }
      throw connectionDiagnosticError({ boundary:'POOLER_CONFIG', kind:'TRANSPORT', attempt:0,
        elapsedMs:boundedElapsed(poolerStartedAt,monotonicClock()) });
    }
    const poolerElapsedMs = boundedElapsed(poolerStartedAt,monotonicClock());
    let pooler;
    try { pooler = primarySessionPooler(poolerResponse); }
    catch {
      throw connectionDiagnosticError({ boundary:'POOLER_CONFIG', kind:'OUTPUT_INVALID', attempt:0,
        elapsedMs:poolerElapsedMs });
    }
    const roleRequestedAt = readClock();
    const roleStartedAt = monotonicClock();
    let role;
    try {
      role = await request({
        url:LOGIN_ROLE_URL,
        method:'POST', redirect:'error', timeoutMs:15000,
        headers:{Authorization:`Bearer ${token}`}, body:{read_only:false},
      });
    } catch (error) {
      const inherited = readB2ExplicitConnectionDiagnostic(error);
      if (inherited?.kind === 'OUTPUT_INVALID') {
        throw connectionDiagnosticError({ ...inherited, boundary:'LOGIN_ROLE', attempt:0,
          elapsedMs:boundedElapsed(roleStartedAt,monotonicClock()) });
      }
      throw connectionDiagnosticError({ boundary:'LOGIN_ROLE', kind:'TRANSPORT', attempt:0,
        elapsedMs:boundedElapsed(roleStartedAt,monotonicClock()) });
    }
    const roleElapsedMs = boundedElapsed(roleStartedAt,monotonicClock());
    if (role?.role !== 'cli_login_postgres'
      || typeof role.password !== 'string' || !role.password || role.password.includes('\0')
      || !Number.isSafeInteger(role.ttl_seconds) || role.ttl_seconds <= 0
      || !Number.isSafeInteger(role.ttl_seconds * 1000)
      || !Number.isSafeInteger(roleRequestedAt + (role.ttl_seconds * 1000))) {
      throw connectionDiagnosticError({ boundary:'LOGIN_ROLE', kind:'OUTPUT_INVALID', attempt:0,
        elapsedMs:roleElapsedMs });
    }
    const roleExpiresAt = roleRequestedAt + (role.ttl_seconds * 1000);
    const dsn = `postgresql://${role.role}.${PROJECT}@${pooler.host}:5432/postgres?sslmode=verify-full`;
    const readinessArgs=['db','query','--db-url',dsn,'--agent=no','--output=json',READINESS_SQL];
    let ready = false;
    for (let attempt = 1; attempt <= READINESS_ATTEMPTS; attempt += 1) {
      let refreshed;
      try { refreshed = await verifyContext({ phase, projectRef, cwd, manifest }); }
      catch {
        throw connectionDiagnosticError({ boundary:'READINESS', kind:'CONTEXT_INVALID', attempt });
      }
      if (refreshed?.cliVersion !== '2.120.0' || refreshed?.effectiveConfigVerified !== true) {
        throw connectionDiagnosticError({ boundary:'READINESS', kind:'CONTEXT_INVALID', attempt });
      }
      if (roleExpiresAt - readClock() < READINESS_TIMEOUT_MS + PUSH_TIMEOUT_MS + ROLE_EXPIRY_SAFETY_MS) {
        throw connectionDiagnosticError({ boundary:'READINESS', kind:'EXPIRY_BUDGET', attempt });
      }
      let probe;
      let inherited;
      let executionThrew = false;
      const attemptStartedAt = monotonicClock();
      try {
        probe = await execute({args:readinessArgs,cwd,env:{PGPASSWORD:role.password},shell:false,
          timeoutMs:READINESS_TIMEOUT_MS,maxBuffer:65536});
      } catch (error) { executionThrew = true; inherited = readB2ExplicitConnectionDiagnostic(error); }
      const attemptElapsedMs = boundedElapsed(attemptStartedAt, monotonicClock());
      if (inherited?.kind === 'WORKSPACE_DRIFT' || inherited?.kind === 'OUTPUT_INVALID') {
        throw executionFailure({ boundary:'READINESS', attempt, elapsedMs:attemptElapsedMs,
          result:undefined, inherited });
      }
      if (!executionThrew) {
        probe = snapshotExecutionResult(probe);
        if (!probe) {
          throw connectionDiagnosticError({ boundary:'READINESS', kind:'OUTPUT_INVALID', attempt,
            elapsedMs:attemptElapsedMs });
        }
      }
      if (probe?.exitCode === 0) {
        if (typeof probe.stdout !== 'string' || Buffer.byteLength(probe.stdout, 'utf8') > 65536
          || probe.stdout.includes(role.password) || probe.stdout.includes(token)) {
          throw connectionDiagnosticError({ boundary:'READINESS', kind:'OUTPUT_INVALID', attempt,
            elapsedMs:attemptElapsedMs, exitCode:0, stdoutBytes:boundedBytes(probe.stdout),
            stderrBytes:boundedBytes(probe.stderr) });
        }
        let rows;
        try { rows = JSON.parse(probe.stdout); }
        catch {
          throw connectionDiagnosticError({ boundary:'READINESS', kind:'OUTPUT_INVALID', attempt,
            elapsedMs:attemptElapsedMs, exitCode:0, stdoutBytes:boundedBytes(probe.stdout),
            stderrBytes:boundedBytes(probe.stderr) });
        }
        if (!Array.isArray(rows) || rows.length !== 1 || rows[0] === null
          || typeof rows[0] !== 'object' || Array.isArray(rows[0])
          || Object.keys(rows[0]).join(',') !== 'ok' || rows[0].ok !== true) {
          throw connectionDiagnosticError({ boundary:'READINESS', kind:'OUTPUT_INVALID', attempt,
            elapsedMs:attemptElapsedMs, exitCode:0, stdoutBytes:boundedBytes(probe.stdout),
            stderrBytes:boundedBytes(probe.stderr) });
        }
        ready = true;
        break;
      }
      if (attempt === READINESS_ATTEMPTS) {
        throw executionFailure({ boundary: 'READINESS', attempt, elapsedMs: attemptElapsedMs,
          result: probe, inherited });
      }
      const delay = Math.min(3000 * (1.5 ** (attempt - 1)), 60000);
      if (roleExpiresAt - readClock() < delay + READINESS_TIMEOUT_MS + PUSH_TIMEOUT_MS + ROLE_EXPIRY_SAFETY_MS) {
        throw connectionDiagnosticError({ boundary:'READINESS', kind:'EXPIRY_BUDGET', attempt });
      }
      await wait(delay);
    }
    if (!ready) fail();
    const pushBoundary = phase === 'dry-run' ? 'DRY_RUN' : 'APPLY';
    let finalContext;
    try { finalContext = await verifyContext({ phase, projectRef, cwd, manifest }); }
    catch {
      throw connectionDiagnosticError({ boundary:pushBoundary, kind:'CONTEXT_INVALID', attempt:0 });
    }
    if (finalContext?.cliVersion !== '2.120.0' || finalContext?.effectiveConfigVerified !== true) {
      throw connectionDiagnosticError({ boundary:pushBoundary, kind:'CONTEXT_INVALID', attempt:0 });
    }
    if (roleExpiresAt - readClock() < PUSH_TIMEOUT_MS + ROLE_EXPIRY_SAFETY_MS) {
      throw connectionDiagnosticError({ boundary:pushBoundary, kind:'EXPIRY_BUDGET', attempt:0 });
    }
    const args=['db','push','--db-url',dsn,'--skip-vault','--yes'];
    if (phase === 'dry-run') args.push('--dry-run','--output-format','json');
    // Adapter MUST replace env, never merge process.env, use shell:false,
    // reject redirects, bound captured output and suppress raw stderr/errors.
    // No PAT is given to CLI, no --project-ref, no linked fallback or retries.
    const pushStartedAt = monotonicClock();
    let result;
    let inherited;
    let executionThrew = false;
    try {
      result = await execute({args,cwd,env:{PGPASSWORD:role.password},shell:false,timeoutMs:PUSH_TIMEOUT_MS,maxBuffer:1024*1024});
    } catch (error) { executionThrew = true; inherited = readB2ExplicitConnectionDiagnostic(error); }
    const pushElapsedMs = boundedElapsed(pushStartedAt,monotonicClock());
    if (!executionThrew) {
      result = snapshotExecutionResult(result);
      if (!result) {
        throw connectionDiagnosticError({ boundary:pushBoundary, kind:'OUTPUT_INVALID', attempt:0,
          elapsedMs:pushElapsedMs });
      }
    }
    if (inherited || result?.exitCode !== 0) {
      throw executionFailure({ boundary:pushBoundary, attempt:0, elapsedMs:pushElapsedMs, result, inherited });
    }
    if (phase === 'apply') return {complete:true};
    if (typeof result.stdout !== 'string' || !result.stdout.trimStart().startsWith('{') || result.stdout.includes(role.password)
      || result.stdout.includes(token)) {
      throw connectionDiagnosticError({ boundary:'DRY_RUN', kind:'OUTPUT_INVALID', attempt:0,
        elapsedMs:pushElapsedMs, exitCode:0, stdoutBytes:boundedBytes(result.stdout),
        stderrBytes:boundedBytes(result.stderr) });
    }
    try { return verifyMigrationDryRun({text:result.stdout,manifest}); }
    catch {
      throw connectionDiagnosticError({ boundary:'DRY_RUN', kind:'OUTPUT_INVALID', attempt:0,
        elapsedMs:pushElapsedMs, exitCode:0, stdoutBytes:boundedBytes(result.stdout),
        stderrBytes:boundedBytes(result.stderr) });
    }
  } catch (error) {
    // Never propagate a transport/spawn exception containing token, DSN or password.
    if (readB2ExplicitConnectionDiagnostic(error)) throw error;
    fail();
  }
}



export async function runB2HermeticConnection({workspace,verifyContext,execute,...options}) {
  if (![verifyContext,execute,options.request].every(fn=>typeof fn === 'function')) fail();
  return runB2ExplicitConnection({...options,cwd:workspace?.cwd,
    verifyContext:async context=>{
      verifyHermeticMigrationWorkspace(workspace);
      const verified=await verifyContext(context);
      verifyHermeticMigrationWorkspace(workspace);
      return verified;
    },
    execute:async specification=>{
      verifyHermeticMigrationWorkspace(workspace);
      return execute({...specification,executable:workspace.binaryPath});
    },
  });
}



// Concrete adapters: exported for reviewed callers, never run on module import.
export function createB2HttpAdapter({fetchImpl=globalThis.fetch}={}) {
  if(typeof fetchImpl!=='function')fail();
  return async specification=>{
    let reader;let poolerRequest;let roleRequest;let response;
    try{
      const s=specification;
      poolerRequest=s?.url===POOLER_CONFIG_URL&&s.method==='GET'
        &&s.body===undefined;
      roleRequest=s?.url===LOGIN_ROLE_URL&&s.method==='POST'
        &&JSON.stringify(s.body)==='{"read_only":false}';
      if((!poolerRequest&&!roleRequest)||s.redirect!=='error'||s.timeoutMs!==15000
        ||Object.keys(s.headers??{}).join(',')!=='Authorization'
        ||typeof s.headers.Authorization!=='string'||!/^Bearer [^\r\n\0]+$/.test(s.headers.Authorization))fail();
      response=await fetchImpl(s.url,{method:s.method,redirect:'error',signal:AbortSignal.timeout(15000),
        headers:roleRequest?{Authorization:s.headers.Authorization,'Content-Type':'application/json'}
          :{Authorization:s.headers.Authorization},...(roleRequest?{body:'{"read_only":false}'}:{})});
    }catch{fail();}
    const invalid=()=>{throw connectionDiagnosticError({boundary:poolerRequest?'POOLER_CONFIG':'LOGIN_ROLE',
      kind:'OUTPUT_INVALID',attempt:0});};
    if(response.status!==(roleRequest?201:200)||response.redirected===true)invalid();
    const length=response.headers.get('content-length');
    if(length!==null && (!/^\d+$/.test(length)||Number(length)>65536))invalid();
    reader=response.body?.getReader();if(!reader)invalid();
    let total=0;const chunks=[];
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>65536)invalid();chunks.push(Buffer.from(value));}
    }catch(error){if(readB2ExplicitConnectionDiagnostic(error))throw error;fail();}
    finally{try{await reader.cancel();}catch{}reader.releaseLock();}
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{invalid();}
    if(poolerRequest){try{primarySessionPooler(value);}catch{invalid();}return value;}
    if(value?.role!=='cli_login_postgres'
      ||typeof value.password!=='string'||!value.password||value.password.includes('\0')
      ||!Number.isSafeInteger(value.ttl_seconds)||value.ttl_seconds<=0)invalid();
    return {role:value.role,password:value.password,ttl_seconds:value.ttl_seconds};
  };
}

export function createB2Executor({workspace,execFileImpl=execFile,monotonicClock=performance.now.bind(performance)}) {
  if(typeof execFileImpl!=='function'||typeof monotonicClock!=='function')fail();
  verifyHermeticMigrationWorkspace(workspace);
  return async specification=>{
    try{
      const s=specification;
      verifyHermeticMigrationWorkspace(workspace);
      if(s?.executable!==workspace.binaryPath||s.cwd!==workspace.cwd||s.shell!==false
        ||!Array.isArray(s.args)
        ||Object.keys(s.env??{}).join(',')!=='PGPASSWORD'||typeof s.env.PGPASSWORD!=='string'
        ||!s.env.PGPASSWORD||s.env.PGPASSWORD.includes('\0'))fail();
      const args=s.args;
      const dsnValid=typeof args[3]==='string'
        &&/^postgresql:\/\/cli_login_[a-z0-9_]+\.aewwdlvbwpczqyvkwvvj@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pooler\.supabase\.com:5432\/postgres\?sslmode=verify-full$/.test(args[3]);
      const pushValid=[6,9].includes(args.length)&&args[0]==='db'&&args[1]==='push'
        &&args[2]==='--db-url'&&dsnValid&&args[4]==='--skip-vault'&&args[5]==='--yes'
        &&(args.length===6||(args[6]==='--dry-run'&&args[7]==='--output-format'&&args[8]==='json'))
        &&s.timeoutMs===120000&&s.maxBuffer===1048576;
      const readinessValid=args.length===7&&args[0]==='db'&&args[1]==='query'
        &&args[2]==='--db-url'&&dsnValid&&args[4]==='--agent=no'&&args[5]==='--output=json'
        &&args[6]===READINESS_SQL&&s.timeoutMs===15000&&s.maxBuffer===65536;
      if(!pushValid&&!readinessValid)fail();
      const boundary=readinessValid?'READINESS':args.length===9?'DRY_RUN':'APPLY';
      const startedAt=monotonicClock();
      return await new Promise((resolve,reject)=>{
        let callbackObserved=false;
        const callback=(error,stdout,stderr)=>{
          callbackObserved=true;
          let elapsedMs=0;try{elapsedMs=boundedElapsed(startedAt,monotonicClock());}catch{}
          if(error){
            const {kind,exitCode}=classifyChildProcessError(error);
            reject(connectionDiagnosticError({boundary,kind,attempt:0,elapsedMs,exitCode,
              stdoutBytes:boundedBytes(stdout),stderrBytes:boundedBytes(stderr)}));return;
          }
          if(typeof stdout!=='string'||Buffer.byteLength(stdout)>s.maxBuffer){
            reject(connectionDiagnosticError({boundary,kind:'OUTPUT_INVALID',attempt:0,elapsedMs,
              exitCode:null,stdoutBytes:boundedBytes(stdout),stderrBytes:boundedBytes(stderr)}));return;
          }
          try{verifyHermeticMigrationWorkspace(workspace);resolve({exitCode:0,stdout});}
          catch{reject(connectionDiagnosticError({boundary:'HERMETIC_POSTCHECK',kind:'WORKSPACE_DRIFT',attempt:0,
            elapsedMs,exitCode:null,stdoutBytes:boundedBytes(stdout),stderrBytes:boundedBytes(stderr)}));}
        };
        try{execFileImpl(workspace.binaryPath,[...args],{cwd:workspace.cwd,env:{PGPASSWORD:s.env.PGPASSWORD,HOME:workspace.homePath,USERPROFILE:workspace.homePath,XDG_CONFIG_HOME:workspace.homePath,DO_NOT_TRACK:'1',SUPABASE_NO_UPDATE_NOTIFIER:'1',SUPABASE_TELEMETRY_DISABLED:'1'},
          shell:false,windowsHide:true,timeout:s.timeoutMs,maxBuffer:s.maxBuffer,encoding:'utf8'},(error,stdout,stderr)=>{
          callback(error,stdout,stderr);
        });}catch{if(!callbackObserved){let elapsedMs=0;try{elapsedMs=boundedElapsed(startedAt,monotonicClock());}catch{}
          reject(connectionDiagnosticError({boundary,kind:'SPAWN',attempt:0,elapsedMs}));}}
      });
    }catch(error){if(readB2ExplicitConnectionDiagnostic(error))throw error;fail();}
  };
}


// Internal integration boundary. The protected runtime still owns all arguments,
// the fresh context verifier and clock; this is NOT a candidate CLI entry point.
export async function runB2ProtectedMigration({operation,connection,now=()=>new Date().toISOString()}) {
  if(connection?.phase!=='apply'||operation?.request?.mode!=='release'||typeof now!=='function'
    ||![connection.request,connection.execute].every(fn=>typeof fn==='function'))fail();
  verifyHermeticMigrationWorkspace(connection.workspace);
  const revalidate=()=>{
    verifyHermeticMigrationManifest(connection.workspace,operation.manifest);
    verifyHermeticGitSource(connection.workspace,{repositoryRoot:operation.repositoryRoot,approvedSha:operation.manifest.identity.approved_sha});
    return verifyB2ProtectedReleaseMutation({...operation,requestedAt:now()});
  };
  revalidate();
  let result;
  await executeB2ProtectedMutation({...operation,requestedAt:now(),stage:'migrations',mutate:async()=>{
    const verifyContext=async()=>{revalidate();return {cliVersion:'2.120.0',effectiveConfigVerified:true};};
    await runB2HermeticConnection({...connection,phase:'dry-run',manifest:operation.manifest,verifyContext});
    revalidate();
    result=await runB2HermeticConnection({...connection,manifest:operation.manifest,verifyContext});
  }});
  return result;
}





export async function runB2ProtectedDryRun({operation,connection,now=()=>new Date().toISOString()}) {
 if(connection?.phase!=='dry-run'||operation?.request?.mode!=='release'||typeof now!=='function'
  ||![connection.request,connection.execute].every(fn=>typeof fn==='function'))fail();
 const revalidate=()=>{
  verifyHermeticMigrationManifest(connection.workspace,operation.manifest);
  verifyHermeticGitSource(connection.workspace,{repositoryRoot:operation.repositoryRoot,approvedSha:operation.manifest.identity.approved_sha});
  verifyB2ProtectedReleaseMutation({...operation,requestedAt:now()});
 };
 revalidate();
 const verifyContext=async()=>{revalidate();return {cliVersion:'2.120.0',effectiveConfigVerified:true};};
 const result=await runB2HermeticConnection({...connection,manifest:operation.manifest,verifyContext});
 revalidate();return result;
}

function functionDeploymentFail() {
  const error = new Error('B2_FUNCTION_DEPLOYMENT_FAILED');
  error.code = 'B2_FUNCTION_DEPLOYMENT_FAILED';
  throw error;
}

const PROOF_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function proofTimestampFloor(proof) {
  if (proof === null) return Number.NEGATIVE_INFINITY;
  const values = [proof.captured_at,
    ...(proof.receipts ?? []).map(receipt => receipt.captured_at),
    ...(proof.in_flight ? [proof.in_flight.captured_at] : [])];
  const times = values.map(value => Date.parse(value));
  if (values.some(value => typeof value !== 'string' || !PROOF_TIMESTAMP_PATTERN.test(value))
    || times.some(value => !Number.isFinite(value))) functionDeploymentFail();
  return Math.max(...times);
}

function createMonotonicProofClock(now, initialProof = null) {
  let floor = proofTimestampFloor(initialProof);
  return () => {
    const observedAt = now();
    if (typeof observedAt !== 'string' || !PROOF_TIMESTAMP_PATTERN.test(observedAt)
      || new Date(Date.parse(observedAt)).toISOString() !== observedAt) functionDeploymentFail();
    const observed = Date.parse(observedAt);
    const next = Math.max(observed, floor + 1);
    floor = next;
    return new Date(next).toISOString();
  };
}

export async function executeB2FunctionDeploymentBatch({
  manifest,
  manifestSha256,
  beforeRows,
  now,
  verifyFunction,
  deploy,
  readRows,
  recordAttempt,
  revalidate,
  initialProof = null,
}) {
  if (!Array.isArray(manifest) || typeof manifestSha256 !== 'string'
    || (beforeRows !== undefined && !Array.isArray(beforeRows)) || typeof now !== 'function'
    || ![verifyFunction, deploy, readRows, recordAttempt, revalidate].every(value => typeof value === 'function')) {
    functionDeploymentFail();
  }
  let proof;
  try {
    let latestRows;
    if (initialProof === null) {
      const proofNow = createMonotonicProofClock(now);
      proof = createB2FunctionDeploymentNotStarted({
        manifest,
        manifestSha256,
        capturedAt: proofNow(),
      });
      await recordAttempt(proof);
    } else {
      proof = verifyB2FunctionDeploymentAttempt({ proof: initialProof, manifest, manifestSha256 });
    }
    const proofNow = createMonotonicProofClock(now, proof);
    if (proof.result === 'FUNCTIONS_EXECUTED') {
      latestRows = await readRows();
      return verifyB2FunctionDeploymentProof({ proof, manifest, manifestSha256, postRows: latestRows });
    }
    if (proof.result === 'NOT_STARTED') {
      latestRows = beforeRows ?? await readRows();
      proof = beginB2FunctionDeploymentAttempt({
        proof,
        manifest,
        manifestSha256,
        beforeRows: latestRows,
        capturedAt: proofNow(),
      });
    } else {
      latestRows = await readRows();
      proof = resumeB2FunctionDeploymentAttempt({
        proof,
        manifest,
        manifestSha256,
        beforeRows: proof.before,
        currentRows: latestRows,
        capturedAt: proofNow(),
      });
    }
    await recordAttempt(proof);
    const originalRows = proof.before;
    for (const contract of manifest.slice(proof.receipts.length)) {
      revalidate({ completedNames: proof.receipts.map(receipt => receipt.name), proof });
      const verified = verifyFunction(contract.name);
      if (verified?.result !== 'FUNCTION_CONTRACT_VERIFIED'
        || verified.functions?.length !== 1
        || verified.functions[0]?.name !== contract.name) functionDeploymentFail();

      proof = markB2FunctionDeploymentIntent({
        proof,
        manifest,
        manifestSha256,
        beforeRows: originalRows,
        functionName: contract.name,
        capturedAt: proofNow(),
      });
      await recordAttempt(proof);
      let commandSucceeded = false;
      try {
        const result = await deploy(contract.name);
        commandSucceeded = result?.exitCode === 0;
      } catch {
        commandSucceeded = false;
      }
      latestRows = await readRows();
      proof = reconcileB2FunctionDeploymentTransition({
        proof,
        manifest,
        manifestSha256,
        beforeRows: originalRows,
        afterRows: latestRows,
        functionName: contract.name,
        commandSucceeded,
        capturedAt: proofNow(),
      });
      await recordAttempt(proof);
      if (!commandSucceeded) functionDeploymentFail();
      revalidate({ completedNames: proof.receipts.map(receipt => receipt.name), proof });
    }
    return verifyB2FunctionDeploymentProof({ proof, manifest, manifestSha256, postRows: latestRows });
  } catch (error) {
    if (error?.code === 'B2_FUNCTION_DEPLOYMENT_FAILED') throw error;
    functionDeploymentFail();
  }
}

/** Protected Edge mutation boundary. The caller supplies the already pinned
 * absolute CLI and a closed executor; no shell command or candidate argument
 * can enter this path. One proof covers the exact manifest-ordered batch. */
export async function runB2ProtectedFunctions({operation,connection,now=()=>new Date().toISOString()}) {
  if(operation?.request?.mode!=='release'||typeof now!=='function'
    ||connection?.projectRef!==PROJECT||typeof connection.binaryPath!=='string'
    ||typeof connection.repositoryRoot!=='string'||typeof connection.token!=='string'||!connection.token
    ||![connection.verifyFunction,connection.execute,connection.readFunctionRows,
      connection.recordFunctionAttempt].every(fn=>typeof fn==='function'))fail();
  const functions=operation.manifest?.resources?.functions;
  const contracts=operation.manifest?.resources?.web_control_centers_b2_transition?.contract?.functions;
  if(!Array.isArray(functions)||!Array.isArray(contracts)||functions.length!==contracts.length
    ||functions.some((name,index)=>name!==contracts[index]?.name))fail();
  const revalidate=()=>verifyB2ProtectedReleaseMutation({...operation,requestedAt:now()});
  revalidate();
  const manifestSha256=b2FunctionManifestSha256(contracts);
  const initialProof=connection.initialFunctionProof??createB2FunctionDeploymentNotStarted({
    manifest:contracts,manifestSha256,capturedAt:now(),
  });
  const preparedProof=verifyB2FunctionDeploymentAttempt({proof:initialProof,manifest:contracts,manifestSha256});
  await connection.recordFunctionAttempt(preparedProof);
  let result;
  await executeB2ProtectedMutation({...operation,requestedAt:now(),stage:'functions',mutate:async()=>{
    result=await executeB2FunctionDeploymentBatch({manifest:contracts,manifestSha256,
      now,verifyFunction:connection.verifyFunction,initialProof:preparedProof,
      readRows:connection.readFunctionRows,recordAttempt:connection.recordFunctionAttempt,
      revalidate:()=>revalidate(),deploy:functionName=>connection.execute({executable:connection.binaryPath,cwd:connection.repositoryRoot,
        args:['functions','deploy',functionName,'--project-ref',PROJECT,'--use-api'],
        env:{SUPABASE_ACCESS_TOKEN:connection.token},shell:false,timeoutMs:120000,maxBuffer:1048576})});
  }});
  return {complete:true,count:functions.length,proof:result};
}
