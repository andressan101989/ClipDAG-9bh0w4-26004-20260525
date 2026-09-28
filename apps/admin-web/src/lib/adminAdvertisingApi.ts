import type {AdminRange,Money} from "./adminApi";
import {supabase} from "./supabase";

export class AdminAdvertisingRpcError extends Error {
  code?: string;
  constructor(message:string,code?:string){super(message);this.name="AdminAdvertisingRpcError";this.code=code}
}

export type JsonRecord=Record<string,unknown>;
export type AdsCampaignCursor={created_at:string;id:string};
export type AdsCampaignSummary={
  campaign_id:string;name:string;objective:string;status:string;created_at:string;
  business:{business_account_id:string;display_name:string;status:string};
  ad_account:{id:string;name:string;status:string};
  counts:{ad_sets:number;ads:number;review_pending:number;review_approved:number;review_rejected:number};
  finance:null|{finance_status:string;budget_bdag:Money;funded_bdag:Money;spent_bdag:Money;released_bdag:Money;reserved_bdag:Money};
  delivery:{global_enabled:boolean;campaign_activation_implemented:true;activation_enabled:boolean};authority:"ads_v2";
};
export type AdsCampaignPage={items:AdsCampaignSummary[];next_cursor:AdsCampaignCursor|null;page_size:number;authority:"ads_v2"};
export type AdsOverview={authority:"ads_v2";range:AdminRange;generated_at:string;identity:JsonRecord;inventory:JsonRecord;review:JsonRecord;events:JsonRecord;conversions:JsonRecord;finance:JsonRecord;placements:JsonRecord[];objectives:JsonRecord[]};
export type AdsHealth={authority:"ads_v2";production_delivery_ready:false;blockers:string[];capability_not_enabled:string[];identity:JsonRecord;age:JsonRecord;targeting:JsonRecord;delivery:JsonRecord;lifecycle:JsonRecord;events:JsonRecord;finance:JsonRecord};
export type AdsReviewItem={id:string;name:string;status:string;review_status:string;submission_fingerprint:string|null;submitted_at:string|null;reviewed_at:string|null;campaign:JsonRecord;ad_set:JsonRecord;creative:JsonRecord;destination:JsonRecord;latest_decision:null|{event_type:string;reason_code:string|null;note:string|null;created_at:string}};
export type AdsBillingRate={
  id:string;objective:string;billable_event_type:"impression"|"click";placement_code:string;
  rate_bdag:Money;currency:"BDAG";scope:"global"|"canary_campaign";scope_campaign_id:string|null;
  state:"draft"|"published"|"retired";effective_from:string;effective_to:string|null;
  created_at:string;updated_at:string;published_at:string|null;retired_at:string|null;
};
export type AdsBillingRatePage={items:AdsBillingRate[];next_cursor:{created_at:string;id:string}|null};
export type AdsBillingRateDraftInput={objective:string;billableEventType:"impression"|"click";placementCode:string;scope:"global"|"canary_campaign";scopeCampaignId?:string|null;rateBdag:string;effectiveFrom:string;effectiveTo?:string|null;idempotencyKey:string};

const fail=(path:string):never=>{throw new Error(`Respuesta Ads V2 inválida: ${path}`)};
const record=(value:unknown,path:string):JsonRecord=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as JsonRecord:fail(path);
const array=(value:unknown,path:string):unknown[]=>Array.isArray(value)?value:fail(path);
const text=(value:unknown,path:string):string=>typeof value==="string"?value:fail(path);
const nullableText=(value:unknown,path:string):string|null=>value===null?null:text(value,path);
const number=(value:unknown,path:string):number=>typeof value==="number"&&Number.isFinite(value)?value:fail(path);
const bool=(value:unknown,path:string):boolean=>typeof value==="boolean"?value:fail(path);
const money=(value:unknown,path:string):Money=>(typeof value==="number"||typeof value==="string")&&Number.isFinite(Number(value))?value:fail(path);
const date=(value:unknown,path:string):string=>{const parsed=text(value,path);return Number.isNaN(Date.parse(parsed))?fail(path):parsed};
const uuid=(value:unknown,path:string):string=>{const parsed=text(value,path);return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)?parsed:fail(path)};
async function rpc(name:string,args:JsonRecord={}){const {data,error}=await supabase.rpc(name,args);if(error)throw new AdminAdvertisingRpcError(error.message||"No se pudo consultar Ads V2",error.code);return data as unknown}

