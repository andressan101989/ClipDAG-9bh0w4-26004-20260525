import {useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import {Link,useParams} from "react-router-dom";
import {EmptyState,ErrorState,LoadingState,StaleDataNotice} from "../components/PageState";
import {AdminMediaPreview} from "../components/AdminPresentation";
import {ConfirmDialog} from "../components/ConfirmDialog";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {formatBdag,formatDate,type AdminRange} from "../lib/adminApi";
import {
  getAdminAdvertisingCampaignDetail,getAdminAdvertisingFinanceHealth,getAdminAdvertisingHealth,
  getAdminAdvertisingBillingHealth,getAdminAdvertisingOverview,reviewAdvertisingAd,searchAdminAdvertisingAds,
  searchAdminAdvertisingCampaigns,type AdsCampaignCursor,type AdsCampaignPage,type AdsOverview,
  searchAdminAdvertisingBillingRates,createAdminAdvertisingBillingRateDraft,updateAdminAdvertisingBillingRateDraft,
  publishAdminAdvertisingBillingRate,retireAdminAdvertisingBillingRate,
  getAdminAdvertisingRolloutControl,setAdminAdvertisingProductionRollout,setAdminAdvertisingLaunchMode,
  type AdsBillingRate,type AdsReviewItem,type AdsRolloutControl,type JsonRecord,
} from "../lib/adminAdvertisingApi";
import {adminReviewCoordinator} from "../lib/adminReviewCoordinator";
import {adminReviewMessage,reconcileAdminDecision,reviewCtaLabel,reviewReasonLabel,reviewReasonOptions,reviewStatusLabel} from "../lib/adminReviewUx";
import {presentAdsError} from "../lib/adsErrorPresentation";
import {ADS_OPERATIONAL_RUNTIME,metricPresentation,type MetricKey} from "../../../../shared/adsOperationalTruth";

const ranges:AdminRange[]=["7d","30d","90d","all"];
const objectives=["awareness","reach","traffic","engagement","video_views","profile_visits","messages","website_conversions","app_promotion","marketplace_sales"];
const num=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const txt=(value:unknown)=>typeof value==="string"?value:"—";
const obj=(value:unknown):JsonRecord=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as JsonRecord:{};
const list=(value:unknown):JsonRecord[]=>Array.isArray(value)?value.filter((item)=>item!==null&&typeof item==="object"&&!Array.isArray(item)) as JsonRecord[]:[];
const tone=(value:string)=>value==="approved"||value==="active"||value==="funded"?"success":value==="pending"||value==="rejected"||value==="archived"?"warn":"";

function useAsync<T>(load:()=>Promise<T>,deps:unknown[]){
  const [data,setData]=useState<T|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true),[nonce,setNonce]=useState(0);
  const reload=useCallback(()=>setNonce((value)=>value+1),[]);
  const loadRef=useRef(load);loadRef.current=load;
  const key=JSON.stringify(deps);
  const keyRef=useRef(key);
  useEffect(()=>{let current=true;const changed=keyRef.current!==key;keyRef.current=key;if(changed)setData(null);setError(null);setLoading(true);void loadRef.current().then((value)=>{if(current){setData(value);setError(null)}}).catch((reason)=>{if(current)setError(presentAdsError(reason,{operation:"read",resource:"Ads data"}).message)}).finally(()=>{if(current)setLoading(false)});return()=>{current=false};},[key,nonce]);
  return{data,error,loading,reload};
}

function RefreshNotice({error,loading,reload}:{error:string|null;loading:boolean;reload:()=>void}){if(error)return <StaleDataNotice message={`Showing the last loaded data. ${error}`} onRetry={reload}/>;return loading?<div className="state-card stale-state" role="status" aria-busy="true">Refreshing the latest data…</div>:null}

function PrelaunchBanner(){return <section className="ads-prelaunch-banner" aria-label="Estado Ads V2"><div><p className="eyebrow">ADS V2 PRE-LAUNCH</p><h2>Architecture complete · Pre-launch locked</h2><p>Lifecycle observability and moderation are available. Public serving remains disabled.</p></div><div className="ads-prelaunch-locks"><span>Delivery disabled</span><span>Funding disabled</span><span>Campaign activation policy disabled</span></div></section>}
function Heading({eyebrow,title,detail,children}:{eyebrow:string;title:string;detail:string;children?:ReactNode}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{detail}</p></div>{children}</div>}
function Metric({label,value,money=false}:{label:string;value:unknown;money?:boolean}){const missing=value===null||value===undefined;return <article className="metric-card"><span>{label}</span><strong>{missing?"—":money?formatBdag(num(value)):num(value).toLocaleString()}</strong></article>}
function OperationalMetric({label,metric,value,impressions=0}:{label:string;metric:MetricKey;value:unknown;impressions?:number}){const presentation=metricPresentation(metric,value,ADS_OPERATIONAL_RUNTIME,{impressions});return <article className={`metric-card metric-${presentation.state}`} aria-label={`${label} metric`}><span>{label}</span><strong>{presentation.display}</strong>{presentation.detail&&<small>{presentation.detail}</small>}</article>}
function RangePicker({value,onChange}:{value:AdminRange;onChange:(range:AdminRange)=>void}){return <div className="range-tabs" aria-label="Rango Ads V2">{ranges.map((range)=><button className={range===value?"active":""} key={range} onClick={()=>onChange(range)}>{range.toUpperCase()}</button>)}</div>}
function Facts({value}:{value:JsonRecord}){return <div>{Object.entries(value).map(([key,item])=><div className="fact-row" key={key}><span>{key.replaceAll("_"," ")}</span><strong>{typeof item==="boolean"?(item?"YES":"NO"):String(item??"—")}</strong></div>)}</div>}

