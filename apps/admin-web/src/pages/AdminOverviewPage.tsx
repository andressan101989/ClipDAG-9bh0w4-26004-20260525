import {useEffect,useMemo,useState} from "react";
import {Link} from "react-router-dom";
import globe from "../assets/figma-electric-blue-globe.svg";
import {AdminMetricCard,AdminPanel,AdminStatusBadge} from "../components/AdminDashboard";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {formatDate,getOverview,type Overview} from "../lib/adminApi";
import {searchActivity} from "../lib/adminIntelligenceApi";
import {getAdminFinanceOverview,getAdminSystemHealth,searchAdminGlobalAudit,searchAdminSystemJobs,type JsonRecord} from "../lib/adminObservabilityApi";

type DashboardState={marketplace?:Overview;finance?:JsonRecord;health?:JsonRecord;audit?:JsonRecord[];jobs?:JsonRecord[];errors:string[]};
const record=(value:unknown):JsonRecord=>value&&typeof value==="object"&&!Array.isArray(value)?value as JsonRecord:{};
const list=(value:unknown)=>Array.isArray(value)?value.filter((item):item is JsonRecord=>!!item&&typeof item==="object"&&!Array.isArray(item)):[];
const value=(input:unknown)=>typeof input==="number"||typeof input==="string"?String(input):"No disponible";
const actor=(row:JsonRecord)=>{const identity=record(row.actor);return value(identity.display_name??identity.username??row.actor_display_name??row.actor_username??row.actor_kind??"system")};

