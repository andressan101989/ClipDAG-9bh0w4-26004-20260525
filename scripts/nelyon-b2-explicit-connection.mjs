import { execFile } from 'node:child_process';
import { verifyHermeticMigrationWorkspace, verifyHermeticMigrationManifest, verifyHermeticGitSource } from './nelyon-b2-hermetic-workspace.mjs';
import { verifyMigrationDryRun, executeB2ProtectedMutation, verifyB2ProtectedReleaseMutation } from './nelyon-production-release.mjs';

// Integration candidate only. Intentionally has no default network/process adapters
// and no command-line entry point. Must NOT be wired into a workflow until the
// protected caller implements and independently verifies every context gate.
const PROJECT = 'aewwdlvbwpczqyvkwvvj';
const fail = () => { throw new Error('B2_EXPLICIT_CONNECTION_FAILED'); };
export async function runB2ExplicitConnection({ phase, projectRef, host, token, cwd, manifest, verifyContext, request, execute }) {
  try {
    if (projectRef !== PROJECT || host !== `db.${PROJECT}.supabase.co`
      || !['dry-run','apply'].includes(phase) || typeof cwd !== 'string' || !cwd
      || typeof token !== 'string' || !token || /[\r\n\0]/.test(token)
      || ![verifyContext,request,execute].every(fn=>typeof fn === 'function')) fail();
    // Caller must enforce existing authority, receipts, freshness, manifest bytes,
    // backup/snapshots, exact binary and equivalence of effective remotes config.
    // This callback contract is NOT itself a replacement for any of those gates.
    const context = await verifyContext({ phase, projectRef, cwd, manifest });
    if (context?.cliVersion !== '2.120.0' || context?.effectiveConfigVerified !== true) fail();
    const role = await request({
      url:`https://api.supabase.com/v1/projects/${PROJECT}/cli/login-role`,
      method:'POST', redirect:'error', timeoutMs:15000,
      headers:{Authorization:`Bearer ${token}`}, body:{read_only:false},
    });
    if (typeof role?.role !== 'string' || !/^cli_login_[a-z0-9_]+$/.test(role.role)
      || typeof role.password !== 'string' || !role.password || role.password.includes('\0')) fail();
    const refreshed = await verifyContext({ phase, projectRef, cwd, manifest });
    if (refreshed?.cliVersion !== '2.120.0' || refreshed?.effectiveConfigVerified !== true) fail();
    const dsn = `postgresql://${role.role}@${host}:5432/postgres?sslmode=verify-full`;
    const args=['db','push','--db-url',dsn,'--skip-vault','--yes'];
    if (phase === 'dry-run') args.push('--dry-run','--output-format','json');
    // Adapter MUST replace env, never merge process.env, use shell:false,
    // reject redirects, bound captured output and suppress raw stderr/errors.
    // No PAT is given to CLI, no --project-ref, no linked fallback or retries.
    const result = await execute({args,cwd,env:{PGPASSWORD:role.password},shell:false,timeoutMs:120000,maxBuffer:1024*1024});
    if (result?.exitCode !== 0) fail();
    if (phase === 'apply') return {complete:true};
    if (typeof result.stdout !== 'string' || !result.stdout.trimStart().startsWith('{') || result.stdout.includes(role.password)
      || result.stdout.includes(token)) fail();
    return verifyMigrationDryRun({text:result.stdout,manifest});
  } catch {
    // Never propagate a transport/spawn exception containing token, DSN or password.
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
    let reader;
    try{
      const s=specification;
      if(s?.url!==`https://api.supabase.com/v1/projects/${PROJECT}/cli/login-role`
        ||s.method!=='POST'||s.redirect!=='error'||s.timeoutMs!==15000
        ||JSON.stringify(s.body)!=='{"read_only":false}'
        ||Object.keys(s.headers??{}).join(',')!=='Authorization'
        ||typeof s.headers.Authorization!=='string'||!/^Bearer [^\r\n\0]+$/.test(s.headers.Authorization))fail();
      const response=await fetchImpl(s.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
        headers:{Authorization:s.headers.Authorization,'Content-Type':'application/json'},body:'{"read_only":false}'});
      if(response.status!==201||response.redirected===true)fail();
      const length=response.headers.get('content-length');
      if(length!==null && (!/^\d+$/.test(length)||Number(length)>65536))fail();
      reader=response.body?.getReader();if(!reader)fail();
      let total=0;const chunks=[];
      for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>65536)fail();chunks.push(Buffer.from(value));}
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      if(typeof value?.role!=='string'||!/^cli_login_[a-z0-9_]+$/.test(value.role)
        ||typeof value.password!=='string'||!value.password||value.password.includes('\0'))fail();
      return {role:value.role,password:value.password};
    }catch{fail();}
    finally{if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}}
  };
}