export function AdminAdvertisingOverviewPage(){
  const state=useAsync(()=>getAdminAdvertisingOverview("30d"),[]);
  if(state.error&&!state.data)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Cargando Ads V2…"/>;
  const {inventory,review,events,conversions,finance}=state.data;
  const impressions=num(events.impressions);
  return <><RefreshNotice error={state.error} loading={state.loading} reload={state.reload}/><PrelaunchBanner/><Heading eyebrow="ADVERTISING" title="Overview" detail="Ads V2 canonical inventory, review and operationally truthful measurement state."/><section className="metrics-grid"><Metric label="Campaigns" value={inventory.campaigns}/><Metric label="Ads" value={inventory.ads}/><Metric label="Pending review" value={review.pending}/><Metric label="Approved" value={review.approved}/><OperationalMetric label="Impressions" metric="impressions" value={events.impressions} impressions={impressions}/><OperationalMetric label="Clicks" metric="clicks" value={events.clicks} impressions={impressions}/><OperationalMetric label="Conversions" metric="conversions" value={conversions.conversions} impressions={impressions}/><Metric label="Budget defined" value={finance.budget_bdag} money/></section><section className="detail-grid"><article className="detail-card"><h3>Measurement state</h3><div className="fact-row"><span>Impressions</span><strong>No delivery yet</strong></div><div className="fact-row"><span>Interactions and attribution</span><strong>Runtime not available yet</strong></div></article><article className="detail-card"><h3>Launch posture</h3><div className="fact-row"><span>Activation</span><strong>Unavailable</strong></div><div className="fact-row"><span>Public delivery</span><strong>Disabled</strong></div></article></section></>;
}

