import {useEffect,useState} from "react";
import {Link,useParams} from "react-router-dom";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {
  AdminEntityLink,
  AdminFact,
  AdminFactGrid,
  AdminIdentity,
  AdminMediaPreview,
  AdminStatusPanel,
  asRecord,
  asRows,
  humanValue,
  safeHttpsUrl,
  shortId,
} from "../components/AdminPresentation";
import {EmptyState,ErrorState,LoadingState} from "../components/PageState";
import {
  formatDate,
  getAdminMediaUrl,
  getAdminStoryDetail,
  moderateAdminStory,
  searchAdminStories,
  type AdminStoryMediaOrigin,
  type AdminStorySummary,
} from "../lib/adminApi";

const trustedMediaOrigins=new Set<AdminStoryMediaOrigin>(["story_asset","shared_stream_asset","shared_r2_asset"]);
const canonicalR2Host="pub-d146e3d06d274db4871f5b6020fd850f.r2.dev";
const projectedUrl=(value:unknown,origin:AdminStoryMediaOrigin|null)=>{
  const safe=origin&&trustedMediaOrigins.has(origin)?safeHttpsUrl(value):null;
  if(!safe)return null;
  try{
    const parsed=new URL(safe),host=parsed.hostname.toLowerCase();
    if(parsed.username||parsed.password||parsed.port)return null;
    if(origin==="shared_stream_asset")return host.endsWith(".cloudflarestream.com")||host.endsWith(".videodelivery.net")?safe:null;
    return host===canonicalR2Host?safe:null;
  }catch{return null}
};
const mediaLabel=(value:unknown)=>value==="video"?"Video":value==="image"||value==="photo"?"Imagen":humanValue(value);
const storyKindLabel=(value:unknown)=>value==="shared"?"Compartida":"Directa";
const sourceStatusLabel=(value:unknown)=>value==="available"?"Disponible":value==="missing"?"Origen eliminado":"No disponible";
const finite=(value:unknown,min:number,max:number,fallback:number)=>{const parsed=Number(value);return Number.isFinite(parsed)?Math.min(max,Math.max(min,parsed)):fallback};

function StoryCompositionOverlay({value}:{value:Record<string,unknown>}){
  const elements=asRows(value.elements);
  if(elements.length===0)return null;
  return <div className="admin-story-composition-overlay" aria-label="Composición visual de la Story">
      {elements.map((element,index)=>{
        const type=element.type==="text"?"text":"sticker",x=finite(element.x,0,1,.5),y=finite(element.y,0,1,.5),scale=finite(element.scale,.5,4,1),rotation=finite(element.rotation,-180,180,0);
        const align=element.align==="left"||element.align==="right"?element.align:"center",color=typeof element.color==="string"&&/^#[0-9a-f]{6}$/i.test(element.color)?element.color:"#FFFFFF",size=element.size==="small"||element.size==="large"?element.size:"medium";
        return <span key={typeof element.id==="string"?element.id:`element-${index}`} className={`admin-story-overlay-element ${type} ${size}`} style={{left:`${x*100}%`,top:`${y*100}%`,transform:`translate(-50%, -50%) scale(${scale}) rotate(${rotation}deg)`,color,textAlign:align}}>{type==="text"?humanValue(element.text,"Texto"):humanValue(element.value,"Sticker")}</span>;
      })}
    </div>;
}

function StoryCompositionDetails({value}:{value:Record<string,unknown>}){
  const elements=asRows(value.elements);
  if(elements.length===0)return <p className="muted-text">Sin composición adicional.</p>;
  return <div className="admin-story-element-list">
      {elements.map((element,index)=>{
        const isText=element.type==="text";
        return <article key={typeof element.id==="string"?element.id:`fact-${index}`}>
          <header><strong>{isText?"Texto":"Emoji / sticker"}</strong><em className="badge">{index+1}</em></header>
          <p>{humanValue(isText?element.text:element.value)}</p>
          <small>Posición {Math.round(finite(element.x,0,1,0)*100)}% × {Math.round(finite(element.y,0,1,0)*100)}% · Escala {finite(element.scale,.5,4,1).toFixed(2)}× · Rotación {finite(element.rotation,-180,180,0)}°</small>
        </article>;
      })}
    </div>;
}