const safeRecord=(value:unknown,path:string)=>record(value,path);
const validateCampaign=(value:unknown,path:string):AdsCampaignSummary=>{
  const row=record(value,path),business=record(row.business,`${path}.business`),account=record(row.ad_account,`${path}.ad_account`),counts=record(row.counts,`${path}.counts`),delivery=record(row.delivery,`${path}.delivery`);
  const finance=row.finance===null?null:(()=>{const item=record(row.finance,`${path}.finance`);return{finance_status:text(item.finance_status,`${path}.finance.finance_status`),budget_bdag:money(item.budget_bdag,`${path}.finance.budget_bdag`),funded_bdag:money(item.funded_bdag,`${path}.finance.funded_bdag`),spent_bdag:money(item.spent_bdag,`${path}.finance.spent_bdag`),released_bdag:money(item.released_bdag,`${path}.finance.released_bdag`),reserved_bdag:money(item.reserved_bdag,`${path}.finance.reserved_bdag`)}})();
  if(row.authority!=="ads_v2")fail(`${path}.authority`);
  if(delivery.campaign_activation_implemented!==true)fail(`${path}.delivery.campaign_activation_implemented`);
  return{campaign_id:uuid(row.campaign_id,`${path}.campaign_id`),name:text(row.name,`${path}.name`),objective:text(row.objective,`${path}.objective`),status:text(row.status,`${path}.status`),created_at:date(row.created_at,`${path}.created_at`),business:{business_account_id:uuid(business.business_account_id,`${path}.business.id`),display_name:text(business.display_name,`${path}.business.display_name`),status:text(business.status,`${path}.business.status`)},ad_account:{id:uuid(account.id,`${path}.ad_account.id`),name:text(account.name,`${path}.ad_account.name`),status:text(account.status,`${path}.ad_account.status`)},counts:{ad_sets:number(counts.ad_sets,`${path}.counts.ad_sets`),ads:number(counts.ads,`${path}.counts.ads`),review_pending:number(counts.review_pending,`${path}.counts.review_pending`),review_approved:number(counts.review_approved,`${path}.counts.review_approved`),review_rejected:number(counts.review_rejected,`${path}.counts.review_rejected`)},finance,delivery:{global_enabled:bool(delivery.global_enabled,`${path}.delivery.global_enabled`),campaign_activation_implemented:true,activation_enabled:delivery.activation_enabled===true},authority:"ads_v2"};
};

export async function searchAdminAdvertisingCampaigns(input:{query?:string;objective?:string;status?:string;cursor?:AdsCampaignCursor;limit?:number}):Promise<AdsCampaignPage>{
  const root=record(await rpc("search_admin_advertising_campaigns",{p_query:input.query||null,p_objective:input.objective||null,p_status:input.status||null,p_cursor_created_at:input.cursor?.created_at||null,p_cursor_id:input.cursor?.id||null,p_limit:input.limit??50}),"campaigns");
  if(root.authority!=="ads_v2")fail("campaigns.authority");
  const next=root.next_cursor===null?null:(()=>{const cursor=record(root.next_cursor,"next_cursor");return{created_at:date(cursor.created_at,"next_cursor.created_at"),id:uuid(cursor.id,"next_cursor.id")}})();
  return{items:array(root.items,"items").map((item,index)=>validateCampaign(item,`items[${index}]`)),next_cursor:next,page_size:number(root.page_size,"page_size"),authority:"ads_v2"};
}

export async function getAdminAdvertisingCampaignDetail(campaignId:string){uuid(campaignId,"campaignId");const root=record(await rpc("get_admin_advertising_campaign_detail",{p_campaign_id:campaignId}),"campaign_detail");if(root.authority!=="ads_v2")fail("campaign_detail.authority");return root}

