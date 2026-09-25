import {useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {Link,useParams} from "react-router-dom";
import {EmptyState,ErrorState,LoadingState} from "../components/PageState";
import {AdminMediaPreview} from "../components/AdminPresentation";
import {ConfirmDialog} from "../components/ConfirmDialog";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {formatBdag,formatDate,type AdminRange} from "../lib/adminApi";
import {
  getAdminAdvertisingCampaignDetail,getAdminAdvertisingFinanceHealth,getAdminAdvertisingHealth,
  getAdminAdvertisingOverview,reviewAdvertisingAd,searchAdminAdvertisingAds,
  searchAdminAdvertisingCampaigns,type AdsCampaignCursor,type AdsCampaignPage,type AdsOverview,
  type AdsReviewItem,type JsonRecord,
} from "../lib/adminAdvertisingApi";
import {adminReviewCoordinator} from "../lib/adminReviewCoordinator";
import {adminReviewMessage,reconcileAdminDecision,reviewCtaLabel,reviewReasonLabel,reviewReasonOptions,reviewStatusLabel} from "../lib/adminReviewUx";

const ranges:AdminRange[]=["7d","30d","90d","all"];
const objectives=["awareness","reach","traffic","engagement","video_views","profile_visits","messages","website_conversions","app_promotion","marketplace_sales"];
const num=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const txt=(value:unknown)=>typeof value==="string"?value:"—";
const obj=(value:unknown):JsonRecord=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as JsonRecord:{};
const list=(value:unknown):JsonRecord[]=>Array.isArray(value)?value.filter((item)=>item!==null&&typeof item==="object"&&!Array.isArray(item)) as JsonRecord[]:[];
const tone=(value:string)=>value==="approved"||value==="active"||value==="funded"?"success":value==="pending"||value==="rejected"||value==="archived"?"warn":"";

function useAsync<T>(load:()=>Promise<T>,deps:unknown[]){
  const [data,setData]=useState<T|null>(null),[error,setError]=useState<string|null>(null),[nonce,setNonce]=useState(0);
  const reload=useCallback(()=>setNonce((value)=>value+1),[]);
  const loadRef=useRef(load);loadRef.current=load;
  const key=JSON.stringify(deps);
  useEffect(()=>{let current=true;setData(null);setError(null);void loadRef.current().then((value)=>{if(current)setData(value)}).catch((reason)=>{if(current)setError(reason instanceof Error?reason.message:"Error inesperado")});return()=>{current=false};},[key,nonce]);
  return{data,error,reload};
}

function PrelaunchBanner(){return <section className="ads-prelaunch-banner" aria-label="Estado Ads V2"><div><p className="eyebrow">ADS V2 PRE-LAUNCH</p><h2>Architecture complete · Pre-launch locked</h2><p>Lifecycle observability and moderation are available. Public serving remains disabled.</p></div><div className="ads-prelaunch-locks"><span>Delivery disabled</span><span>Funding disabled</span><span>Campaign activation policy disabled</span></div></section>}
function Heading({eyebrow,title,detail,children}:{eyebrow:string;title:string;detail:string;children?:ReactNode}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{detail}</p></div>{children}</div>}
function Metric({label,value,money=false}:{label:string;value:unknown;money?:boolean}){const missing=value===null||value===undefined;return <article className="metric-card"><span>{label}</span><strong>{missing?"—":money?formatBdag(num(value)):num(value).toLocaleString()}</strong></article>}
function RangePicker({value,onChange}:{value:AdminRange;onChange:(range:AdminRange)=>void}){return <div className="range-tabs" aria-label="Rango Ads V2">{ranges.map((range)=><button className={range===value?"active":""} key={range} onClick={()=>onChange(range)}>{range.toUpperCase()}</button>)}</div>}
function Facts({value}:{value:JsonRecord}){return <div>{Object.entries(value).map(([key,item])=><div className="fact-row" key={key}><span>{key.replaceAll("_"," ")}</span><strong>{typeof item==="boolean"?(item?"YES":"NO"):String(item??"—")}</strong></div>)}</div>}

export function AdminAdvertisingOverviewPage(){
  const state=useAsync(()=>getAdminAdvertisingOverview("30d"),[]);
  if(state.error)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Cargando Ads V2…"/>;
  const {inventory,review,events,conversions,finance}=state.data;
  return <><PrelaunchBanner/><Heading eyebrow="ADVERTISING" title="Overview" detail="Ads V2 canonical inventory, review and aggregate performance."/><section className="metrics-grid"><Metric label="Campaigns" value={inventory.campaigns}/><Metric label="Ads" value={inventory.ads}/><Metric label="Pending review" value={review.pending}/><Metric label="Approved" value={review.approved}/><Metric label="Impressions" value={events.impressions}/><Metric label="Clicks" value={events.clicks}/><Metric label="Conversions" value={conversions.conversions}/><Metric label="Budget defined" value={finance.budget_bdag} money/></section><section className="detail-grid"><article className="detail-card"><h3>Authority</h3><div className="fact-row"><span>Write authority</span><strong>ads_v2</strong></div><div className="fact-row"><span>Marketplace legacy</span><strong>Separate</strong></div></article><article className="detail-card"><h3>Launch posture</h3><div className="fact-row"><span>Activation</span><strong>Unavailable</strong></div><div className="fact-row"><span>Public delivery</span><strong>Disabled</strong></div></article></section></>;
}

export function AdminAdvertisingCampaignsPage(){
  const [query,setQuery]=useState(""),[objective,setObjective]=useState(""),[status,setStatus]=useState(""),[cursor,setCursor]=useState<AdsCampaignCursor|undefined>(),[history,setHistory]=useState<Array<AdsCampaignCursor|undefined>>([]);
  const state=useAsync(()=>searchAdminAdvertisingCampaigns({query,objective,status,cursor,limit:50}),[query,objective,status,cursor]);
  const reset=()=>{setCursor(undefined);setHistory([])},next=(value:AdsCampaignCursor)=>{setHistory((old)=>[...old,cursor]);setCursor(value)},previous=()=>{setCursor(history.at(-1));setHistory((old)=>old.slice(0,-1))};
  return <><Heading eyebrow="ADVERTISING" title="Campaigns" detail="Canonical Ads V2 campaigns. Marketplace Ads remains a separate authority."/><div className="filters"><input aria-label="Buscar campañas Ads V2" placeholder="Campaign or Business" value={query} onChange={(event)=>{setQuery(event.target.value);reset()}}/><select aria-label="Objetivo Ads V2" value={objective} onChange={(event)=>{setObjective(event.target.value);reset()}}><option value="">All objectives</option>{objectives.map((item)=><option key={item}>{item}</option>)}</select><select aria-label="Estado Ads V2" value={status} onChange={(event)=>{setStatus(event.target.value);reset()}}><option value="">All statuses</option>{["draft","scheduled","active","paused","completed","cancelled","archived"].map((item)=><option key={item}>{item}</option>)}</select></div>{state.error?<ErrorState message={state.error} onRetry={state.reload}/>:!state.data?<LoadingState label="Buscando campañas…"/>:<CampaignTable page={state.data} onNext={next} onPrevious={history.length>0?previous:undefined}/>}</>;
}
function CampaignTable({page,onNext,onPrevious}:{page:AdsCampaignPage;onNext:(cursor:AdsCampaignCursor)=>void;onPrevious?:()=>void}){if(page.items.length===0)return <EmptyState title="No Ads V2 campaigns" detail="The production authority currently contains no Campaign V2 rows."/>;return <section className="table-panel"><table className="human-table"><thead><tr><th>Campaign</th><th>Business</th><th>Ad Account</th><th>Objective</th><th>Status</th><th>Ads / Review</th><th>Budget</th><th>Created</th></tr></thead><tbody>{page.items.map((item)=><tr key={item.campaign_id}><td><Link to={`/advertising/campaigns/${item.campaign_id}`}><strong>{item.name}</strong><small>ads_v2</small></Link></td><td>{item.business.display_name}</td><td>{item.ad_account.name}</td><td>{item.objective}</td><td><em className={`badge ${tone(item.status)}`}>{item.status}</em></td><td>{item.counts.ads} · {item.counts.review_pending} pending</td><td>{item.finance?formatBdag(num(item.finance.budget_bdag)):"—"}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table>{(onPrevious||page.next_cursor)&&<footer className="pagination">{onPrevious&&<button className="secondary" onClick={onPrevious}>Previous</button>}{page.next_cursor&&<button className="secondary" onClick={()=>onNext(page.next_cursor as AdsCampaignCursor)}>Next</button>}</footer>}</section>}

export function AdminAdvertisingCampaignDetailPage(){
  const {campaignId=""}=useParams(),state=useAsync(()=>getAdminAdvertisingCampaignDetail(campaignId),[campaignId]);
  if(state.error)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Cargando campaña…"/>;
  const root=state.data,campaign=obj(root.campaign),business=obj(root.business),account=obj(root.ad_account),finance=obj(root.finance),hasFinance=root.finance!==null,analytics=obj(root.analytics),readiness=obj(root.readiness);
  return <><Heading eyebrow="ADS V2 CAMPAIGN" title={txt(campaign.name)} detail={`${txt(business.display_name)} · ${txt(account.name)}`}><em className={`badge ${tone(txt(campaign.status))}`}>{txt(campaign.status)}</em></Heading><section className="metrics-grid"><Metric label="Impressions" value={analytics.impressions}/><Metric label="Clicks" value={analytics.clicks}/><Metric label="Attributed conversions" value={analytics.conversions}/><Metric label="Budget" value={hasFinance?finance.budget_bdag:null} money/></section><section className="detail-grid"><DetailList title="Ad Sets" items={list(root.ad_sets)} label="name"/><DetailList title="Audience & placements" items={list(root.ad_sets)} label="name" secondary={(row)=>{const codes=obj(row.placements).codes;return `${obj(row.audience).age_scope??"No audience"} · ${Array.isArray(codes)&&codes.length>0?codes.map(txt).join(", "):"No placements"}`}}/><DetailList title="Destinations" items={list(root.destinations)} label="destination_type"/><DetailList title="Creatives / Ads" items={list(root.ads)} label="name" secondary={(row)=>`${row.review_status??"—"} · ${obj(row.creative).format??"—"}`}/><DetailList title="Review" items={list(root.ads)} label="name" secondary={(row)=>{const review=obj(row.latest_review);return `${row.review_status??"—"}${review.reason_code?` · ${txt(review.reason_code)}`:""}`}}/><article className="detail-card"><h3>Finance</h3>{hasFinance?<Facts value={finance}/>:<p className="muted-copy">No finance draft.</p>}</article><article className="detail-card"><h3>Readiness</h3><Facts value={readiness}/></article></section></>;
}
function DetailList({title,items,label,secondary}:{title:string;items:JsonRecord[];label:string;secondary?:(row:JsonRecord)=>string}){return <article className="detail-card"><h3>{title}</h3>{items.length===0?<p className="muted-copy">No records.</p>:items.map((item,index)=><div className="fact-row" key={String(item.id??index)}><span>{txt(item[label])}</span><strong>{secondary?secondary(item):txt(item.status)}</strong></div>)}</article>}

export function AdminAdvertisingReviewPage(){
  const {hasCapability}=useAdminAuth();
  const canModerate=hasCapability("content.items.moderate");
  const [filter,setFilter]=useState("pending");
  const [items,setItems]=useState<AdsReviewItem[]|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [reason,setReason]=useState<Record<string,string>>({});
  const [note,setNote]=useState<Record<string,string>>({});
  const [confirmation,setConfirmation]=useState<{item:AdsReviewItem;action:"approve"|"reject"}|null>(null);
  const fetchItems=useCallback(()=>searchAdminAdvertisingAds(filter),[filter]);
  const load=useCallback(()=>{
    setItems(null);setError(null);
    void fetchItems().then(setItems).catch((value)=>setError(adminReviewMessage(value)));
  },[fetchItems]);
  useEffect(load,[load]);

  const decide=async(item:AdsReviewItem,action:"approve"|"reject")=>{
    const reasonCode=action==="reject"?(reason[item.id]??"policy_violation"):null;
    const internalNote=(note[item.id]??"").trim()||null;
    if(action==="reject"&&reasonCode==="other"&&!internalNote){setError("Add an internal note when the reason is Other.");return;}
    if(!item.submission_fingerprint){setError("The submitted review identity is unavailable. Refresh before reviewing it.");return;}
    setBusy(item.id);setError(null);setNotice(null);
    try{
      const intent={adId:item.id,submissionFingerprint:item.submission_fingerprint,action,reasonCode,note:internalNote};
      const result=await adminReviewCoordinator.run({
        intent,
        mutate:(idempotencyKey)=>reviewAdvertisingAd({adId:item.id,action,reasonCode:reasonCode??undefined,note:internalNote??undefined,idempotencyKey}),
        reconcile:async()=>reconcileAdminDecision(await searchAdminAdvertisingAds(""),intent),
      });
      let refreshFailed=false;
      try{setItems(await fetchItems())}catch{refreshFailed=true}
      if(result.state==="uncertain"||result.state==="conflict") setError(result.message);
      else{
        setNotice(action==="approve"?"Ad approved.":"Ad rejected.");
        if(refreshFailed)setError("The review was saved, but we could not refresh the queue. Try refreshing again.");
      }
      setConfirmation(null);
    }catch(value){
      try{setItems(await fetchItems())}catch{/* preserve the decision error */}
      setError(adminReviewMessage(value));
    }
    finally{setBusy(null);}
  };

  return <>
    <Heading eyebrow="CONTENT MODERATION" title="Ads V2 Review Queue" detail="Review the exact creative and destination submitted by the advertiser.">
      <select aria-label="Review status" value={filter} onChange={(event)=>setFilter(event.target.value)}>
        <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option>
      </select>
    </Heading>
    {error&&<p role="alert" className="state-card error-state">{error}</p>}
    {notice&&<p role="status" className="state-card success-state">{notice}</p>}
    {!items?<LoadingState label="Loading reviews…"/>:items.length===0?<EmptyState title="No ads are waiting for review." detail={filter==="pending"?"The pending review queue is empty.":"No ads match this filter."}/>:<section className="detail-grid ads-review-grid">{items.map((item)=>{
      const creative=item.creative,destination=item.destination,format=txt(creative.format),mediaUrl=format==="video"?txt(creative.playback_url):txt(creative.preview_url),mediaReviewable=mediaUrl!=="—",poster=typeof creative.preview_url==="string"?creative.preview_url:null;
      const externalUrl=destination.destination_type==="external_url"&&typeof destination.external_url==="string"?destination.external_url:null;
      const destinationName=externalUrl?"External website":destination.destination_type==="nelyon_profile"?"Nelyon profile":destination.destination_type==="business_account"?"Business":destination.destination_type==="marketplace_product"?"Marketplace product":destination.destination_type==="marketplace_store"?"Marketplace store":"Destination details unavailable";
      return <article className="detail-card ads-review-card" key={item.id} aria-busy={busy===item.id}>
        <div className="panel-title"><div><h3>{item.name}</h3><p>{txt(item.campaign.name)} · {txt(item.campaign.objective).replaceAll("_"," ")}</p></div><em className={`badge ${tone(item.review_status)}`}>{reviewStatusLabel(item.review_status)}</em></div>
        <div className="admin-media-frame ads-review-media"><AdminMediaPreview url={mediaReviewable?mediaUrl:null} poster={poster} kind={format} alt={`Creative ${item.name}`} restricted={!mediaReviewable}/></div>
        <div className="fact-row"><span>Ad Set</span><strong>{txt(item.ad_set.name)}</strong></div>
        <div className="fact-row"><span>Submitted</span><strong>{formatDate(item.submitted_at)}</strong></div>
        <div className="fact-row"><span>Media</span><strong>{format==="video"?"Video":"Image"}</strong></div>
        <div className="fact-row"><span>Headline</span><strong>{txt(creative.headline)}</strong></div>
        <div className="fact-row"><span>Call to action</span><strong>{reviewCtaLabel(creative.call_to_action)}</strong></div>
        <p className="content-copy">{txt(creative.primary_text)}</p><p className="muted-copy content-copy">{txt(creative.description)}</p>
        <div className="fact-row"><span>Destination</span><strong>{destinationName}</strong></div>
        {externalUrl?<a className="content-copy ads-review-destination" href={externalUrl} target="_blank" rel="noopener noreferrer">{externalUrl}</a>:<p className="muted-copy">Destination details unavailable</p>}
        {item.latest_decision&&<div className="readonly-note"><strong>{reviewReasonLabel(item.latest_decision.reason_code)}</strong>{item.latest_decision.note&&<span>Internal note: {item.latest_decision.note}</span>}</div>}
        {item.review_status==="pending"&&canModerate&&<div className="ads-review-actions">
          {!mediaReviewable&&<p role="alert">Approval unavailable until canonical media preview is available.</p>}
          <label>Rejection reason<select aria-label={`Rejection reason for ${item.name}`} value={reason[item.id]??"policy_violation"} onChange={(event)=>setReason((old)=>({...old,[item.id]:event.target.value}))}>{reviewReasonOptions.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
          <label>Internal note<textarea aria-label={`Internal note for ${item.name}`} value={note[item.id]??""} onChange={(event)=>setNote((old)=>({...old,[item.id]:event.target.value}))}/><small>Only administrators can see this note.</small></label>
          <div><button disabled={busy===item.id||!mediaReviewable} onClick={()=>setConfirmation({item,action:"approve"})}>Approve</button><button className="danger" disabled={busy===item.id} onClick={()=>setConfirmation({item,action:"reject"})}>Reject</button></div>
        </div>}
      </article>})}</section>}
    <ConfirmDialog open={Boolean(confirmation)} title={confirmation?.action==="approve"?"Approve this ad?":"Reject this ad?"} consequence={confirmation?.action==="approve"?"This decision applies to the exact submitted creative and destination.":"The advertiser will see the selected reason and can create a revised ad."} actionLabel={confirmation?.action==="approve"?"Approve ad":"Reject ad"} reason={confirmation?.action==="reject"?reviewReasonLabel(reason[confirmation.item.id]??"policy_violation"):undefined} danger={confirmation?.action==="reject"} pending={Boolean(confirmation&&busy===confirmation.item.id)} onCancel={()=>{if(!busy)setConfirmation(null)}} onConfirm={()=>{if(confirmation)void decide(confirmation.item,confirmation.action)}}/>
  </>;
}
export function AdminAdvertisingAnalyticsPage(){
  const [range,setRange]=useState<AdminRange>("30d"),state=useAsync(()=>getAdminAdvertisingOverview(range),[range]);
  if(state.error)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Calculando agregados…"/>;
  return <AnalyticsContent data={state.data} range={range} setRange={setRange}/>;
}
function AnalyticsContent({data,range,setRange}:{data:AdsOverview;range:AdminRange;setRange:(range:AdminRange)=>void}){return <><Heading eyebrow="AGGREGATE ANALYTICS" title="Ads V2 Analytics" detail="Aggregate authority only; no viewer timelines or raw event identifiers."><RangePicker value={range} onChange={setRange}/></Heading><section className="metrics-grid"><Metric label="Impressions" value={data.events.impressions}/><Metric label="Clicks" value={data.events.clicks}/><Metric label="CTR" value={data.events.ctr}/><Metric label="Conversions" value={data.conversions.conversions}/><Metric label="Attributed" value={data.conversions.attributions}/><Metric label="Purchase value" value={data.conversions.marketplace_purchase_value_bdag} money/></section><section className="detail-grid"><article className="detail-card"><h3>By placement</h3>{data.placements.length===0?<p className="muted-copy">No event activity.</p>:data.placements.map((row)=><div className="fact-row" key={txt(row.placement_code)}><span>{txt(row.placement_code)}</span><strong>{num(row.impressions)} / {num(row.clicks)}</strong></div>)}</article><article className="detail-card"><h3>By objective</h3>{data.objectives.length===0?<p className="muted-copy">No campaigns.</p>:data.objectives.map((row)=><div className="fact-row" key={txt(row.objective)}><span>{txt(row.objective)}</span><strong>{num(row.campaign_count)}</strong></div>)}</article><article className="detail-card"><h3>Finance definition</h3><Facts value={data.finance}/></article></section></>}

export function AdminAdvertisingHealthPage(){
  const state=useAsync(getAdminAdvertisingHealth,[]);
  if(state.error)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Evaluando readiness…"/>;
  const health=state.data;
  return <><PrelaunchBanner/><Heading eyebrow="PRODUCTION READINESS" title="Ads V2 Health" detail="Architecture complete. Launch remains intentionally locked."/><section className="detail-grid"><HealthCard title="Identity" value={health.identity}/><HealthCard title="Eligibility" value={health.age}/><HealthCard title="Targeting" value={health.targeting}/><HealthCard title="Delivery" value={health.delivery}/><HealthCard title="Campaign lifecycle" value={health.lifecycle}/><HealthCard title="Events" value={health.events}/><HealthCard title="Finance" value={health.finance}/><article className="detail-card wide"><h3>Launch blockers</h3>{health.blockers.map((item)=><div className="fact-row" key={item}><span>{item.replaceAll("_"," ")}</span><em className="badge warn">BLOCKER</em></div>)}</article><article className="detail-card wide"><h3>Capabilities not enabled</h3>{health.capability_not_enabled.map((item)=><div className="fact-row" key={item}><span>{item.replaceAll("_"," ")}</span><em className="badge">NOT ENABLED</em></div>)}</article></section></>;
}
function HealthCard({title,value}:{title:string;value:JsonRecord}){return <article className="detail-card"><h3>{title}</h3><Facts value={value}/></article>}

export function AdminAdvertisingFinanceHealthPage(){
  const state=useAsync(getAdminAdvertisingFinanceHealth,[]);
  if(state.error)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Ejecutando reconciliación de lectura…"/>;
  const root=state.data;
  return <><Heading eyebrow="FINANCE RECONCILIATION" title="Ads V2 Finance Health" detail="Read-only wrappers over canonical Ads V2 and shared legacy escrow reconciliation."/><section className="detail-grid"><HealthCard title="Ads V2" value={obj(root.reconciliation)}/><HealthCard title="Shared legacy escrow" value={obj(root.shared_legacy_reconciliation)}/><HealthCard title="Marketplace finalization" value={obj(root.finalization)}/><HealthCard title="Marketplace events" value={obj(root.legacy_events)}/></section></>;
}