export function AdminOverviewPage(){
  const {admin,hasCapability}=useAdminAuth();
  const [state,setState]=useState<DashboardState>({errors:[]});
  const capabilities=admin?.capabilities.join("|")??"";
  useEffect(()=>{let active=true;const tasks:Array<Promise<[keyof DashboardState,unknown]>>=[];
    if(hasCapability("marketplace.overview.read"))tasks.push(getOverview("30d").then((data)=>["marketplace",data]));
    if(hasCapability("finance.ledger.read"))tasks.push(getAdminFinanceOverview().then((data)=>["finance",data]));
    if(hasCapability("system.health.read"))tasks.push(getAdminSystemHealth().then((data)=>["health",data]));
    if(hasCapability("system.jobs.read"))tasks.push(searchAdminSystemJobs({p_limit:5}).then((data)=>["jobs",list(data.items)]));
    if(hasCapability("admin.audit.read"))tasks.push(searchAdminGlobalAudit({p_limit:5}).then((data)=>["audit",data.items]));
    else if(hasCapability("marketplace.audit.read"))tasks.push(searchActivity({limit:5}).then((data)=>["audit",data.items]));
    void Promise.allSettled(tasks).then((results)=>{if(!active)return;const next:DashboardState={errors:[]};for(const result of results){if(result.status==="fulfilled"){const [key,data]=result.value;(next as Record<string,unknown>)[key]=data}else next.errors.push(result.reason instanceof Error?result.reason.message:"No se pudo consultar un módulo")};setState(next)});return()=>{active=false};
  },[capabilities,hasCapability]);
  const health=record(state.health),cron=record(health.cron),liveBattles=record(health.live_battles),finance=record(state.finance),metrics=useMemo(()=>{
    const rows:Array<{label:string;value:string;detail:string;icon:Parameters<typeof AdminMetricCard>[0]["icon"]}>=[];
    if(state.marketplace)rows.push({label:"Marketplace Orders",value:value(state.marketplace.commerce.orders),detail:"últimos 30 días",icon:"marketplace"});
    if(state.finance){rows.push({label:"Financial Transactions",value:value(finance.financial_transaction_count),detail:"registro canónico",icon:"finance"});rows.push({label:"Ledger Accounts",value:value(finance.ledger_account_count),detail:"cuentas canónicas",icon:"finance"})}
    if(state.health){rows.push({label:"Live Sessions",value:value(liveBattles.active_live_sessions),detail:"activas ahora",icon:"live"});rows.push({label:"Battles",value:value(liveBattles.open_battles),detail:"abiertas ahora",icon:"battles"});rows.push({label:"System Jobs",value:`${value(cron.active_jobs)} / ${value(cron.total_jobs)}`,detail:"jobs activos",icon:"system"})}
    return rows;
  },[state.marketplace,state.finance,state.health,finance,liveBattles,cron]);
  const snapshot=state.marketplace?[{label:"Pedidos",count:state.marketplace.commerce.orders},{label:"Pagados",count:state.marketplace.commerce.paid_orders},{label:"Envíos pendientes",count:state.marketplace.commerce.pending_fulfillment},{label:"Disputas",count:state.marketplace.operations.open_disputes},{label:"Productos con atención",count:state.marketplace.products.requiring_attention}]:state.finance?list(finance.transactions_by_status).map((item)=>({label:value(item.status),count:Number(item.count)||0})):[];
  const max=Math.max(1,...snapshot.map((item)=>item.count));
  const keyMetrics=state.marketplace?[{label:"Vendedores",value:state.marketplace.sellers.approved},{label:"Tiendas activas",value:state.marketplace.sellers.active_stores},{label:"Productos",value:state.marketplace.products.active_published},{label:"Pedidos con creador",value:state.marketplace.creator_commerce.attributed_orders},{label:"Reportes",value:"No disponible"}]:state.finance?[{label:"Cuentas",value:value(finance.ledger_account_count)},{label:"Entradas ledger",value:value(finance.ledger_entry_count)},{label:"Cuentas frozen",value:value(finance.frozen_account_count)},{label:"Settlements",value:value(finance.marketplace_settlement_count)},{label:"Refunds",value:value(finance.marketplace_refund_count)}]:[];
  const audit=state.audit??[],jobs=state.jobs??[];
  return <div className="admin-overview">
    <section className="dashboard-hero"><div><p>ADMIN DASHBOARD</p><h2>Good to see you</h2><span>Control operativo de la plataforma en un solo lugar.</span></div><div className="hero-status"><small>Authority contract</small><AdminStatusBadge tone="success">v{admin?.authority_version.slice(0,8)??"—"}</AdminStatusBadge></div><div className="hero-globe"><img alt="" src={globe}/><span/><span/><span/><span/><span/><span/></div></section>
    {state.errors.length>0&&<p className="dashboard-notice" role="status">Algunos módulos autorizados no están disponibles. Los demás datos permanecen operativos.</p>}
    {metrics.length>0?<section className="dashboard-metrics">{metrics.map((item)=><AdminMetricCard {...item} key={item.label}/>)}</section>:<section className="dashboard-empty">No hay métricas adicionales autorizadas para este acceso.</section>}
    <div className="dashboard-main-grid">
      <AdminPanel title="Platform Activity" aside={<span>Snapshot actual</span>} className="activity-panel">{snapshot.length?<div className="activity-bars" role="img" aria-label="Distribución operativa actual">{snapshot.map((item)=><div key={item.label}><span>{item.label}</span><i><b style={{width:`${Math.max(3,item.count/max*100)}%`}}/></i><strong>{item.count}</strong></div>)}</div>:<div className="dashboard-panel-empty">No disponible para las capabilities actuales.</div>}</AdminPanel>
      <AdminPanel title="Key Metrics"><div className="key-metrics">{keyMetrics.length?keyMetrics.map((item)=><div key={item.label}><span className="dashboard-icon mini"/><span>{item.label}</span><strong>{item.value}</strong><i className={item.value==="No disponible"?"muted":""}/></div>):<div className="dashboard-panel-empty">No disponible</div>}</div></AdminPanel>
      <AdminPanel title="System Health"><div className="health-facts">{state.health?<><AdminStatusBadge tone={Number(cron.non_successes_24h)===0?"success":"warning"}>Operational signals</AdminStatusBadge><div><span>Cron jobs</span><strong>{value(cron.active_jobs)} / {value(cron.total_jobs)} active</strong></div><div><span>Runs 24h</span><strong>{value(cron.runs_24h)}</strong></div><div><span>Non-success 24h</span><strong>{value(cron.non_successes_24h)}</strong></div><div><span>Active LIVE</span><strong>{value(liveBattles.active_live_sessions)}</strong></div><div><span>Open Battles</span><strong>{value(liveBattles.open_battles)}</strong></div></>:<div className="dashboard-panel-empty">No autorizado</div>}</div></AdminPanel>
    </div>
    <div className="dashboard-bottom-grid">
      <AdminPanel title="Recent Admin Actions" aside={hasCapability("admin.audit.read")?<Link to="/audit">View all</Link>:hasCapability("marketplace.audit.read")?<Link to="/marketplace/activity">View all</Link>:undefined}><div className="compact-table"><div className="compact-table-head"><span>TIME</span><span>ADMIN</span><span>ACTION</span><span>TARGET</span><span>DOMAIN</span></div>{audit.length?audit.map((row)=><div className="compact-table-row" key={value(row.id)}><span>{formatDate(row.created_at)}</span><span>{actor(row)}</span><span>{value(row.action)}</span><span>{value(row.target_type)} · {value(row.target_id).slice(0,8)}</span><span>{value(row.domain??"marketplace")}</span></div>):<div className="dashboard-panel-empty">No hay acciones visibles.</div>}</div></AdminPanel>
      <AdminPanel title="Recent System Events"><div className="system-events">{jobs.length?jobs.map((job)=>{const last=record(job.last_run);return <div key={value(job.job_id)}><span className={`event-dot ${last.status==="succeeded"?"success":"warning"}`}/><strong>{value(job.job_name)}</strong><span>{value(last.status)}</span><small>{formatDate(last.started_at)}</small></div>}):<div className="dashboard-panel-empty">No hay eventos autorizados.</div>}</div></AdminPanel>
    </div>
    <footer className="dashboard-footer"><strong><i/>ONSPACE</strong><span>BUILD A MORE OPEN CREATOR ECONOMY</span><span>Production</span></footer>
  </div>
}