export function AdminStoriesPage(){
  const [query,setQuery]=useState(""),[visibility,setVisibility]=useState(""),[items,setItems]=useState<AdminStorySummary[]|null>(null),[error,setError]=useState<string|null>(null),[nonce,setNonce]=useState(0);
  useEffect(()=>{let active=true;setItems(null);setError(null);void searchAdminStories({query,visibility}).then((page)=>{if(active)setItems(page.items)}).catch((reason)=>{if(active)setError(reason instanceof Error?reason.message:"Error")});return()=>{active=false}},[query,visibility,nonce]);
  return <>
    <div className="page-heading"><div><p className="eyebrow">TRUST &amp; SAFETY</p><h2>Stories</h2><p>Inspección segura de media directa, contenido compartido y moderación reversible.</p></div></div>
    <div className="filters"><label className="search"><span>⌕</span><input aria-label="Buscar Stories" placeholder="ID o autor" value={query} onChange={(event)=>setQuery(event.target.value)}/></label><select aria-label="Visibilidad de Story" value={visibility} onChange={(event)=>setVisibility(event.target.value)}><option value="">Toda visibilidad</option><option value="visible">Visible</option><option value="hidden">Oculta</option></select></div>
    {error?<ErrorState message={error} onRetry={()=>setNonce((value)=>value+1)}/>:!items?<LoadingState label="Buscando Stories…"/>:items.length===0?<EmptyState title="Sin Stories" detail="No hay Stories para estos filtros."/>:<section className="table-panel"><table className="human-table"><thead><tr><th>Preview</th><th>Story</th><th>Autor</th><th>Origen</th><th>Reportes</th><th>Expira</th><th>Estado</th><th>Creada</th></tr></thead><tbody>{items.map((story)=>{const preview=story.source_status==="available"?projectedUrl(story.preview_url,story.media_origin):null;return <tr key={story.id}><td><Link className={`admin-media-thumb ${story.resolved_media_kind??story.media_type}`} to={`/stories/${story.id}`} aria-label="Abrir Story">{preview?<img src={preview} alt="Vista previa de la Story"/>:<span>{mediaLabel(story.resolved_media_kind??story.media_type)}</span>}</Link></td><td><Link to={`/stories/${story.id}`}><strong>{storyKindLabel(story.story_kind)}</strong><small>{mediaLabel(story.resolved_media_kind??story.media_type)} · {shortId(story.id)}</small></Link></td><td><AdminIdentity value={story.owner} compact/></td><td><em className={`badge ${story.source_status==="available"?"success":"warn"}`}>{sourceStatusLabel(story.source_status)}</em>{story.shared_content_type?<small className="table-secondary">{story.shared_content_type}</small>:null}{story.shared_video_id?<small className="table-secondary mono">{shortId(story.shared_video_id)}</small>:null}</td><td>{story.report_count>0?<em className="badge warn">{story.report_count}</em>:"0"}</td><td>{formatDate(story.expires_at)}</td><td><em className={`badge ${story.visibility==="hidden"?"warn":"success"}`}>{story.visibility==="hidden"?"Oculta":"Visible"}</em></td><td>{formatDate(story.created_at)}</td></tr>})}</tbody></table></section>}
  </>;
}

