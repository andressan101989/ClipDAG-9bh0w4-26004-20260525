import {useEffect,useRef,useState} from "react";
import {Link} from "react-router-dom";
import {AdminChartPanel,AdminDateRangeFilter,AdminFilterBar,AdminPageHeader,AdminStatCard} from "../components/AdminControlCenter";
import {EmptyState,ErrorState,LoadingState} from "../components/PageState";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {controlCenterRange,getAdminControlCenterOverview,type ControlCenterModule,type ControlCenterOverview,type ControlCenterRange} from "../lib/adminControlCenterApi";
import {getAdminPlatformRevenue,getAdminSystemHealth} from "../lib/adminObservabilityApi";
const modules:Array<{id:ControlCenterModule;title:string;cap:string;to:string;chart?:string}>=[
 {id:"users",title:"Usuarios",cap:"users.accounts.read",to:"/users",chart:"Usuarios por día"},
 {id:"content",title:"Contenido",cap:"content.items.read",to:"/content",chart:"Publicaciones por día"},
 {id:"stories",title:"Stories",cap:"stories.items.read",to:"/stories"},
 {id:"live",title:"LIVE",cap:"live.sessions.read",to:"/live"},
 {id:"marketplace",title:"Marketplace",cap:"marketplace.overview.read",to:"/marketplace"},
 {id:"finance",title:"Finanzas",cap:"finance.ledger.read",to:"/finance"},
 {id:"premium",title:"Premium",cap:"finance.ledger.read",to:"/finance/creator-premium"},
 {id:"ads",title:"Publicidad",cap:"advertising.ads.read",to:"/advertising"},
 {id:"reports",title:"Alertas prioritarias",cap:"reports.cases.read",to:"/reports"},
 {id:"activity",title:"Actividad reciente",cap:"admin.audit.read",to:"/audit"},
];
type ReadState={status:"loading"|"ready"|"failed"|"denied";data?:ControlCenterOverview};
function ModuleSummary({module,range}:{module:typeof modules[number];range:ControlCenterRange}){
 const {hasCapability}=useAdminAuth(),allowed=hasCapability(module.cap),key=JSON.stringify([range,allowed]),[nonce,setNonce]=useState(0),[result,setResult]=useState<{key:string;state:ReadState}|null>(null);
 const requestKey=JSON.stringify([key,nonce]),requestRef=useRef(requestKey);requestRef.current=requestKey;
 useEffect(()=>{let active=true;if(!allowed)return;const controller=new AbortController();void getAdminControlCenterOverview(module.id,range,controller.signal).then(data=>{if(active&&requestRef.current===requestKey)setResult({key:requestKey,state:{status:"ready",data}})}).catch(reason=>{if(controller.signal.aborted||reason?.name==="AbortError")return;if(active&&requestRef.current===requestKey)setResult({key:requestKey,state:{status:reason?.code==="42501"?"denied":"failed"}})});return()=>{active=false;controller.abort()}},[requestKey,allowed,module.id,range]);
 const state:ReadState=!allowed?{status:"denied"}:result?.key===requestKey?result.state:{status:"loading"},data=state.data;
 return <section className="detail-card" role="region" aria-label={module.title}><div className="panel-title"><h2>{module.title}</h2>{allowed&&<Link to={module.to}>Abrir {module.title}</Link>}</div>
 {state.status==="denied"?<p>Sin permiso para esta fuente.</p>:state.status==="failed"?<ErrorState message="No se pudo consultar esta fuente. Los demás módulos conservan su estado." onRetry={()=>setNonce(n=>n+1)}/>:!data?<LoadingState label={`Consultando ${module.title}…`}/>:<>
 <div className="admin-module-kpis">{data.metrics.map(metric=><AdminStatCard key={metric.key} label={metric.label} value={metric.value===null?"No disponible":`${metric.value}${metric.unit==="BDAG"?" BDAG":""}`} detail={`${metric.source}${metric.reason?` · ${metric.reason}`:""}`}/>)}</div>
 {module.chart&&(data.series.length?<AdminChartPanel title={module.chart} description="Altas en el periodo seleccionado, días UTC. Fuente canónica agregada por el servidor." data={data.series.map(row=>({label:row.day,value:row.value}))} valueLabel="Registros"/>:<EmptyState title="Sin actividad en el periodo" detail="La fuente no devuelve buckets para estas fechas."/>)}
 {module.id==="activity"&&(data.recent.length?<table className="human-table"><caption>Últimas 8 acciones visibles, sin identidades ni destinos</caption><thead><tr><th>Fecha UTC</th><th>Acción</th><th>Dominio</th></tr></thead><tbody>{data.recent.map((row,index)=><tr key={index}><td>{row.at}</td><td>{row.action}</td><td>{row.domain}</td></tr>)}</tbody></table>:<EmptyState title="Sin actividad visible" detail="No hay acciones autorizadas en el periodo."/>)}
 </>}
 </section>;
}
function SystemSummary(){
 const {hasCapability}=useAdminAuth(),allowed=hasCapability("system.health.read"),[nonce,setNonce]=useState(0),[state,setState]=useState<{value?:Record<string,unknown>;error?:"failed"|"denied"}|null>(null);
 useEffect(()=>{if(!allowed)return;let active=true;setState(null);void getAdminSystemHealth().then(value=>{if(active)setState({value})}).catch(reason=>{if(active)setState({error:reason?.code==="42501"?"denied":"failed"})});return()=>{active=false}},[allowed,nonce]);
 const cron=state?.value?.cron as Record<string,unknown>|undefined;
 return <section className="detail-card" aria-label="Salud del sistema"><h2>Salud del sistema</h2>{!allowed?<p>Sin permiso para esta fuente.</p>:state?.error==="denied"?<p>Sin permiso para esta fuente.</p>:state?.error?<ErrorState message="No se pudo consultar salud del sistema" onRetry={()=>setNonce(n=>n+1)}/>:!state?<LoadingState/>:<><AdminStatCard label="Jobs sin éxito (24 h)" value={typeof cron?.non_successes_24h==="number"?cron.non_successes_24h:"No disponible"} detail="get_admin_system_health · ventana propia de 24 horas; no usa el filtro de fechas"/><Link to="/system">Abrir salud del sistema</Link></>}</section>;
}
function CanonicalRevenueSummary(){
 const {hasCapability}=useAdminAuth(),allowed=hasCapability("finance.ledger.read"),[nonce,setNonce]=useState(0),[result,setResult]=useState<{value:unknown;error:"failed"|"denied"|null}|null>(null);
 useEffect(()=>{if(!allowed)return;let active=true;setResult(null);void getAdminPlatformRevenue("today").then(data=>{if(active){const rows=Array.isArray(data.summary)?data.summary:[],bdag=rows.find(row=>row&&typeof row==="object"&&(row as Record<string,unknown>).currency==="BDAG") as Record<string,unknown>|undefined;setResult({value:bdag?.net_revenue,error:null})}}).catch(reason=>{if(active)setResult({value:null,error:reason?.code==="42501"?"denied":"failed"})});return()=>{active=false}},[allowed,nonce]);
 const value=result?.value,available=value!==null&&value!==undefined&&(typeof value==="number"||typeof value==="string"&&value.trim()!=="")&&Number.isFinite(Number(value));
 return <section className="detail-card" aria-label="Ingresos reconocidos"><h2>Ingresos reconocidos</h2>{!allowed?<p>Sin permiso para esta fuente.</p>:!result?<LoadingState label="Consultando ingresos reconocidos…"/>:result.error==="denied"?<p>Sin permiso para esta fuente.</p>:result.error?<ErrorState message="No se pudo consultar ingresos reconocidos" onRetry={()=>setNonce(n=>n+1)}/>:<><AdminStatCard label="Ingresos reconocidos hoy (UTC)" value={available?`${value} BDAG`:"No disponible"} detail="get_admin_platform_revenue(today) · fuentes económicas canónicas, separado de volumen y saldo"/><p>Ventana propia de hoy; no usa el filtro de fechas del dashboard.</p><Link to="/finance">Abrir ingresos, fuentes y reconciliación</Link></>}</section>;
}
export function AdminOverviewPage(){
 const [preset,setPreset]=useState("30d"),[range,setRange]=useState(()=>controlCenterRange("30d")),[from,setFrom]=useState(range.from),[to,setTo]=useState(range.to),[error,setError]=useState<string|null>(null);
 const select=(value:string)=>{setPreset(value);setError(null);if(value!=="custom"){const next=controlCenterRange(value);setRange(next);setFrom(next.from);setTo(next.to)}};
 const apply=()=>{try{setRange(controlCenterRange("custom",from,to));setError(null)}catch(reason){setError(reason instanceof Error?reason.message:"Fechas inválidas")}};
 return <div className="admin-overview"><AdminPageHeader eyebrow="CONTROL CENTER" title="Dashboard ejecutivo" description="Lectura de fuentes canónicas. Las métricas muestran su origen; ausencia de autoridad nunca equivale a cero."/>
 <AdminFilterBar label="Fechas del dashboard" onSubmit={apply}><AdminDateRangeFilter label="Periodo" value={preset} onChange={select} options={[{value:"today",label:"Hoy"},{value:"7d",label:"7 días"},{value:"30d",label:"30 días"},{value:"90d",label:"90 días"},{value:"custom",label:"Personalizado"}]}/>{preset==="custom"&&<><label>Desde (UTC)<input aria-label="Desde (UTC)" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta (UTC)<input aria-label="Hasta (UTC)" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button type="submit">Aplicar fechas</button></>}</AdminFilterBar>
 <p role="status">{range.from} → {range.to} · UTC · máximo 90 días, ambos días incluidos</p>{error&&<p role="alert">{error}</p>}
 <div className="detail-grid">{modules.map(module=><ModuleSummary key={module.id} module={module} range={range}/>)}<CanonicalRevenueSummary/><SystemSummary/></div>
 </div>;
}
