import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminPageHeader} from "../components/AdminDashboard";
import {ConfirmDialog} from "../components/ConfirmDialog";
import {supabase} from "../lib/supabase";

type Factor={id:string;friendly_name?:string;status:string;factor_type:string};
type Enrollment={id:string;qr:string;secret:string};

export function AdminSecurityPage(){
  const {security,retry,logout}=useAdminAuth();
  const [factors,setFactors]=useState<Factor[]|null>(null),[enrollment,setEnrollment]=useState<Enrollment|null>(null),[code,setCode]=useState(""),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[removing,setRemoving]=useState<Factor|null>(null);
  const generation=useRef(0),inFlight=useRef(false);
  const invalidate=useCallback(()=>{generation.current++},[]);
  const load=useCallback(async()=>{
    const version=generation.current;setError(null);
    try{
      const {data,error:factorError}=await supabase.auth.mfa.listFactors();
      if(version!==generation.current)return;
      if(factorError)throw factorError;
      const totp=data.all.filter((factor)=>factor.factor_type==="totp");
      setFactors(totp);setSelected((current)=>totp.some((factor)=>factor.id===current)?current:totp.find((factor)=>factor.status==="verified")?.id??"");
    }catch{if(version===generation.current){setFactors(null);setError("No se pudieron consultar los autenticadores. Reintenta la consulta.")}}
  },[]);
  useEffect(()=>{void load();return invalidate},[load,invalidate]);
  const run=async(action:()=>Promise<void>)=>{
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError(null);setNotice(null);
    const version=generation.current;
    try{await action()}catch{if(version===generation.current)setError("No se pudo completar la operación. Comprueba el código y reintenta. Si perdiste el dispositivo, solicita recuperación al operador autorizado.")}
    finally{inFlight.current=false;if(version===generation.current)setBusy(false)}
  };
  const enroll=()=>run(async()=>{
    const version=generation.current;
    const {data,error:enrollError}=await supabase.auth.mfa.enroll({factorType:"totp",friendlyName:`Nelyon Admin ${new Date().toISOString()}`});
    if(enrollError)throw enrollError;
    if(version!==generation.current)return;
    setEnrollment({id:data.id,qr:data.totp.qr_code,secret:data.totp.secret});setCode("");
  });
  const verify=(event:FormEvent)=>{
    event.preventDefault();if(!/^\d{6}$/.test(code))return;
    void run(async()=>{
      const version=generation.current,factorId=enrollment?.id??selected;
      const challenge=await supabase.auth.mfa.challenge({factorId});
      if(challenge.error)throw challenge.error;
      if(version!==generation.current)return;
      const result=await supabase.auth.mfa.verify({factorId,challengeId:challenge.data.id,code});
      if(result.error)throw result.error;
      if(version!==generation.current)return;
      setEnrollment(null);setCode("");setNotice("Código verificado. Actualizando el nivel de la sesión…");
      await retry();await load();
    });
  };
  const remove=(factor:Factor)=>run(async()=>{
    const version=generation.current;
    // Supabase is the authority: verified factors can only be removed at AAL2.
    const assurance=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if(assurance.error)throw assurance.error;
    if(factor.status==="verified"&&assurance.data.currentLevel!=="aal2")throw new Error("aal2_required");
    const result=await supabase.auth.mfa.unenroll({factorId:factor.id});
    if(result.error)throw result.error;
    // Unenroll only removes the factor. Session downgrade is mandatory even
    // when navigation/unmount has invalidated this page's local generation.
    try{
      const refresh=await supabase.auth.refreshSession();
      if(refresh.error)throw refresh.error;
    }catch{
      // A removed factor must not leave the old elevated token active in the UI.
      await logout();return;
    }
    await retry();
    if(version!==generation.current)return;
    setEnrollment(null);setCode("");await load();
    if(version===generation.current)setRemoving(null);
  });
  const verified=factors?.filter((factor)=>factor.status==="verified")??[];
  return <div className="page-stack">
    <AdminPageHeader title="Seguridad de la cuenta" description="Autenticación multifactor para operaciones administrativas sensibles."/>
    <section className="panel" aria-labelledby="mfa-title" aria-busy={busy}>
      <h2 id="mfa-title">Autenticador TOTP</h2>
      <p role="status">{security?.currentLevel==="aal2"?"Sesión verificada · AAL2":security?.currentLevel==="aal1"?"Sesión con contraseña · AAL1":"Nivel de seguridad pendiente de verificar"}</p>
      <p>La consulta y la configuración permanecen disponibles. Las operaciones sensibles requieren un código del autenticador.</p>
      {security?.error&&<p role="alert">{security.error}</p>}
      {error&&!removing&&<p role="alert">{error}</p>}
      {notice&&<p role="status">{notice}</p>}
      {factors===null&&!error&&<p role="status">Consultando autenticadores…</p>}
      {factors!==null&&<>
        {factors.length===0&&!enrollment&&<button disabled={busy} onClick={()=>void enroll()}>Configurar autenticador</button>}
        {enrollment&&<div>
          <p>Escanea el código QR o introduce la clave en tu aplicación. La clave se muestra solo durante esta configuración.</p>
          {enrollment.qr.startsWith("data:image/svg+xml;")&&<img width="220" height="220" src={enrollment.qr} alt="Código QR del autenticador"/>}
          <p>Clave de configuración: <code>{enrollment.secret}</code></p>
          <button disabled={busy} onClick={()=>void remove({id:enrollment.id,status:"unverified",factor_type:"totp"})}>Cancelar configuración</button>
        </div>}
        {!enrollment&&verified.length>0&&security?.currentLevel!=="aal2"&&<h3>Verifica tu autenticador</h3>}
        {!enrollment&&verified.length>1&&<label>Autenticador<select value={selected} disabled={busy} onChange={(event)=>setSelected(event.target.value)}>{verified.map((factor)=><option key={factor.id} value={factor.id}>{factor.friendly_name??factor.id}</option>)}</select></label>}
        {(enrollment||verified.length>0&&security?.currentLevel!=="aal2")&&<form onSubmit={verify}>
          <label>Código de 6 dígitos<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required value={code} disabled={busy} onChange={(event)=>setCode(event.target.value.replace(/\D/g,""))}/></label>
          <button disabled={busy||!/^\d{6}$/.test(code)} type="submit">Verificar código</button>
        </form>}
        {factors.length>0&&<ul>{factors.map((factor)=><li key={factor.id}>{factor.friendly_name??"Autenticador"} · {factor.status==="verified"?"Verificado":"Configuración pendiente"} <button disabled={busy||factor.status==="verified"&&security?.currentLevel!=="aal2"} onClick={()=>setRemoving(factor)}>Eliminar autenticador</button></li>)}</ul>}
      </>}
      <ConfirmDialog open={removing!==null} title="Eliminar autenticador" consequence="Tras eliminarlo, las operaciones sensibles requerirán configurar y verificar un autenticador." actionLabel="Confirmar eliminación" danger pending={busy} error={error} onCancel={()=>setRemoving(null)} onConfirm={()=>{if(removing)void remove(removing)}}/>
      <button className="secondary" disabled={busy} onClick={()=>void run(async()=>{await retry();await load()})}>Reintentar seguridad</button>
      <p>¿Perdiste el dispositivo? Contacta al operador autorizado para recuperar el acceso. No compartas tu contraseña ni tu clave de configuración.</p>
    </section>
    <section className="panel"><h2>Protección de contraseñas filtradas</h2><p>No verificada · Configuración externa de Supabase Auth.</p><p>Este portal no puede confirmar la opción del proyecto ni su disponibilidad en el plan. Un operador debe verificarla en la configuración oficial de Auth.</p></section>
  </div>;
}
