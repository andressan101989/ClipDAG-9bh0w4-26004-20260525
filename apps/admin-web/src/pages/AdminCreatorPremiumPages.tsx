import {useEffect,useMemo,useRef,useState} from "react";
import {Link,useParams} from "react-router-dom";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminFact,AdminFactGrid,AdminIdentity,AdminMediaPreview,asRecord,asRows,humanValue,shortId} from "../components/AdminPresentation";
import {EmptyState,ErrorState,LoadingState} from "../components/PageState";
import {
  formatBdag,formatDate,getAdminCreatorPremiumContent,getAdminCreatorPremiumImageGrant,
  getAdminCreatorPremiumRefundCandidates,getAdminCreatorPremiumVideoGrant,
  refundAdminCreatorPremiumPurchase,refundAdminCreatorPremiumSubscriptionPeriod,
  reviewAdminCreatorPremiumContent,searchAdminCreatorPremiumContent,
  type AdminCreatorPremiumSummary,
} from "../lib/adminApi";

const statusLabels:Record<string,string>={
  pending_review:"En revisión",published:"Publicado",rejected:"Rechazado",
  quarantined:"Cuarentena",removed:"Retirado",
};
const statusLabel=(value:unknown)=>typeof value==="string"?(statusLabels[value]??value):"—";
const text=(value:unknown)=>typeof value==="string"?value:"";
const bool=(value:unknown)=>value===true;

export function AdminCreatorPremiumPage(){
  const [status,setStatus]=useState("pending_review"),[query,setQuery]=useState(""),[items,setItems]=useState<AdminCreatorPremiumSummary[]|null>(null),[nextCursor,setNextCursor]=useState<Awaited<ReturnType<typeof searchAdminCreatorPremiumContent>>["next_cursor"]>(null),[loadingMore,setLoadingMore]=useState(false),[error,setError]=useState<string|null>(null),[nonce,setNonce]=useState(0);
  const queueRequestGeneration=useRef(0),statusRef=useRef(status),queryRef=useRef(query);
  statusRef.current=status;
  queryRef.current=query;
  useEffect(()=>{
    let active=true;
    const request=++queueRequestGeneration.current;
    setItems(null);setNextCursor(null);setLoadingMore(false);setError(null);
    void searchAdminCreatorPremiumContent({status:status||null,query})
      .then((page)=>{if(active&&request===queueRequestGeneration.current){setItems(page.items);setNextCursor(page.next_cursor)}})
      .catch((cause)=>{if(active&&request===queueRequestGeneration.current)setError(cause instanceof Error?cause.message:"No se pudo cargar la cola")});
    return()=>{active=false;queueRequestGeneration.current+=1};
  },[status,query,nonce]);
  const loadMore=async()=>{
    if(!nextCursor||loadingMore)return;
    const request=++queueRequestGeneration.current;
    const requestedStatus=status;
    const requestedQuery=query;
    const cursor=nextCursor;
    const isCurrent=()=>request===queueRequestGeneration.current&&requestedStatus===statusRef.current&&requestedQuery===queryRef.current;
    setLoadingMore(true);setError(null);
    try{
      const page=await searchAdminCreatorPremiumContent({status:requestedStatus||null,query:requestedQuery,cursor});
      if(!isCurrent())return;
      setItems((current)=>{const existing=new Set((current??[]).map((item)=>item.id));return[...(current??[]),...page.items.filter((item)=>!existing.has(item.id))]});
      setNextCursor(page.next_cursor);
    }catch(cause){if(isCurrent())setError(cause instanceof Error?cause.message:"No se pudo cargar más contenido")}
    finally{if(isCurrent())setLoadingMore(false)}
  };
  return <><div className="page-heading"><div><p className="eyebrow">CREATOR PREMIUM</p><h2>Revisión Premium</h2><p>Moderación humana, publicación canónica y media privada temporal.</p></div></div><div className="filters"><label className="search"><span>⌕</span><input aria-label="Buscar Creator Premium" placeholder="Título, creador o ID" value={query} onChange={(event)=>setQuery(event.target.value)}/></label><select aria-label="Estado Premium" value={status} onChange={(event)=>setStatus(event.target.value)}><option value="">Todos</option><option value="pending_review">En revisión</option><option value="published">Publicado</option><option value="rejected">Rechazado</option><option value="quarantined">Cuarentena</option><option value="removed">Retirado</option></select></div>{error&&items?<ErrorState message={error} onRetry={()=>setNonce((value)=>value+1)}/>:null}{error&&!items?<ErrorState message={error} onRetry={()=>setNonce((value)=>value+1)}/>:!items?<LoadingState label="Cargando revisión Premium…"/>:items.length===0?<EmptyState title="Sin contenido Premium" detail="No hay elementos para los filtros actuales."/>:<section className="table-panel"><table className="human-table"><thead><tr><th>Vista previa</th><th>Contenido</th><th>Creador</th><th>Tipo</th><th>Estado</th><th>Enviado</th></tr></thead><tbody>{items.map((item)=><tr key={item.id}><td><Link to={`/creator-premium/${item.id}`} className="admin-media-thumb">{item.teaser_url?<img src={item.teaser_url} alt="Vista previa pública"/>:<span>PREMIUM</span>}</Link></td><td><Link to={`/creator-premium/${item.id}`}><strong>{item.title}</strong><small className="mono">{shortId(item.id)}</small>{item.publication_blocker&&<span className="truncate">Bloqueo: {item.publication_blocker}</span>}</Link></td><td><AdminIdentity value={item.creator} compact/></td><td>{item.content_kind} · {item.access_mode}</td><td><em className={`badge ${item.lifecycle_status==="published"?"success":"warn"}`}>{statusLabel(item.lifecycle_status)}</em></td><td>{formatDate(item.submitted_at)}</td></tr>)}</tbody></table>{nextCursor?<button className="secondary" disabled={loadingMore} onClick={()=>void loadMore()}>{loadingMore?"Cargando…":"Cargar más"}</button>:null}</section>}</>
}