export function createB2Executor({workspace,execFileImpl=execFile}) {
  if(typeof execFileImpl!=='function')fail();
  verifyHermeticMigrationWorkspace(workspace);
  return async specification=>{
    try{
      const s=specification;
      verifyHermeticMigrationWorkspace(workspace);
      if(s?.executable!==workspace.binaryPath||s.cwd!==workspace.cwd||s.shell!==false
        ||s.timeoutMs!==120000||s.maxBuffer!==1048576||!Array.isArray(s.args)
        ||Object.keys(s.env??{}).join(',')!=='PGPASSWORD'||typeof s.env.PGPASSWORD!=='string'
        ||!s.env.PGPASSWORD||s.env.PGPASSWORD.includes('\0'))fail();
      const args=s.args;
      if(![6,9].includes(args.length)||args[0]!=='db'||args[1]!=='push'||args[2]!=='--db-url'
        ||typeof args[3]!=='string'||!/^postgresql:\/\/cli_login_[a-z0-9_]+@db\.aewwdlvbwpczqyvkwvvj\.supabase\.co:5432\/postgres\?sslmode=verify-full$/.test(args[3])
        ||args[4]!=='--skip-vault'||args[5]!=='--yes'
        ||(args.length===9&&(args[6]!=='--dry-run'||args[7]!=='--output-format'||args[8]!=='json')))fail();
      return await new Promise((resolve,reject)=>{
        execFileImpl(workspace.binaryPath,[...args],{cwd:workspace.cwd,env:{PGPASSWORD:s.env.PGPASSWORD,HOME:workspace.homePath,USERPROFILE:workspace.homePath,XDG_CONFIG_HOME:workspace.homePath,DO_NOT_TRACK:'1',SUPABASE_NO_UPDATE_NOTIFIER:'1',SUPABASE_TELEMETRY_DISABLED:'1'},
          shell:false,windowsHide:true,timeout:120000,maxBuffer:1048576,encoding:'utf8'},(error,stdout)=>{
          if(error || typeof stdout!=='string' || Buffer.byteLength(stdout)>1048576)reject(new Error('B2_EXPLICIT_CONNECTION_FAILED'));
          else {
            try{verifyHermeticMigrationWorkspace(workspace);resolve({exitCode:0,stdout});}
            catch{reject(new Error('B2_EXPLICIT_CONNECTION_FAILED'));}
          }
        });
      });
    }catch{fail();}
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

/** Protected Edge mutation boundary. The caller supplies the already pinned
 * absolute CLI and a closed executor; no shell command or candidate argument
 * can enter this path. One proof covers the exact manifest-ordered batch. */
export async function runB2ProtectedFunctions({operation,connection,now=()=>new Date().toISOString()}) {
  if(operation?.request?.mode!=='release'||typeof now!=='function'
    ||connection?.projectRef!==PROJECT||typeof connection.binaryPath!=='string'
    ||typeof connection.repositoryRoot!=='string'||typeof connection.token!=='string'||!connection.token
    ||![connection.verifyFunction,connection.execute].every(fn=>typeof fn==='function'))fail();
  const functions=operation.manifest?.resources?.functions;
  if(!Array.isArray(functions)||functions.length<1||new Set(functions).size!==functions.length
    ||functions.some(name=>typeof name!=='string'||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)))fail();
  const revalidate=()=>verifyB2ProtectedReleaseMutation({...operation,requestedAt:now()});
  revalidate();
  await executeB2ProtectedMutation({...operation,requestedAt:now(),stage:'functions',mutate:async()=>{
    for(const functionName of functions){
      revalidate();
      const verified=connection.verifyFunction(functionName);
      if(verified?.result!=='FUNCTION_CONTRACT_VERIFIED'||verified.functions?.length!==1
        ||verified.functions[0]?.name!==functionName)fail();
      revalidate();
      const result=await connection.execute({executable:connection.binaryPath,cwd:connection.repositoryRoot,
        args:['functions','deploy',functionName,'--project-ref',PROJECT,'--use-api'],
        env:{SUPABASE_ACCESS_TOKEN:connection.token},shell:false,timeoutMs:120000,maxBuffer:1048576});
      if(result?.exitCode!==0)fail();
    }
  }});
  return {complete:true,count:functions.length};
}