export function AdminStoryDetailPage(){
  const {id=""}=useParams(),{hasCapability}=useAdminAuth();
  const [detail,setDetail]=useState<Awaited<ReturnType<typeof getAdminStoryDetail>>|null>(null),[reason,setReason]=useState(""),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[nonce,setNonce]=useState(0),[mediaUrl,setMediaUrl]=useState<string|null>(null),[mediaError,setMediaError]=useState<string|null>(null),[mediaNonce,setMediaNonce]=useState(0),[mediaLoading,setMediaLoading]=useState(false);
  useEffect(()=>{let active=true;setDetail(null);setError(null);void getAdminStoryDetail(id).then((value)=>{if(active)setDetail(value)}).catch((reason)=>{if(active)setError(reason instanceof Error?reason.message:"Error")});return()=>{active=false}},[id,nonce]);
  const origin=detail?.media_origin??null,projectedMedia=projectedUrl(detail?.media_url,origin),poster=projectedUrl(detail?.poster_url,origin),assetId=origin==="story_asset"&&typeof detail?.media_asset_id==="string"?detail.media_asset_id:null;
  useEffect(()=>{if(!assetId||projectedMedia){setMediaUrl(projectedMedia);setMediaError(null);setMediaLoading(false);return}let active=true;setMediaLoading(true);setMediaError(null);void getAdminMediaUrl(assetId,{surface:"story",entityId:id}).then((url)=>{if(active)setMediaUrl(url)}).catch((reason)=>{if(active)setMediaError(reason instanceof Error?reason.message:"No se pudo abrir la Story")}).finally(()=>{if(active)setMediaLoading(false)});return()=>{active=false}},[assetId,projectedMedia,id,mediaNonce]);
  const visibility=detail?.visibility==="hidden"?"hidden":"visible",action=visibility==="hidden"?"restore":"hide";
  const run=async()=>{if(reason.trim().length<2)return setError("Indica un motivo de al menos 2 caracteres.");setBusy(true);setError(null);try{await moderateAdminStory({id,action,reason:reason.trim(),idempotencyKey:crypto.randomUUID()});setReason("");setNonce((value)=>value+1)}catch(cause){setError(cause instanceof Error?cause.message:"No se pudo moderar la Story")}finally{setBusy(false)}};
  if(error&&!detail)return <ErrorState message={error} onRetry={()=>setNonce((value)=>value+1)}/>;
  if(!detail)return <LoadingState label="Cargando Story…"/>;
  const owner=asRecord(detail.owner),source=detail.source,composition=asRecord(detail.composition),sourceUnavailable=detail.source_status!=="available";
  return <>
    <div className="page-heading"><div><p className="eyebrow">STORY · {storyKindLabel(detail.story_kind).toUpperCase()}</p><h2>{mediaLabel(detail.resolved_media_kind??detail.media_type)}</h2><p className="mono">{id}</p></div><div className="button-row"><em className={`badge ${visibility==="hidden"?"warn":"success"}`}>{visibility==="hidden"?"Oculta":"Visible"}</em>{detail.expired?<em className="badge warn">Expirada</em>:<em className="badge success">Activa</em>}</div></div>
    <div className="presentation-grid"><div className="presentation-stack">
      <section className="presentation-card"><header><h3>Vista previa para moderación</h3><em className={`badge ${sourceUnavailable?"warn":"success"}`}>{sourceStatusLabel(detail.source_status)}</em></header>{sourceUnavailable?<AdminStatusPanel title={detail.story_kind==="shared"?"Contenido de origen no disponible":"Media de Story no disponible"} detail={detail.story_kind==="shared"?"La referencia se conserva para investigación, pero el video canónico o su media autorizada ya no puede resolverse.":"La Story no tiene un asset canónico listo y revisable."} tone="warning"/>:<div className="admin-media-frame admin-story-stage"><AdminMediaPreview url={mediaUrl} poster={poster} kind={detail.resolved_media_kind??detail.media_type} alt="Vista previa administrativa de la Story" loading={mediaLoading} error={mediaError} onRetry={()=>setMediaNonce((value)=>value+1)} restricted={!projectedMedia&&!!assetId}/><StoryCompositionOverlay value={composition}/></div>}</section>
      <section className="presentation-card"><header><h3>Composición publicada</h3><span className="muted-text">Versión {humanValue(composition.version)}</span></header><StoryCompositionDetails value={composition}/></section>
      {source?<section className="presentation-card"><header><h3>Contenido de origen</h3><em className={`badge ${source.visibility==="hidden"?"warn":"success"}`}>{source.visibility==="hidden"?"Oculto":"Visible"}</em></header><AdminIdentity value={source.owner}/><p>{humanValue(source.caption,"Sin caption")}</p><AdminFactGrid><AdminFact label="Contenido" value={<AdminEntityLink to={`/content/video/${source.id}`} id={source.id}/>}/><AdminFact label="Tipo" value={humanValue(source.content_type)}/><AdminFact label="Creado" value={formatDate(source.created_at)}/><AdminFact label="Vistas" value={source.views_count}/><AdminFact label="Likes" value={source.likes_count}/><AdminFact label="Comentarios" value={source.comments_count}/><AdminFact label="Compartidos" value={source.shares_count}/></AdminFactGrid></section>:null}
    </div><aside className="presentation-stack">
      <section className="presentation-card"><header><h3>Autor</h3></header><AdminIdentity value={owner}/></section>
      <section className="presentation-card"><header><h3>Información</h3></header><AdminFactGrid><AdminFact label="Tipo" value={storyKindLabel(detail.story_kind)}/><AdminFact label="Media declarada" value={mediaLabel(detail.media_type)}/><AdminFact label="Media resuelta" value={mediaLabel(detail.resolved_media_kind)}/><AdminFact label="Origen" value={humanValue(detail.media_origin)}/><AdminFact label="Creada" value={formatDate(detail.created_at)}/><AdminFact label="Expira" value={formatDate(detail.expires_at)}/><AdminFact label="Visibilidad" value={visibility==="hidden"?"Oculta":"Visible"}/><AdminFact label="Story ID" value={shortId(detail.id)} mono/>{detail.shared_video_id?<AdminFact label="Video compartido" value={shortId(detail.shared_video_id)} mono/>:null}{detail.shared_content_type?<AdminFact label="Contenido compartido" value={humanValue(detail.shared_content_type)}/>:null}{detail.linked_media_asset_id?<AdminFact label="Asset vinculado" value={shortId(detail.linked_media_asset_id)} mono/>:null}</AdminFactGrid></section>
      <section className="presentation-card"><header><h3>Reportes</h3>{detail.reports.pending>0?<em className="badge warn">Revisión pendiente</em>:null}</header><AdminFactGrid><AdminFact label="Total" value={detail.reports.total}/><AdminFact label="Pendientes" value={detail.reports.pending}/><AdminFact label="Último reporte" value={formatDate(detail.reports.last_reported_at)}/></AdminFactGrid></section>
    </aside></div>
    {hasCapability("stories.items.moderate")&&<section className="detail-card"><h3>{action==="hide"?"Ocultar":"Restaurar"} Story</h3><textarea aria-label="Motivo" placeholder="Motivo obligatorio" value={reason} onChange={(event)=>setReason(event.target.value)}/><div className="button-row"><button className={action==="hide"?"danger":""} disabled={busy} onClick={()=>void run()}>{action==="hide"?"Ocultar Story":"Restaurar Story"}</button></div>{error&&<p role="alert">{error}</p>}<small>La expiración, media, contenido de origen y propiedad no se modifican.</small></section>}
  </>;
}