type ImageGrant={url:string;expiresAt:string};
type VideoGrant={hlsUrl:string;thumbnailUrl:string;expiresAt:string};

export function AdminCreatorPremiumDetailPage(){
  const {id=""}=useParams(),{hasCapability}=useAdminAuth();
  const [detail,setDetail]=useState<Record<string,unknown>|null>(null),[imageGrant,setImageGrant]=useState<ImageGrant|null>(null),[videoGrant,setVideoGrant]=useState<VideoGrant|null>(null),[grantError,setGrantError]=useState<string|null>(null),[reason,setReason]=useState(""),[refundReason,setRefundReason]=useState(""),[refundCandidates,setRefundCandidates]=useState<Record<string,unknown>|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[nonce,setNonce]=useState(0);
  useEffect(()=>{let active=true;setDetail(null);setError(null);setImageGrant(null);setVideoGrant(null);setRefundCandidates(null);void getAdminCreatorPremiumContent(id).then((value)=>{if(active)setDetail(value)}).catch((cause)=>{if(active)setError(cause instanceof Error?cause.message:"No se pudo cargar el contenido")});return()=>{active=false;setImageGrant(null);setVideoGrant(null)}},[id,nonce]);
  useEffect(()=>{if(!detail)return;let active=true;setGrantError(null);const load=detail.content_kind==="video"?getAdminCreatorPremiumVideoGrant(id):getAdminCreatorPremiumImageGrant(id);void load.then((grant)=>{if(!active)return;if("hlsUrl" in grant)setVideoGrant(grant);else setImageGrant(grant)}).catch(()=>{if(active)setGrantError("El original privado no está disponible para revisión.")});return()=>{active=false;setImageGrant(null);setVideoGrant(null)}},[detail,id]);
  const policy=asRecord(detail?.finance_policy),refundsEnabled=bool(policy.refunds_enabled),canRefund=hasCapability("creator_premium.refunds.write")&&refundsEnabled;
  useEffect(()=>{if(!canRefund||!detail)return;let active=true;void getAdminCreatorPremiumRefundCandidates(id).then((value)=>{if(active)setRefundCandidates(value)}).catch(()=>{if(active)setRefundCandidates(null)});return()=>{active=false}},[canRefund,detail,id,nonce]);
  const lifecycle=text(detail?.lifecycle_status),allowedActions=useMemo(()=>lifecycle==="pending_review"?["approve","reject"]:lifecycle==="published"?["quarantine","remove"]:lifecycle==="rejected"?["restore"]:lifecycle==="quarantined"?["remove","restore"]:lifecycle==="removed"?["restore"]:[],[lifecycle]);
  const review=async(action:"approve"|"reject"|"quarantine"|"remove"|"restore")=>{if(reason.trim().length<2){setError("Indica un motivo de al menos 2 caracteres.");return}setBusy(true);setError(null);try{await reviewAdminCreatorPremiumContent({id,action,reason:reason.trim(),idempotencyKey:crypto.randomUUID()});setReason("");setNonce((value)=>value+1)}catch(cause){setError(cause instanceof Error?cause.message:"No se pudo registrar la decisión")}finally{setBusy(false)}};
  const refund=async(kind:"purchase"|"subscription",targetId:string)=>{const code=refundReason.trim().toLowerCase();if(!/^[a-z][a-z0-9_]{0,79}$/.test(code)){setError("Indica un motivo seguro en formato codigo_de_motivo.");return}if(!window.confirm("Confirmar reembolso completo y revocación de acceso"))return;setBusy(true);setError(null);try{if(kind==="purchase")await refundAdminCreatorPremiumPurchase({receiptId:targetId,reason:code,idempotencyKey:crypto.randomUUID()});else await refundAdminCreatorPremiumSubscriptionPeriod({periodId:targetId,reason:code,idempotencyKey:crypto.randomUUID()});setNonce((value)=>value+1)}catch(cause){setError(cause instanceof Error?cause.message:"No se pudo ejecutar el reembolso") }finally{setBusy(false)}};
  if(error&&!detail)return <ErrorState message={error} onRetry={()=>setNonce((value)=>value+1)}/>;if(!detail)return <LoadingState label="Cargando detalle Premium…"/>;
  const creator=asRecord(detail.creator),offer=asRecord(detail.offer),plans=asRows(detail.plans),audit=asRows(detail.audit),purchases=asRows(refundCandidates?.purchases),periods=asRows(refundCandidates?.subscription_periods),mediaUrl=imageGrant?.url??videoGrant?.hlsUrl??null;
  return <><div className="page-heading"><div><p className="eyebrow">CREATOR PREMIUM</p><h2>{humanValue(detail.title,"Contenido Premium")}</h2><p className="mono">{id}</p></div><em className={`badge ${lifecycle==="published"?"success":"warn"}`}>{statusLabel(lifecycle)}</em></div><div className="presentation-grid content-detail-grid"><div className="presentation-stack"><section className="presentation-card content-preview-card"><header><div><p className="eyebrow">ORIGINAL PRIVADO</p><h3>Inspección temporal</h3></div><span className="badge">{humanValue(detail.content_kind)}</span></header><div className="admin-media-frame"><AdminMediaPreview url={mediaUrl} poster={videoGrant?.thumbnailUrl??text(detail.teaser_url)} kind={text(detail.content_kind)} alt="Original Premium para revisión administrativa" error={grantError}/></div><small>El grant se mantiene solo en memoria y expira automáticamente.</small></section><section className="presentation-card"><header><h3>Detalle comercial</h3></header><p>{humanValue(detail.description,"Sin descripción")}</p><AdminFactGrid><AdminFact label="Acceso" value={humanValue(detail.access_mode)}/><AdminFact label="Oferta activa" value={offer.price_bdag?formatBdag(String(offer.price_bdag)):"No aplica"}/><AdminFact label="Planes" value={String(plans.length)}/><AdminFact label="Media lista" value={humanValue(detail.media_ready)}/><AdminFact label="Bloqueo" value={humanValue(detail.publication_blocker,"Ninguno")}/></AdminFactGrid></section></div><aside className="presentation-stack"><section className="presentation-card"><header><h3>Creador</h3></header><AdminIdentity value={creator}/></section><section className="presentation-card"><header><h3>Ciclo de vida</h3></header><AdminFactGrid><AdminFact label="Enviado" value={formatDate(detail.submitted_at)}/><AdminFact label="Revisado" value={formatDate(detail.reviewed_at)}/><AdminFact label="Publicado" value={formatDate(detail.published_at)}/><AdminFact label="Motivo" value={humanValue(detail.review_reason)}/><AdminFact label="Auditoría" value={String(audit.length)}/></AdminFactGrid></section></aside></div>{hasCapability("creator_premium.review.moderate")&&allowedActions.length>0&&<section className="detail-card"><h3>Decisión de moderación</h3><textarea aria-label="Motivo de revisión" placeholder="Motivo obligatorio" value={reason} onChange={(event)=>setReason(event.target.value)}/><div className="button-row">{allowedActions.map((action)=><button key={action} className={action==="reject"||action==="remove"?"danger":""} disabled={busy} onClick={()=>void review(action as "approve"|"reject"|"quarantine"|"remove"|"restore")}>{action==="approve"?"Aprobar y publicar":action==="reject"?"Rechazar":action==="quarantine"?"Poner en cuarentena":action==="remove"?"Retirar":"Restaurar a revisión"}</button>)}</div></section>}{hasCapability("creator_premium.refunds.write")&&<section className="detail-card"><h3>Reembolsos Premium</h3>{!refundsEnabled?<p>Los reembolsos están deshabilitados por la política financiera del servidor.</p>:<><input aria-label="Motivo del reembolso" placeholder="codigo_de_motivo" value={refundReason} onChange={(event)=>setRefundReason(event.target.value)}/><div className="presentation-stack">{purchases.map((row)=><div key={text(row.receipt_id)} className="button-row"><span>Compra {shortId(row.receipt_id)} · {formatBdag(String(row.gross_amount_bdag))}</span>{row.refundable===true&&<button disabled={busy} onClick={()=>void refund("purchase",text(row.receipt_id))}>Reembolsar compra</button>}</div>)}{periods.map((row)=><div key={text(row.period_id)} className="button-row"><span>Periodo {shortId(row.period_id)} · {formatBdag(String(row.gross_amount_bdag))}</span>{row.refundable===true&&<button disabled={busy} onClick={()=>void refund("subscription",text(row.period_id))}>Reembolsar periodo</button>}</div>)}</div></>}</section>}{error&&<p role="alert">{error}</p>}</>
}