export async function getAdminAdvertisingOverview(range:AdminRange):Promise<AdsOverview>{
  const root=record(await rpc("get_admin_advertising_overview",{p_range:range}),"overview");if(root.authority!=="ads_v2"||root.range!==range)fail("overview.authority");
  return{authority:"ads_v2",range,generated_at:date(root.generated_at,"overview.generated_at"),identity:safeRecord(root.identity,"overview.identity"),inventory:safeRecord(root.inventory,"overview.inventory"),review:safeRecord(root.review,"overview.review"),events:safeRecord(root.events,"overview.events"),conversions:safeRecord(root.conversions,"overview.conversions"),finance:safeRecord(root.finance,"overview.finance"),placements:array(root.placements,"overview.placements").map((item,index)=>record(item,`overview.placements[${index}]`)),objectives:array(root.objectives,"overview.objectives").map((item,index)=>record(item,`overview.objectives[${index}]`))};
}

export async function getAdminAdvertisingHealth():Promise<AdsHealth>{
  const root=record(await rpc("get_admin_advertising_health"),"health");if(root.authority!=="ads_v2"||root.production_delivery_ready!==false)fail("health.readiness");
  return{authority:"ads_v2",production_delivery_ready:false,blockers:array(root.blockers,"health.blockers").map((item)=>text(item,"health.blocker")),capability_not_enabled:array(root.capability_not_enabled,"health.capability_not_enabled").map((item)=>text(item,"health.capability")),identity:record(root.identity,"health.identity"),age:record(root.age,"health.age"),targeting:record(root.targeting,"health.targeting"),delivery:record(root.delivery,"health.delivery"),lifecycle:record(root.lifecycle,"health.lifecycle"),events:record(root.events,"health.events"),finance:record(root.finance,"health.finance")};
}

export async function getAdminAdvertisingFinanceHealth(){const root=record(await rpc("get_admin_advertising_finance_health"),"finance_health");if(root.authority!=="ads_v2")fail("finance_health.authority");return root}

export async function getAdminAdvertisingBillingHealth(){const root=record(await rpc("get_admin_advertising_billing_health"),"billing_health");if(root.authority!=="ads_v2")fail("billing_health.authority");return root}

const validateBillingRate=(value:unknown,path:string):AdsBillingRate=>{const row=record(value,path);const scopeCampaignId=row.scope_campaign_id===null?null:uuid(row.scope_campaign_id,`${path}.scope_campaign_id`);const state=text(row.state,`${path}.state`);const scope=text(row.scope,`${path}.scope`);const event=text(row.billable_event_type,`${path}.billable_event_type`);if(!["draft","published","retired"].includes(state))fail(`${path}.state`);if(!["global","canary_campaign"].includes(scope))fail(`${path}.scope`);if(!["impression","click"].includes(event))fail(`${path}.billable_event_type`);return{id:uuid(row.id,`${path}.id`),objective:text(row.objective,`${path}.objective`),billable_event_type:event as AdsBillingRate["billable_event_type"],placement_code:text(row.placement_code,`${path}.placement_code`),rate_bdag:money(row.rate_bdag,`${path}.rate_bdag`),currency:text(row.currency,`${path}.currency`) as "BDAG",scope:scope as AdsBillingRate["scope"],scope_campaign_id:scopeCampaignId,state:state as AdsBillingRate["state"],effective_from:date(row.effective_from,`${path}.effective_from`),effective_to:row.effective_to===null?null:date(row.effective_to,`${path}.effective_to`),created_at:date(row.created_at,`${path}.created_at`),updated_at:date(row.updated_at,`${path}.updated_at`),published_at:row.published_at===null?null:date(row.published_at,`${path}.published_at`),retired_at:row.retired_at===null?null:date(row.retired_at,`${path}.retired_at`)}};

export async function searchAdminAdvertisingBillingRates(input:{state?:string;scope?:string;cursor?:{created_at:string;id:string};limit?:number}={}):Promise<AdsBillingRatePage>{const root=record(await rpc("search_admin_advertising_billing_rates",{p_state:input.state||null,p_scope:input.scope||null,p_cursor_created_at:input.cursor?.created_at||null,p_cursor_id:input.cursor?.id||null,p_limit:input.limit??50}),"billing_rates");const next=root.next_cursor===null?null:(()=>{const cursor=record(root.next_cursor,"billing_rates.next_cursor");return{created_at:date(cursor.created_at,"billing_rates.next_cursor.created_at"),id:uuid(cursor.id,"billing_rates.next_cursor.id")}})();return{items:array(root.items,"billing_rates.items").map((item,index)=>validateBillingRate(item,`billing_rates.items[${index}]`)),next_cursor:next}}

