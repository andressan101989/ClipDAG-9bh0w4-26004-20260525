export type ControlCenterRange={from:string;to:string};
export type ControlCenterModule="users"|"content"|"stories"|"live"|"marketplace"|"finance"|"premium"|"ads"|"reports"|"activity";
export type ControlCenterMetric={key:string;label:string;value:number|string|null;unit:string;source:string;reason:string|null};
export type ControlCenterOverview={authority:"admin_control_center_v1";module:ControlCenterModule;from:string;to:string;timezone:"UTC";metrics:ControlCenterMetric[];series:Array<{day:string;value:number}>;recent:Array<{at:string;action:string;domain:string}>};
import {supabase} from "./supabase";
const dayMs=86400000;
const maxConcurrentOverviewReads=4;
type QueuedRead={start:()=>void};
const overviewReadQueue:QueuedRead[]=[];
let activeOverviewReads=0;
const abortError=()=>new DOMException("La consulta fue reemplazada","AbortError");
function drainOverviewReads(){
 while(activeOverviewReads<maxConcurrentOverviewReads){const next=overviewReadQueue.shift();if(!next)return;next.start()}
}
function scheduleOverviewRead<T>(read:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  let started=false,settled=false;
  const entry:QueuedRead={start:()=>{
   if(settled)return;
   signal?.removeEventListener("abort",onAbort);
   if(signal?.aborted){settled=true;reject(abortError());drainOverviewReads();return}
   started=true;activeOverviewReads++;
   Promise.resolve().then(read).then(resolve,reject).finally(()=>{settled=true;activeOverviewReads--;drainOverviewReads()});
  }};
  const onAbort=()=>{if(started||settled)return;settled=true;const index=overviewReadQueue.indexOf(entry);if(index>=0)overviewReadQueue.splice(index,1);reject(abortError())};
  if(signal?.aborted){settled=true;reject(abortError());return}
  signal?.addEventListener("abort",onAbort,{once:true});overviewReadQueue.push(entry);drainOverviewReads();
 });
}
function parseDay(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error("Fecha inválida");const date=new Date(`${value}T00:00:00Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new Error("Fecha inválida");return date.getTime()}
export function controlCenterRange(preset:string,from?:string,to?:string,now=new Date()):ControlCenterRange{
 if(preset!=="custom"){const days=({today:1,"7d":7,"30d":30,"90d":90} as Record<string,number>)[preset];if(!days)throw new Error("Periodo inválido");to=now.toISOString().slice(0,10);from=new Date(parseDay(to)-(days-1)*dayMs).toISOString().slice(0,10)}
 if(!from||!to)throw new Error("Selecciona ambas fechas");const span=parseDay(to)-parseDay(from);if(span<0||span>89*dayMs)throw new Error("El periodo debe incluir entre 1 y 90 días (UTC)");return {from,to};
}
const object=(value:unknown,keys?:string[]):Record<string,unknown>=>{if(keys&&value&&typeof value==="object"&&Object.keys(value).some(key=>!keys.includes(key)))throw new Error("Proyección inválida");if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Proyección inválida");return value as Record<string,unknown>};
const text=(value:unknown)=>{if(typeof value!=="string")throw new Error("Proyección inválida");return value};
const finite=(value:unknown)=>{if(typeof value!=="number"||!Number.isFinite(value))throw new Error("Proyección inválida");return value};
const array=(value:unknown)=>{if(!Array.isArray(value)||value.length>90)throw new Error("Proyección inválida");return value as unknown[]};
export async function getAdminControlCenterOverview(module:ControlCenterModule,range:ControlCenterRange,signal?:AbortSignal):Promise<ControlCenterOverview>{
 controlCenterRange("custom",range.from,range.to);
 const {data,error}=await scheduleOverviewRead(async()=>{
  const request=supabase.rpc("get_admin_control_center_overview_v1",{p_module:module,p_from:range.from,p_to:range.to});
  return signal?await request.abortSignal(signal):await request;
 },signal);
 if(error){const denied=error.code==="42501";throw Object.assign(new Error(denied?"Sin permiso del servidor":"No se pudo consultar esta fuente"),{code:error.code})}
 const root=object(data,["authority","module","from","to","timezone","metrics","series","recent"]);if(root.authority!=="admin_control_center_v1"||root.module!==module||root.from!==range.from||root.to!==range.to||root.timezone!=="UTC")throw new Error("Proyección inválida");
 const result:ControlCenterOverview={authority:"admin_control_center_v1",module,...range,timezone:"UTC",metrics:array(root.metrics).map(raw=>{const item=object(raw,["key","label","value","unit","source","reason"]),value=item.value;if(value!==null&&!(typeof value==="number"&&Number.isFinite(value))&&!(typeof value==="string"&&value.trim()&&Number.isFinite(Number(value))))throw new Error("Proyección inválida");const reason=item.reason===null?null:text(item.reason);if(value===null&&!reason)throw new Error("Proyección inválida");return {key:text(item.key),label:text(item.label),value:value as number|string|null,unit:text(item.unit),source:text(item.source),reason}}),series:array(root.series).map(raw=>{const row=object(raw,["day","value"]),day=text(row.day);if(!Number.isInteger(row.value)||Number(row.value)<0)throw new Error("Proyección inválida");parseDay(day);if(day<range.from||day>range.to)throw new Error("Proyección inválida");return {day,value:finite(row.value)}}),recent:array(root.recent).map(raw=>{const row=object(raw,["at","action","domain"]);return {at:text(row.at),action:text(row.action),domain:text(row.domain)}})};
 if(result.metrics.length>16||result.recent.length>8||new Set(result.metrics.map(row=>row.key)).size!==result.metrics.length||new Set(result.series.map(row=>row.day)).size!==result.series.length)throw new Error("Proyección inválida");
 return result;
}
