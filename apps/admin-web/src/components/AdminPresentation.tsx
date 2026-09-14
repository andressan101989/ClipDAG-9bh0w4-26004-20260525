/* eslint-disable react-refresh/only-export-components */
import {useEffect,useRef,type ReactNode} from "react";
import {Link} from "react-router-dom";
import {formatDate} from "../lib/adminApi";

export type AdminIdentityValue={id?:unknown;username?:unknown;display_name?:unknown;avatar_url?:unknown};
export const asRecord=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export const asRows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.filter((entry):entry is Record<string,unknown>=>entry!==null&&typeof entry==="object"&&!Array.isArray(entry)):[];
export const humanValue=(value:unknown,fallback="—")=>value===null||value===undefined||value===""?fallback:typeof value==="boolean"?(value?"Sí":"No"):String(value);
export const shortId=(value:unknown)=>typeof value==="string"&&value.length>12?`${value.slice(0,8)}…${value.slice(-4)}`:humanValue(value);
export const safeHttpsUrl=(value:unknown)=>typeof value==="string"&&/^https:\/\//i.test(value)?value:null;
export const humanBytes=(value:unknown)=>{const bytes=Number(value);if(!Number.isFinite(bytes)||bytes<0)return "—";if(bytes<1024)return `${bytes} B`;if(bytes<1024**2)return `${(bytes/1024).toFixed(1)} KB`;if(bytes<1024**3)return `${(bytes/1024**2).toFixed(1)} MB`;return `${(bytes/1024**3).toFixed(1)} GB`};
export const humanDuration=(value:unknown)=>{const ms=Number(value);if(!Number.isFinite(ms)||ms<0)return "—";const seconds=Math.round(ms/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`};

export function AdminIdentity({value,compact=false}:{value:AdminIdentityValue|Record<string,unknown>|null|undefined;compact?:boolean}){
  const identity=asRecord(value),name=humanValue(identity.display_name??identity.username,"Usuario"),username=identity.username?`@${String(identity.username)}`:shortId(identity.id),avatar=safeHttpsUrl(identity.avatar_url);
  return <span className={`entity-identity${compact?" compact":""}`}>{avatar?<img src={avatar} alt={`Avatar de ${name}`}/>:<i aria-hidden="true">{name.slice(0,2).toUpperCase()}</i>}<span><strong>{name}</strong><small>{username}</small></span></span>
}

export function AdminFactGrid({children,className=""}:{children:ReactNode;className?:string}){return <dl className={`admin-fact-grid ${className}`.trim()}>{children}</dl>}
export function AdminFact({label,value,mono=false}:{label:string;value:ReactNode;mono?:boolean}){return <div className="admin-fact"><dt>{label}</dt><dd className={mono?"mono":""}>{value??"—"}</dd></div>}

export function AdminEntityLink({to,id,label}:{to?:string;id:unknown;label?:string}){const body=<>{label&&<strong>{label}</strong>}<span className="mono">{shortId(id)}</span></>;return to?<Link className="entity-link" to={to}>{body}</Link>:<span className="entity-link">{body}</span>}

function isHls(url:string){return /\.m3u8(?:$|\?)/i.test(url)||/cloudflarestream\.com|videodelivery\.net/i.test(url)&&url.includes("m3u8")}
export function AdminVideoPreview({url,poster,alt="Video administrativo"}:{url:string;poster?:string|null;alt?:string}){
  const videoRef=useRef<HTMLVideoElement>(null);
  useEffect(()=>{const video=videoRef.current;if(!video||!isHls(url)||video.canPlayType("application/vnd.apple.mpegurl"))return;let disposed=false,hls:import("hls.js").default|null=null;void import("hls.js").then(({default:Hls})=>{if(disposed||!Hls.isSupported())return;hls=new Hls({enableWorker:true});hls.loadSource(url);hls.attachMedia(video)});return()=>{disposed=true;hls?.destroy()}},[url]);
  return <video ref={videoRef} className="admin-media-element" controls preload="metadata" poster={poster??undefined} aria-label={alt}>{!isHls(url)&&<source src={url}/>}Tu navegador no puede reproducir este video.</video>
}

export function AdminMediaPreview({url,poster,kind="image",alt="Vista previa",loading=false,error,onRetry,restricted=false}:{url?:string|null;poster?:string|null;kind?:string|null;alt?:string;loading?:boolean;error?:string|null;onRetry?:()=>void;restricted?:boolean}){
  const safe=safeHttpsUrl(url);
  if(loading)return <div className="admin-media-state" role="status"><span className="spinner"/>Preparando vista previa segura…</div>;
  if(error)return <div className="admin-media-state"><strong>Vista previa no disponible</strong><span>{error}</span>{onRetry&&<button className="secondary" onClick={onRetry}>Reintentar URL</button>}</div>;
  if(!safe)return <div className="admin-media-state"><strong>{restricted?"Vista previa restringida":"Sin vista previa"}</strong><span>{restricted?"Este asset es privado y no está vinculado a una superficie administrativa revisable.":"No existe una URL HTTPS segura para este contenido."}</span></div>;
  if(kind==="video")return <AdminVideoPreview url={safe} poster={safeHttpsUrl(poster)} alt={alt}/>;
  if(kind==="audio"||kind==="voice")return <audio className="admin-audio" controls preload="metadata" aria-label={alt}><source src={safe}/></audio>;
  return <img className="admin-media-element" src={safe} alt={alt}/>;
}

export function AdminTimeline({items}:{items:Array<{id:string;title:string;detail?:string;time?:unknown;status?:string}>}){return <div className="admin-timeline">{items.map((item)=><div key={item.id}><i aria-hidden="true"/><div><strong>{item.title}</strong>{item.detail&&<span>{item.detail}</span>}</div><div>{item.status&&<em className="badge">{item.status}</em>}<small>{formatDate(item.time)}</small></div></div>)}</div>}

export function AdminMessageBubble({message,reported=false,media}:{message:Record<string,unknown>;reported?:boolean;media?:ReactNode}){
  const sender=asRecord(message.sender);return <article className={`admin-message${reported?" reported":""}`}><AdminIdentity value={sender} compact/><div className="admin-message-body"><header><strong>{reported?"Mensaje reportado":humanValue(message.message_type,"Mensaje")}</strong><time>{formatDate(message.created_at)}</time></header>{message.text_excerpt?<p>{String(message.text_excerpt)}</p>:<p className="muted-text">{message.has_media===true?`Contenido ${humanValue(message.message_type,"multimedia")}`:"Sin texto visible"}</p>}{media}{message.audio_duration_ms!==null&&message.audio_duration_ms!==undefined?<small>Duración: {humanDuration(message.audio_duration_ms)}</small>:null}{message.hidden===true?<em className="badge warn">Oculto</em>:null}</div></article>
}

export function AdminStatusPanel({title,detail,tone="neutral"}:{title:string;detail:string;tone?:"neutral"|"success"|"warning"|"danger"}){return <div className={`admin-status-panel ${tone}`}><i aria-hidden="true"/><div><strong>{title}</strong><span>{detail}</span></div></div>}