export function AdminAdvertisingCampaignsPage(){
  const [query,setQuery]=useState(""),[objective,setObjective]=useState(""),[status,setStatus]=useState(""),[cursor,setCursor]=useState<AdsCampaignCursor|undefined>(),[history,setHistory]=useState<Array<AdsCampaignCursor|undefined>>([]);
  const state=useAsync(()=>searchAdminAdvertisingCampaigns({query,objective,status,cursor,limit:50}),[query,objective,status,cursor]);
  const reset=()=>{setCursor(undefined);setHistory([])},next=(value:AdsCampaignCursor)=>{setHistory((old)=>[...old,cursor]);setCursor(value)},previous=()=>{setCursor(history.at(-1));setHistory((old)=>old.slice(0,-1))};
  return <><Heading eyebrow="ADVERTISING" title="Campaigns" detail="Canonical Ads V2 campaigns. Marketplace Ads remains a separate authority."/><div className="filters"><input aria-label="Buscar campañas Ads V2" placeholder="Campaign or Business" value={query} onChange={(event)=>{setQuery(event.target.value);reset()}}/><select aria-label="Objetivo Ads V2" value={objective} onChange={(event)=>{setObjective(event.target.value);reset()}}><option value="">All objectives</option>{objectives.map((item)=><option key={item}>{item}</option>)}</select><select aria-label="Estado Ads V2" value={status} onChange={(event)=>{setStatus(event.target.value);reset()}}><option value="">All statuses</option>{["draft","scheduled","active","paused","completed","cancelled","archived"].map((item)=><option key={item}>{item}</option>)}</select></div>{state.error&&!state.data?<ErrorState message={state.error} onRetry={state.reload}/>:!state.data?<LoadingState label="Buscando campañas…"/>:<><RefreshNotice error={state.error} loading={state.loading} reload={state.reload}/><CampaignTable page={state.data} onNext={next} onPrevious={history.length>0?previous:undefined}/></>}</>;
}
function CampaignTable({page,onNext,onPrevious}:{page:AdsCampaignPage;onNext:(cursor:AdsCampaignCursor)=>void;onPrevious?:()=>void}){if(page.items.length===0)return <EmptyState title="No Ads V2 campaigns" detail="The production authority currently contains no Campaign V2 rows."/>;return <section className="table-panel"><table className="human-table"><thead><tr><th>Campaign</th><th>Business</th><th>Ad Account</th><th>Objective</th><th>Status</th><th>Ads / Review</th><th>Budget</th><th>Created</th></tr></thead><tbody>{page.items.map((item)=><tr key={item.campaign_id}><td><Link to={`/advertising/campaigns/${item.campaign_id}`}><strong>{item.name}</strong><small>ads_v2</small></Link></td><td>{item.business.display_name}</td><td>{item.ad_account.name}</td><td>{item.objective}</td><td><em className={`badge ${tone(item.status)}`}>{item.status}</em></td><td>{item.counts.ads} · {item.counts.review_pending} pending</td><td>{item.finance?formatBdag(num(item.finance.budget_bdag)):"—"}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table>{(onPrevious||page.next_cursor)&&<footer className="pagination">{onPrevious&&<button className="secondary" onClick={onPrevious}>Previous</button>}{page.next_cursor&&<button className="secondary" onClick={()=>onNext(page.next_cursor as AdsCampaignCursor)}>Next</button>}</footer>}</section>}

export function AdminAdvertisingCampaignDetailPage(){
  const {campaignId=""}=useParams(),state=useAsync(()=>getAdminAdvertisingCampaignDetail(campaignId),[campaignId]);
  if(state.error&&!state.data)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Cargando campaña…"/>;
  const root=state.data,campaign=obj(root.campaign),business=obj(root.business),account=obj(root.ad_account),finance=obj(root.finance),hasFinance=root.finance!==null,analytics=obj(root.analytics),readiness=obj(root.readiness);
  const impressions=num(analytics.impressions);
  return <><RefreshNotice error={state.error} loading={state.loading} reload={state.reload}/><Heading eyebrow="ADS V2 CAMPAIGN" title={txt(campaign.name)} detail={`${txt(business.display_name)} · ${txt(account.name)}`}><em className={`badge ${tone(txt(campaign.status))}`}>{txt(campaign.status)}</em></Heading><section className="metrics-grid"><OperationalMetric label="Impressions" metric="impressions" value={analytics.impressions} impressions={impressions}/><OperationalMetric label="Clicks" metric="clicks" value={analytics.clicks} impressions={impressions}/><OperationalMetric label="Attributed conversions" metric="attributed_conversions" value={analytics.attributed_conversions} impressions={impressions}/><Metric label="Budget" value={hasFinance?finance.budget_bdag:null} money/></section><section className="detail-grid"><DetailList title="Ad Sets" items={list(root.ad_sets)} label="name"/><DetailList title="Audience & placements" items={list(root.ad_sets)} label="name" secondary={(row)=>{const codes=obj(row.placements).codes;return `${obj(row.audience).age_scope??"No audience"} · ${Array.isArray(codes)&&codes.length>0?codes.map(txt).join(", "):"No placements"}`}}/><DetailList title="Destinations" items={list(root.destinations)} label="destination_type"/><DetailList title="Creatives / Ads" items={list(root.ads)} label="name" secondary={(row)=>`${row.review_status??"—"} · ${obj(row.creative).format??"—"}`}/><DetailList title="Review" items={list(root.ads)} label="name" secondary={(row)=>{const review=obj(row.latest_review);return `${row.review_status??"—"}${review.reason_code?` · ${txt(review.reason_code)}`:""}`}}/><article className="detail-card"><h3>Finance</h3>{hasFinance?<Facts value={finance}/>:<p className="muted-copy">No finance draft.</p>}</article><article className="detail-card"><h3>Readiness</h3><Facts value={readiness}/></article></section></>;
}
function DetailList({title,items,label,secondary}:{title:string;items:JsonRecord[];label:string;secondary?:(row:JsonRecord)=>string}){return <article className="detail-card"><h3>{title}</h3>{items.length===0?<p className="muted-copy">No records.</p>:items.map((item,index)=><div className="fact-row" key={String(item.id??index)}><span>{txt(item[label])}</span><strong>{secondary?secondary(item):txt(item.status)}</strong></div>)}</article>}

export function AdminAdvertisingReviewPage(){
  const {hasCapability}=useAdminAuth();
  const canModerate=hasCapability("content.items.moderate");
  const [filter,setFilter]=useState("pending");
  const [items,setItems]=useState<AdsReviewItem[]|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [readError,setReadError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [reason,setReason]=useState<Record<string,string>>({});
  const [note,setNote]=useState<Record<string,string>>({});
  const [confirmation,setConfirmation]=useState<{item:AdsReviewItem;action:"approve"|"reject"}|null>(null);
  const fetchItems=useCallback(()=>searchAdminAdvertisingAds(filter),[filter]);
  const load=useCallback((clear=false)=>{
    if(clear)setItems(null);setError(null);setReadError(null);setLoading(true);
    void fetchItems().then((value)=>{setItems(value);setReadError(null)}).catch((value)=>setReadError(presentAdsError(value,{operation:"read",resource:"review queue"}).message)).finally(()=>setLoading(false));
  },[fetchItems]);
  useEffect(()=>load(true),[load]);

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
        setNotice(refreshFailed ? "The review was saved, but the latest queue could not be loaded. Try again." : action==="approve"?"Ad approved.":"Ad rejected.");
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
    {readError&&items&&<StaleDataNotice message={`Showing the last loaded review queue. ${readError}`} onRetry={()=>load(false)}/>}
    {loading&&items&&!readError&&<div className="state-card stale-state" role="status" aria-busy="true">Refreshing the latest review queue…</div>}
    {error&&<p role="alert" className="state-card error-state">{error}</p>}
    {notice&&<p role="status" className="state-card success-state">{notice}</p>}
    {!items?(readError?<ErrorState message={readError} onRetry={()=>load(false)}/>:<LoadingState label="Loading reviews…"/>):items.length===0?<EmptyState title="No ads are waiting for review." detail={filter==="pending"?"The pending review queue is empty.":"No ads match this filter."}/>:<section className="detail-grid ads-review-grid" aria-busy={loading}>{items.map((item)=>{
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
  if(state.error&&!state.data)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Calculando agregados…"/>;
  return <><RefreshNotice error={state.error} loading={state.loading} reload={state.reload}/><AnalyticsContent data={state.data} range={range} setRange={setRange}/></>;
}
function AnalyticsContent({data,range,setRange}:{data:AdsOverview;range:AdminRange;setRange:(range:AdminRange)=>void}){const impressions=num(data.events.impressions);return <><Heading eyebrow="AGGREGATE ANALYTICS" title="Ads V2 Analytics" detail="Canonical aggregates with runtime availability shown separately from measured zero."><RangePicker value={range} onChange={setRange}/></Heading><section className="metrics-grid"><OperationalMetric label="Impressions" metric="impressions" value={data.events.impressions} impressions={impressions}/><OperationalMetric label="Clicks" metric="clicks" value={data.events.clicks} impressions={impressions}/><OperationalMetric label="CTR" metric="ctr" value={data.events.ctr} impressions={impressions}/><OperationalMetric label="Conversions" metric="conversions" value={data.conversions.conversions} impressions={impressions}/><OperationalMetric label="Attributed" metric="attributed_conversions" value={data.conversions.attributions} impressions={impressions}/><OperationalMetric label="Purchase value" metric="marketplace_purchase_value_bdag" value={data.conversions.marketplace_purchase_value_bdag} impressions={impressions}/></section><section className="detail-grid"><article className="detail-card"><h3>By placement</h3>{data.placements.length===0?<p className="muted-copy">No delivery activity.</p>:data.placements.map((row)=><div className="fact-row" key={txt(row.placement_code)}><span>{txt(row.placement_code)}</span><strong>{num(row.impressions)} impressions · interactions not available</strong></div>)}</article><article className="detail-card"><h3>By objective</h3>{data.objectives.length===0?<p className="muted-copy">No campaigns.</p>:data.objectives.map((row)=><div className="fact-row" key={txt(row.objective)}><span>{txt(row.objective)}</span><strong>{num(row.campaign_count)}</strong></div>)}</article><article className="detail-card"><h3>Finance definition</h3><Facts value={data.finance}/><p className="muted-copy">Reconciliation counters remain measured. Automatic Ads V2 billing is not active during pre-launch.</p></article></section></>}

export function AdminAdvertisingHealthPage(){
  const state=useAsync(getAdminAdvertisingHealth,[]);
  if(state.error&&!state.data)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Evaluando readiness…"/>;
  const health=state.data;
  return <><RefreshNotice error={state.error} loading={state.loading} reload={state.reload}/><PrelaunchBanner/><Heading eyebrow="PRODUCTION READINESS" title="Ads V2 Health" detail="Architecture complete. Launch remains intentionally locked."/><section className="detail-grid"><HealthCard title="Identity" value={health.identity}/><HealthCard title="Eligibility" value={health.age}/><HealthCard title="Targeting" value={health.targeting}/><HealthCard title="Delivery" value={health.delivery}/><HealthCard title="Campaign lifecycle" value={health.lifecycle}/><HealthCard title="Events" value={health.events}/><HealthCard title="Finance" value={health.finance}/><article className="detail-card wide"><h3>Launch blockers</h3>{health.blockers.map((item)=><div className="fact-row" key={item}><span>{item.replaceAll("_"," ")}</span><em className="badge warn">BLOCKER</em></div>)}</article><article className="detail-card wide"><h3>Capabilities not enabled</h3>{health.capability_not_enabled.map((item)=><div className="fact-row" key={item}><span>{item.replaceAll("_"," ")}</span><em className="badge">NOT ENABLED</em></div>)}</article></section></>;
}
function HealthCard({title,value}:{title:string;value:JsonRecord}){return <article className="detail-card"><h3>{title}</h3><Facts value={value}/></article>}

const rolloutLabels:Record<string,string>={social_feed:"Social feed",clips:"Clips",stories:"Stories",live:"LIVE discovery",marketplace_home:"Marketplace home",marketplace_search:"Marketplace search"};
type RolloutDraft={code:string;rollout_bps:number;kill_switch:boolean};
function ProductionRolloutPanel(){
  const {hasCapability}=useAdminAuth(),canManage=hasCapability("advertising.rollout.manage");
  const state=useAsync(getAdminAdvertisingRolloutControl,[]);
  const [globalPaused,setGlobalPaused]=useState(false),[placements,setPlacements]=useState<RolloutDraft[]>([]);
  const [confirmation,setConfirmation]=useState<"save"|"start"|"disarm"|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null),[mutationError,setMutationError]=useState<string|null>(null);
  const intentKeys=useRef(new Map<string,string>());
  useEffect(()=>{if(state.data){setGlobalPaused(state.data.production_delivery_paused);setPlacements(state.data.placements.map((item)=>({code:item.code,rollout_bps:item.production_rollout_bps,kill_switch:item.production_kill_switch}))) }},[state.data]);
  const keyFor=(intent:string)=>{const prior=intentKeys.current.get(intent);if(prior)return prior;const next=crypto.randomUUID();intentKeys.current.set(intent,next);return next};
  const updatePlacement=(code:string,patch:Partial<RolloutDraft>)=>setPlacements((items)=>items.map((item)=>item.code===code?{...item,...patch}:item));
  const perform=async()=>{if(!confirmation||!state.data)return;const action=confirmation;const intent=action==="save"?`rollout:${state.data.config_version}:${globalPaused}:${JSON.stringify(placements)}`:`launch:${action}`;setBusy(true);setNotice(null);setMutationError(null);try{if(action==="save"){await setAdminAdvertisingProductionRollout({expectedConfigVersion:state.data.config_version,globalPaused,placements,idempotencyKey:keyFor(intent)});setNotice("Production rollout configuration saved.")}else{await setAdminAdvertisingLaunchMode(action==="start"?"PRODUCTION":"DISARMED",keyFor(intent));setNotice(action==="start"?"Production launch transition completed.":"Production is disarmed.")}intentKeys.current.delete(intent);setConfirmation(null);state.reload()}catch(value){setMutationError(presentAdsError(value,{operation:"mutation",resource:"production rollout"}).message)}finally{setBusy(false)}};
  if(state.error&&!state.data)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Loading production rollout controls…"/>;
  const data:AdsRolloutControl=state.data;
  const confirmationCopy=confirmation==="start"?{title:"Start Ads V2 Production?",consequence:"The configured placements and rollout percentages will begin real Ads delivery. Funding, Spend, Settlement and automatic lifecycle transitions will be enabled; real Ads delivery and real money may occur.",label:"Confirm Start Production"}:confirmation==="disarm"?{title:"Disarm Ads V2 Production?",consequence:"New delivery stops globally. Desired rollout configuration remains preserved for a future owner-authorized launch.",label:"Confirm Disarm Production"}:{title:"Save production rollout configuration?",consequence:globalPaused?"New delivery stops across every placement while production configuration and canonical accounting evidence remain preserved.":"Desired placement percentages and kill switches will be saved. While DISARMED, runtime delivery remains off.",label:"Confirm rollout configuration"};
  return <section className="detail-card wide" aria-label="Production rollout controls"><p className="eyebrow">PRODUCTION ROLLOUT</p><div className="panel-title"><div><h3>{data.launch_mode}</h3><p>Global delivery: {data.launch_mode==="DISARMED"?"Disarmed":data.production_delivery_paused?"Paused":data.global_delivery_enabled?"Running":"Blocked"} · Production readiness: {data.production_ready?"Ready":"Blocked"}</p></div><strong>Config version {data.config_version}</strong></div>
    <div className="fact-row"><span>Rollout authority</span><strong>{data.rollout_version}</strong></div><div className="fact-row"><span>Open production windows</span><strong>{data.authorization_window.open_count}</strong></div>
    {mutationError&&<p role="alert" className="state-card error-state">{mutationError}</p>}{notice&&<p role="status" className="state-card success-state">{notice}</p>}
    {canManage&&<label className="fact-row"><span>Global delivery pause</span><input aria-label="Global delivery pause" type="checkbox" checked={globalPaused} onChange={(event)=>setGlobalPaused(event.target.checked)}/></label>}
    <div className="table-panel"><table className="human-table"><thead><tr><th>Placement</th><th>Configured rollout</th><th>Kill switch</th><th>Runtime</th><th>Rate coverage</th><th>Adapter</th></tr></thead><tbody>{data.placements.map((item)=>{const draft=placements.find((entry)=>entry.code===item.code)??{code:item.code,rollout_bps:item.production_rollout_bps,kill_switch:item.production_kill_switch};const label=rolloutLabels[item.code]??item.label;return <tr key={item.code}><td><strong>{label}</strong><small>{item.status} · {item.surface_verified&&item.selection_enabled?"surface ready":"not available"}</small></td><td>{canManage?<label>{label} rollout percentage<input aria-label={`${label} rollout percentage`} type="number" min="0" max="100" step="0.01" value={draft.rollout_bps/100} onChange={(event)=>{const percent=Math.max(0,Math.min(100,Number(event.target.value)||0));updatePlacement(item.code,{rollout_bps:Math.round(percent*100)})}}/></label>:`${item.rollout_percent}%`}</td><td>{canManage?<label><input aria-label={`${label} kill switch`} type="checkbox" checked={draft.kill_switch} onChange={(event)=>updatePlacement(item.code,{kill_switch:event.target.checked})}/> {draft.kill_switch?"Killed":"Available"}</label>:item.production_kill_switch?"Killed":"Available"}</td><td><em className={`badge ${item.effective_runtime_enabled?"success":""}`}>{item.effective_runtime_enabled?"enabled":"disabled"}</em></td><td><strong>{item.production_rate_coverage.covered}/{item.production_rate_coverage.required} {item.production_rate_coverage.ready?"ready":"incomplete"}</strong></td><td>{item.adapter_version}</td></tr>})}</tbody></table></div>
    {data.blockers.length>0&&<div>{data.blockers.map((blocker)=><div className="fact-row" key={blocker}><span>{blocker.replaceAll("_"," ")}</span><em className="badge warn">BLOCKER</em></div>)}</div>}
    {canManage&&<div className="filters"><button disabled={busy} onClick={()=>setConfirmation("save")}>Save configuration</button><button disabled={busy||!data.production_ready||data.launch_mode==="PRODUCTION"} onClick={()=>setConfirmation("start")}>Start Production</button><button className="danger" disabled={busy||data.launch_mode==="DISARMED"} onClick={()=>setConfirmation("disarm")}>Disarm Production</button></div>}
    <ConfirmDialog open={confirmation!==null} title={confirmationCopy.title} consequence={confirmationCopy.consequence} actionLabel={confirmationCopy.label} danger={confirmation==="disarm"} pending={busy} onCancel={()=>{if(!busy)setConfirmation(null)}} onConfirm={()=>{void perform()}}/>
  </section>;
}

export function AdminAdvertisingFinanceHealthPage(){
  const state=useAsync(getAdminAdvertisingFinanceHealth,[]);
  if(state.error&&!state.data)return <ErrorState message={state.error} onRetry={state.reload}/>;
  if(!state.data)return <LoadingState label="Ejecutando reconciliación de lectura…"/>;
  const root=state.data;
  return <><RefreshNotice error={state.error} loading={state.loading} reload={state.reload}/><Heading eyebrow="FINANCE RECONCILIATION" title="Ads V2 Finance Health" detail="Read-only wrappers over canonical Ads V2 and shared legacy escrow reconciliation."/><section className="detail-grid"><HealthCard title="Ads V2" value={obj(root.reconciliation)}/><HealthCard title="Shared legacy escrow" value={obj(root.shared_legacy_reconciliation)}/><HealthCard title="Marketplace finalization" value={obj(root.finalization)}/><HealthCard title="Marketplace events" value={obj(root.legacy_events)}/></section></>;
}

export function AdminAdvertisingBillingPage(){
  const {hasCapability}=useAdminAuth(),canManage=hasCapability("advertising.rates.manage");
  const health=useAsync(getAdminAdvertisingBillingHealth,[]),rates=useAsync(()=>searchAdminAdvertisingBillingRates({limit:100}),[]);
  const [objective,setObjective]=useState("awareness"),[eventType,setEventType]=useState<"impression"|"click">("impression"),[placement,setPlacement]=useState("social_feed"),[scope,setScope]=useState<"global"|"canary_campaign">("global"),[campaignId,setCampaignId]=useState(""),[rate,setRate]=useState(""),[effectiveFrom,setEffectiveFrom]=useState(""),[effectiveTo,setEffectiveTo]=useState(""),[reason,setReason]=useState("");
  const [editingRateId,setEditingRateId]=useState<string|null>(null),[confirmation,setConfirmation]=useState<{item:AdsBillingRate;action:"publish"|"retire"}|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null),[mutationError,setMutationError]=useState<string|null>(null);
  const intentKeys=useRef(new Map<string,string>());
  const keyFor=(intent:string)=>{const existing=intentKeys.current.get(intent);if(existing)return existing;const next=crypto.randomUUID();intentKeys.current.set(intent,next);return next};
  const runMutation=async(intent:string,operation:()=>Promise<unknown>)=>{setBusy(true);setNotice(null);setMutationError(null);try{await operation();intentKeys.current.delete(intent);setNotice("Rate policy saved. Canonical billing truth has been refreshed.");rates.reload();health.reload()}catch(value){setMutationError(presentAdsError(value,{operation:"mutation",resource:"billing rate"}).message)}finally{setBusy(false)}};
  const clearDraft=()=>{setEditingRateId(null);setObjective("awareness");setEventType("impression");setPlacement("social_feed");setScope("global");setCampaignId("");setRate("");setEffectiveFrom("");setEffectiveTo("")};
  const save=()=>{const intent=JSON.stringify({editingRateId,objective,eventType,placement,scope,campaignId,rate,effectiveFrom,effectiveTo});const payload={objective,billableEventType:eventType,placementCode:placement,scope,scopeCampaignId:scope==="canary_campaign"?campaignId:null,rateBdag:rate,effectiveFrom:new Date(effectiveFrom).toISOString(),effectiveTo:effectiveTo?new Date(effectiveTo).toISOString():null,idempotencyKey:keyFor(`${editingRateId?"update":"create"}:${intent}`)};void runMutation(`${editingRateId?"update":"create"}:${intent}`,async()=>{const result=editingRateId?await updateAdminAdvertisingBillingRateDraft(editingRateId,payload):await createAdminAdvertisingBillingRateDraft(payload);clearDraft();return result})};
  const edit=(item:AdsBillingRate)=>{const local=(value:string)=>{const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)};setEditingRateId(item.id);setObjective(item.objective);setEventType(item.billable_event_type);setPlacement(item.placement_code);setScope(item.scope);setCampaignId(item.scope_campaign_id??"");setRate(String(item.rate_bdag));setEffectiveFrom(local(item.effective_from));setEffectiveTo(item.effective_to?local(item.effective_to):"")};
  const transition=()=>{if(!confirmation)return;const {item,action}=confirmation,intent=`${action}:${item.id}:${reason.trim()}`;void runMutation(intent,async()=>{const result=action==="publish"?await publishAdminAdvertisingBillingRate(item.id,reason.trim(),keyFor(intent)):await retireAdminAdvertisingBillingRate(item.id,reason.trim(),keyFor(intent));setConfirmation(null);setReason("");return result})};
  if((health.error&&!health.data)||(rates.error&&!rates.data))return <ErrorState message={health.error??rates.error??"Ads billing unavailable"} onRetry={()=>{health.reload();rates.reload()}}/>;
  if(!health.data||!rates.data)return <LoadingState label="Loading Ads billing control plane…"/>;
  const healthRoot=health.data;
  const coverageRows=Array.isArray(healthRoot.production_rate_coverage_by_placement)?healthRoot.production_rate_coverage_by_placement.map((value)=>obj(value)):[];
  return <><RefreshNotice error={health.error??rates.error} loading={health.loading||rates.loading} reload={()=>{health.reload();rates.reload()}}/><Heading eyebrow="ADVERTISING BILLING" title="Rates & billing health" detail="Server-authoritative rate versions and operational billing readiness. Launch mode uses the canonical rollout authority."/>
    {mutationError&&<p role="alert" className="state-card error-state">{mutationError}</p>}{notice&&<p role="status" className="state-card success-state">{notice}</p>}
    <ProductionRolloutPanel/>
    <section className="detail-grid"><HealthCard title="Control plane" value={{launch_mode:healthRoot.launch_mode,billing_cutover_at:healthRoot.billing_cutover_at,pricing_policy:healthRoot.pricing_policy,production_rate_coverage_ready:healthRoot.production_rate_coverage_ready}}/><HealthCard title="Rate versions" value={obj(healthRoot.rate_versions)}/><article className="detail-card"><h3>Coverage by placement</h3>{coverageRows.length===0?<p className="muted-copy">Coverage data unavailable.</p>:coverageRows.map((row)=><div className="fact-row" key={txt(row.placement_code)}><span>{txt(row.placement_code).replaceAll("_"," ")}</span><strong>{num(row.covered_count)}/{num(row.required_count)} {row.ready===true?"ready":"incomplete"}</strong></div>)}</article><HealthCard title="Authorization windows" value={obj(healthRoot.authorization_windows)}/><HealthCard title="Materializations" value={obj(healthRoot.materializations)}/><HealthCard title="Cron jobs" value={{jobs:JSON.stringify(healthRoot.cron_jobs??[])}}/><HealthCard title="Reservation safety" value={{active_pending_reservation_anomalies:healthRoot.active_pending_reservation_anomalies}}/></section>
    {canManage&&<section className="detail-card"><h3>{editingRateId?"Edit draft rate":"Create draft rate"}</h3><p className="muted-copy">Drafts never enable billing. Publication remains prospective and cannot occur while a billing authorization window is open.</p><div className="filters"><label>Objective<select aria-label="Rate objective" value={objective} onChange={(event)=>{const value=event.target.value;setObjective(value);setEventType(["awareness","reach","video_views"].includes(value)?"impression":"click")}}><option value="awareness">Awareness</option><option value="reach">Reach</option><option value="video_views">Video views</option><option value="traffic">Traffic</option><option value="engagement">Engagement</option><option value="profile_visits">Profile visits</option><option value="messages">Messages</option><option value="app_promotion">App promotion</option><option value="marketplace_sales">Marketplace sales</option></select></label><label>Billable event<select aria-label="Billable event" value={eventType} onChange={(event)=>setEventType(event.target.value as "impression"|"click")}><option value="impression">Impression</option><option value="click">Click</option></select></label><label>Placement<select aria-label="Rate placement" value={placement} onChange={(event)=>setPlacement(event.target.value)}><option value="social_feed">Social feed</option><option value="clips">Clips</option><option value="stories">Stories</option><option value="live">LIVE discovery</option><option value="marketplace_home">Marketplace home</option><option value="marketplace_search">Marketplace search</option></select></label><label>Scope<select aria-label="Rate scope" value={scope} onChange={(event)=>setScope(event.target.value as "global"|"canary_campaign")}><option value="global">Global</option><option value="canary_campaign">Canary Campaign</option></select></label>{scope==="canary_campaign"&&<label>Campaign ID<input aria-label="Canary Campaign ID" value={campaignId} onChange={(event)=>setCampaignId(event.target.value)}/></label>}<label>Rate BDAG<input aria-label="Rate BDAG" inputMode="decimal" value={rate} onChange={(event)=>setRate(event.target.value)}/></label><label>Effective from<input aria-label="Effective from" type="datetime-local" value={effectiveFrom} onChange={(event)=>setEffectiveFrom(event.target.value)}/></label>{editingRateId&&<label>Effective to<input aria-label="Effective to" type="datetime-local" value={effectiveTo} onChange={(event)=>setEffectiveTo(event.target.value)}/></label>}<button disabled={busy||!rate||!effectiveFrom||(scope==="canary_campaign"&&!campaignId)} onClick={save}>{editingRateId?"Save draft":"Create draft"}</button>{editingRateId&&<button className="secondary" disabled={busy} onClick={clearDraft}>Cancel edit</button>}</div></section>}
    <section className="table-panel"><div className="panel-title"><div><h3>Rate versions</h3><p>Published and retired versions remain immutable evidence.</p></div>{canManage&&<label>Publish / retire reason<input aria-label="Rate action reason" maxLength={500} value={reason} onChange={(event)=>setReason(event.target.value)}/></label>}</div>{rates.data.items.length===0?<EmptyState title="No Ads billing rates" detail="No real production rate has been configured."/>:<table className="human-table"><thead><tr><th>Objective</th><th>Basis</th><th>Scope</th><th>Rate</th><th>Effective</th><th>State</th>{canManage&&<th>Action</th>}</tr></thead><tbody>{rates.data.items.map((item)=><tr key={item.id}><td>{item.objective.replaceAll("_"," ")}</td><td>{item.billable_event_type} · {item.placement_code}</td><td>{item.scope}{item.scope_campaign_id?` · ${item.scope_campaign_id}`:""}</td><td>{formatBdag(num(item.rate_bdag))}</td><td>{formatDate(item.effective_from)}</td><td><em className={`badge ${item.state==="published"?"success":item.state==="retired"?"warn":""}`}>{item.state}</em></td>{canManage&&<td>{item.state==="draft"?<><button className="secondary" disabled={busy} onClick={()=>edit(item)}>Edit</button><button disabled={busy||!reason.trim()} onClick={()=>setConfirmation({item,action:"publish"})}>Publish</button></>:item.state==="published"?<button className="danger" disabled={busy||!reason.trim()} onClick={()=>setConfirmation({item,action:"retire"})}>Retire</button>:"—"}</td>}</tr>)}</tbody></table>}</section>
    <ConfirmDialog open={Boolean(confirmation)} title={confirmation?.action==="publish"?"Publish this Ads rate?":"Retire this Ads rate?"} consequence={confirmation?.action==="publish"?"The immutable version can authorize future charges only inside an approved launch mode and billing window.":"Future applicability closes; historical charged events keep this exact rate provenance."} actionLabel={confirmation?.action==="publish"?"Publish rate":"Retire rate"} reason={reason.trim()||undefined} danger={confirmation?.action==="retire"} pending={busy} onCancel={()=>{if(!busy)setConfirmation(null)}} onConfirm={transition}/>
  </>;
}
