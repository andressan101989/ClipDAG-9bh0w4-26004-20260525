import type {AdminRange,Money} from "./adminApi";
import {supabase} from "./supabase";

export type JsonRecord=Record<string,unknown>;
export type AdsCampaignCursor={created_at:string;id:string};
export type AdsCampaignSummary={
  campaign_id:string;name:string;objective:string;status:string;created_at:string;
  business:{business_account_id:string;display_name:string;status:string};
  ad_account:{id:string;name:string;status:string};
  counts:{ad_sets:number;ads:number;review_pending:number;review_approved:number;review_rejected:number};
  finance:null|{finance_status:string;budget_bdag:Money;funded_bdag:Money;spent_bdag:Money;released_bdag:Money;reserved_bdag:Money};
  delivery:{global_enabled:boolean;campaign_activation_implemented:false};authority:"ads_v2";
};
export type AdsCampaignPage={items:AdsCampaignSummary[];next_cursor:AdsCampaignCursor|null;page_size:number;authority:"ads_v2"};
export type AdsOverview={authority:"ads_v2";range:AdminRange;generated_at:string;identity:JsonRecord;inventory:JsonRecord;review:JsonRecord;events:JsonRecord;conversions:JsonRecord;finance:JsonRecord;placements:JsonRecord[];objectives:JsonRecord[]};
export type AdsHealth={authority:"ads_v2";production_delivery_ready:false;blockers:string[];capability_not_enabled:string[];identity:JsonRecord;age:JsonRecord;targeting:JsonRecord;delivery:JsonRecord;events:JsonRecord;finance:JsonRecord};
export type AdsReviewItem={id:string;name:string;status:string;review_status:string;submitted_at:string|null;reviewed_at:string|null;campaign:JsonRecord;ad_set:JsonRecord;creative:JsonRecord;destination:JsonRecord;latest_decision:null|{event_type:string;reason_code:string|null;created_at:string}};

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
async function rpc(name:string,args:JsonRecord={}){const {data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.message||"No se pudo consultar Ads V2");return data as unknown}

const safeRecord=(value:unknown,path:string)=>record(value,path);
const validateCampaign=(value:unknown,path:string):AdsCampaignSummary=>{
  const row=record(value,path),business=record(row.business,`${path}.business`),account=record(row.ad_account,`${path}.ad_account`),counts=record(row.counts,`${path}.counts`),delivery=record(row.delivery,`${path}.delivery`);
  const finance=row.finance===null?null:(()=>{const item=record(row.finance,`${path}.finance`);return{finance_status:text(item.finance_status,`${path}.finance.finance_status`),budget_bdag:money(item.budget_bdag,`${path}.finance.budget_bdag`),funded_bdag:money(item.funded_bdag,`${path}.finance.funded_bdag`),spent_bdag:money(item.spent_bdag,`${path}.finance.spent_bdag`),released_bdag:money(item.released_bdag,`${path}.finance.released_bdag`),reserved_bdag:money(item.reserved_bdag,`${path}.finance.reserved_bdag`)}})();
  if(row.authority!=="ads_v2")fail(`${path}.authority`);
  return{campaign_id:uuid(row.campaign_id,`${path}.campaign_id`),name:text(row.name,`${path}.name`),objective:text(row.objective,`${path}.objective`),status:text(row.status,`${path}.status`),created_at:date(row.created_at,`${path}.created_at`),business:{business_account_id:uuid(business.business_account_id,`${path}.business.id`),display_name:text(business.display_name,`${path}.business.display_name`),status:text(business.status,`${path}.business.status`)},ad_account:{id:uuid(account.id,`${path}.ad_account.id`),name:text(account.name,`${path}.ad_account.name`),status:text(account.status,`${path}.ad_account.status`)},counts:{ad_sets:number(counts.ad_sets,`${path}.counts.ad_sets`),ads:number(counts.ads,`${path}.counts.ads`),review_pending:number(counts.review_pending,`${path}.counts.review_pending`),review_approved:number(counts.review_approved,`${path}.counts.review_approved`),review_rejected:number(counts.review_rejected,`${path}.counts.review_rejected`)},finance,delivery:{global_enabled:bool(delivery.global_enabled,`${path}.delivery.global_enabled`),campaign_activation_implemented:false},authority:"ads_v2"};
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
  return{authority:"ads_v2",production_delivery_ready:false,blockers:array(root.blockers,"health.blockers").map((item)=>text(item,"health.blocker")),capability_not_enabled:array(root.capability_not_enabled,"health.capability_not_enabled").map((item)=>text(item,"health.capability")),identity:record(root.identity,"health.identity"),age:record(root.age,"health.age"),targeting:record(root.targeting,"health.targeting"),delivery:record(root.delivery,"health.delivery"),events:record(root.events,"health.events"),finance:record(root.finance,"health.finance")};
}

export async function getAdminAdvertisingFinanceHealth(){const root=record(await rpc("get_admin_advertising_finance_health"),"finance_health");if(root.authority!=="ads_v2")fail("finance_health.authority");return root}

export async function searchAdminAdvertisingAds(reviewStatus?:string):Promise<AdsReviewItem[]>{
  const root=record(await rpc("search_admin_advertising_ads",{p_review_status:reviewStatus||null,p_limit:100}),"review_queue");
  return array(root.items,"review_queue.items").map((entry,index)=>{const path=`review_queue.items[${index}]`,row=record(entry,path);const decision=row.latest_decision===null?null:(()=>{const item=record(row.latest_decision,`${path}.latest_decision`);return{event_type:text(item.event_type,`${path}.latest_decision.event_type`),reason_code:nullableText(item.reason_code,`${path}.latest_decision.reason_code`),created_at:date(item.created_at,`${path}.latest_decision.created_at`)}})();return{id:uuid(row.id,`${path}.id`),name:text(row.name,`${path}.name`),status:text(row.status,`${path}.status`),review_status:text(row.review_status,`${path}.review_status`),submitted_at:row.submitted_at===null?null:date(row.submitted_at,`${path}.submitted_at`),reviewed_at:row.reviewed_at===null?null:date(row.reviewed_at,`${path}.reviewed_at`),campaign:record(row.campaign,`${path}.campaign`),ad_set:record(row.ad_set,`${path}.ad_set`),creative:record(row.creative,`${path}.creative`),destination:record(row.destination,`${path}.destination`),latest_decision:decision}});
}

export async function reviewAdvertisingAd(input:{adId:string;action:"approve"|"reject";reasonCode?:string;note?:string;idempotencyKey:string}){uuid(input.adId,"adId");uuid(input.idempotencyKey,"idempotencyKey");return record(await rpc("admin_review_advertising_ad",{p_ad_id:input.adId,p_action:input.action,p_reason_code:input.reasonCode||null,p_note:input.note||null,p_idempotency_key:input.idempotencyKey}),"review_result")}