const rateArgs=(input:AdsBillingRateDraftInput)=>({p_objective:input.objective,p_billable_event_type:input.billableEventType,p_placement_code:input.placementCode,p_scope:input.scope,p_scope_campaign_id:input.scopeCampaignId||null,p_rate_bdag:input.rateBdag,p_effective_from:input.effectiveFrom,p_idempotency_key:input.idempotencyKey});
export async function createAdminAdvertisingBillingRateDraft(input:AdsBillingRateDraftInput){return record(await rpc("admin_create_advertising_billing_rate_draft_v2",rateArgs(input)),"rate_create")}
export async function updateAdminAdvertisingBillingRateDraft(rateId:string,input:AdsBillingRateDraftInput){uuid(rateId,"rateId");return record(await rpc("admin_update_advertising_billing_rate_draft_v2",{p_rate_id:rateId,...rateArgs(input),p_effective_to:input.effectiveTo||null}),"rate_update")}
export async function publishAdminAdvertisingBillingRate(rateId:string,reason:string,idempotencyKey:string){uuid(rateId,"rateId");uuid(idempotencyKey,"idempotencyKey");return record(await rpc("admin_publish_advertising_billing_rate_v2",{p_rate_id:rateId,p_reason:reason,p_idempotency_key:idempotencyKey}),"rate_publish")}
export async function retireAdminAdvertisingBillingRate(rateId:string,reason:string,idempotencyKey:string){uuid(rateId,"rateId");uuid(idempotencyKey,"idempotencyKey");return record(await rpc("admin_retire_advertising_billing_rate_v2",{p_rate_id:rateId,p_reason:reason,p_idempotency_key:idempotencyKey}),"rate_retire")}

export async function searchAdminAdvertisingAds(reviewStatus?:string):Promise<AdsReviewItem[]>{
  const root=record(await rpc("search_admin_advertising_ads",{p_review_status:reviewStatus||null,p_limit:100}),"review_queue");
  return array(root.items,"review_queue.items").map((entry,index)=>{const path=`review_queue.items[${index}]`,row=record(entry,path);const decision=row.latest_decision===null?null:(()=>{const item=record(row.latest_decision,`${path}.latest_decision`);return{event_type:text(item.event_type,`${path}.latest_decision.event_type`),reason_code:nullableText(item.reason_code,`${path}.latest_decision.reason_code`),note:nullableText(item.note,`${path}.latest_decision.note`),created_at:date(item.created_at,`${path}.latest_decision.created_at`)}})();return{id:uuid(row.id,`${path}.id`),name:text(row.name,`${path}.name`),status:text(row.status,`${path}.status`),review_status:text(row.review_status,`${path}.review_status`),submission_fingerprint:nullableText(row.submission_fingerprint,`${path}.submission_fingerprint`),submitted_at:row.submitted_at===null?null:date(row.submitted_at,`${path}.submitted_at`),reviewed_at:row.reviewed_at===null?null:date(row.reviewed_at,`${path}.reviewed_at`),campaign:record(row.campaign,`${path}.campaign`),ad_set:record(row.ad_set,`${path}.ad_set`),creative:record(row.creative,`${path}.creative`),destination:record(row.destination,`${path}.destination`),latest_decision:decision}});
}

export async function reviewAdvertisingAd(input:{adId:string;action:"approve"|"reject";reasonCode?:string;note?:string;idempotencyKey:string}){uuid(input.adId,"adId");uuid(input.idempotencyKey,"idempotencyKey");return record(await rpc("admin_review_advertising_ad",{p_ad_id:input.adId,p_action:input.action,p_reason_code:input.reasonCode||null,p_note:input.note||null,p_idempotency_key:input.idempotencyKey}),"review_result")}
