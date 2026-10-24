import {supabase} from "./supabase";

export type JsonRecord=Record<string,unknown>;
export type JsonPage={items:JsonRecord[];next_cursor:JsonRecord|null};

export type AdminCreatorPremiumFinanceSource="purchase"|"subscription";
export type AdminCreatorPremiumFinanceState="active"|"expired"|"revoked"|"refunded"|"cancelled";
export type AdminCreatorPremiumFinanceFilters={
  p_source:AdminCreatorPremiumFinanceSource|null;
  p_state:AdminCreatorPremiumFinanceState|null;
  p_query:string|null;
  p_cursor_created_at:string|null;
  p_cursor_reference_id:string|null;
  p_limit:number;
};
export type AdminCreatorPremiumFinanceIdentity={id:string;username:string|null;display_name:string|null;avatar_url:string|null};
export type AdminCreatorPremiumFinanceCursor={created_at:string;reference_id:string};
export type AdminCreatorPremiumFinanceItem={
  source:AdminCreatorPremiumFinanceSource;
  reference_id:string;
  financial_transaction_id:string;
  reversal_financial_transaction_id:string|null;
  content_id:string|null;
  content_title:string|null;
  plan_id:string|null;
  plan_name:string|null;
  customer:AdminCreatorPremiumFinanceIdentity;
  creator:AdminCreatorPremiumFinanceIdentity;
  access_state:"active"|"expired"|"revoked"|"refunded";
  subscription_status:"active"|"cancelled"|"expired"|"revoked"|null;
  gross_amount_bdag:string;
  platform_fee_bdag:string;
  creator_net_bdag:string;
  currency:"BDAG";
  created_at:string;
  refunded_at:string|null;
  verified:boolean;
};
export type AdminCreatorPremiumFinanceResponse={
  policy:{purchase_enabled:boolean;subscription_enabled:boolean;refunds_enabled:boolean;platform_fee_bps:number;policy_version:string};
  counts:{purchase_receipts:number;subscription_relationships:number;subscription_periods:number;refunds:number;integrity_failures:number};
  reconciliation:Record<string,number>;
  items:AdminCreatorPremiumFinanceItem[];
  next_cursor:AdminCreatorPremiumFinanceCursor|null;
};

const creatorPremiumReconciliationKeys=[
  "invalid_purchase_facts",
  "invalid_subscription_period_facts",
  "subscriptions_without_period",
  "multiple_periods_per_relationship",
  "orphan_creator_premium_transactions",
  "duplicate_open_relationships",
] as const;

const isRecord=(value:unknown):value is JsonRecord=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const record=(value:unknown,name:string):JsonRecord=>{if(!isRecord(value))throw new Error(`Respuesta inválida: ${name}`);return value};
const page=(value:unknown,name:string):JsonPage=>{const parsed=record(value,name);if(!Array.isArray(parsed.items)||!parsed.items.every(isRecord))throw new Error(`Respuesta inválida: ${name}.items`);return{items:parsed.items,next_cursor:parsed.next_cursor===null?null:record(parsed.next_cursor,`${name}.next_cursor`)}};
async function rpc(name:string,args:JsonRecord={}){const {data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.message||`No se pudo ejecutar ${name}`);return data as unknown}

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimalPattern=/^(?:0|[1-9][0-9]{0,29})\.[0-9]{8}$/;
const timestampPattern=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const exactRecord=(value:unknown,name:string,keys:readonly string[])=>{
  const parsed=record(value,name),actual=Object.keys(parsed);
  if(actual.length!==keys.length||actual.some((key)=>!keys.includes(key)))throw new Error(`Respuesta inválida: ${name}.campos`);
  return parsed;
};
const requiredString=(value:unknown,name:string)=>{if(typeof value!=="string"||value.length===0)throw new Error(`Respuesta inválida: ${name}`);return value};
const nullableString=(value:unknown,name:string)=>value===null?null:requiredString(value,name);
const requiredUuid=(value:unknown,name:string)=>{const parsed=requiredString(value,name);if(!uuidPattern.test(parsed))throw new Error(`Respuesta inválida: ${name}`);return parsed};
const nullableUuid=(value:unknown,name:string)=>value===null?null:requiredUuid(value,name);
const timestamp=(value:unknown,name:string)=>{const parsed=requiredString(value,name);if(!timestampPattern.test(parsed)||Number.isNaN(Date.parse(parsed)))throw new Error(`Respuesta inválida: ${name}`);return parsed};
const timestampMicros=(value:string,name:string)=>{const parsed=timestamp(value,name),fraction=/\.(\d{1,6})/.exec(parsed)?.[1]??"",remainder=BigInt((fraction.padEnd(6,"0")||"0"))%1000n;return BigInt(Date.parse(parsed))*1000n+remainder};
const nullableTimestamp=(value:unknown,name:string)=>value===null?null:timestamp(value,name);
const nonNegativeInteger=(value:unknown,name:string)=>{if(!Number.isInteger(value)||Number(value)<0)throw new Error(`Respuesta inválida: ${name}`);return Number(value)};
const booleanValue=(value:unknown,name:string)=>{if(typeof value!=="boolean")throw new Error(`Respuesta inválida: ${name}`);return value};
const enumValue=<T extends string>(value:unknown,name:string,allowed:readonly T[]):T=>{if(typeof value!=="string"||!allowed.includes(value as T))throw new Error(`Respuesta inválida: ${name}`);return value as T};
const nullableEnum=<T extends string>(value:unknown,name:string,allowed:readonly T[])=>value===null?null:enumValue(value,name,allowed);
const money=(value:unknown,name:string)=>{const parsed=requiredString(value,name);if(!decimalPattern.test(parsed))throw new Error(`Respuesta inválida: ${name}`);return parsed};
const financeIdentity=(value:unknown,name:string):AdminCreatorPremiumFinanceIdentity=>{
  const parsed=exactRecord(value,name,["id","username","display_name","avatar_url"]);
  const avatar=nullableString(parsed.avatar_url,`${name}.avatar_url`);
  if(avatar!==null&&!/^https:\/\//i.test(avatar))throw new Error(`Respuesta inválida: ${name}.avatar_url`);
  return{id:requiredUuid(parsed.id,`${name}.id`),username:nullableString(parsed.username,`${name}.username`),display_name:nullableString(parsed.display_name,`${name}.display_name`),avatar_url:avatar};
};

export function parseAdminCreatorPremiumFinance(value:unknown):AdminCreatorPremiumFinanceResponse{
  const parsed=exactRecord(value,"creator_premium_finance",["policy","counts","reconciliation","items","next_cursor"]);
  const policy=exactRecord(parsed.policy,"creator_premium_finance.policy",["purchase_enabled","subscription_enabled","refunds_enabled","platform_fee_bps","policy_version"]);
  const platformFeeBps=nonNegativeInteger(policy.platform_fee_bps,"creator_premium_finance.policy.platform_fee_bps");
  if(platformFeeBps>9999)throw new Error("Respuesta inválida: creator_premium_finance.policy.platform_fee_bps");
  const counts=exactRecord(parsed.counts,"creator_premium_finance.counts",["purchase_receipts","subscription_relationships","subscription_periods","refunds","integrity_failures"]);
  const rawReconciliation=exactRecord(parsed.reconciliation,"creator_premium_finance.reconciliation",creatorPremiumReconciliationKeys),reconciliation:Record<string,number>={};
  for(const [key,counter] of Object.entries(rawReconciliation)){
    reconciliation[key]=nonNegativeInteger(counter,`creator_premium_finance.reconciliation.${key}`);
  }
  if(!Array.isArray(parsed.items)||parsed.items.length>100)throw new Error("Respuesta inválida: creator_premium_finance.items");
  const items=parsed.items.map((candidate,index):AdminCreatorPremiumFinanceItem=>{
    const name=`creator_premium_finance.items.${index}`;
    const item=exactRecord(candidate,name,["source","reference_id","financial_transaction_id","reversal_financial_transaction_id","content_id","content_title","plan_id","plan_name","customer","creator","access_state","subscription_status","gross_amount_bdag","platform_fee_bdag","creator_net_bdag","currency","created_at","refunded_at","verified"]);
    const source=enumValue(item.source,`${name}.source`,["purchase","subscription"] as const);
    const accessState=enumValue(item.access_state,`${name}.access_state`,["active","expired","revoked","refunded"] as const);
    const subscriptionStatus=nullableEnum(item.subscription_status,`${name}.subscription_status`,["active","cancelled","expired","revoked"] as const);
    const reversalId=nullableUuid(item.reversal_financial_transaction_id,`${name}.reversal_financial_transaction_id`),refundedAt=nullableTimestamp(item.refunded_at,`${name}.refunded_at`);
    const contentId=nullableUuid(item.content_id,`${name}.content_id`),planId=nullableUuid(item.plan_id,`${name}.plan_id`);
    if((source==="purchase"&&(contentId===null||planId!==null||subscriptionStatus!==null))||(source==="subscription"&&(planId===null||subscriptionStatus===null)))throw new Error(`Respuesta inválida: ${name}.binding`);
    if((accessState==="refunded")!==(reversalId!==null&&refundedAt!==null))throw new Error(`Respuesta inválida: ${name}.refund`);
    return{
      source,reference_id:requiredUuid(item.reference_id,`${name}.reference_id`),financial_transaction_id:requiredUuid(item.financial_transaction_id,`${name}.financial_transaction_id`),reversal_financial_transaction_id:reversalId,
      content_id:contentId,content_title:nullableString(item.content_title,`${name}.content_title`),plan_id:planId,plan_name:nullableString(item.plan_name,`${name}.plan_name`),
      customer:financeIdentity(item.customer,`${name}.customer`),creator:financeIdentity(item.creator,`${name}.creator`),access_state:accessState,subscription_status:subscriptionStatus,
      gross_amount_bdag:money(item.gross_amount_bdag,`${name}.gross_amount_bdag`),platform_fee_bdag:money(item.platform_fee_bdag,`${name}.platform_fee_bdag`),creator_net_bdag:money(item.creator_net_bdag,`${name}.creator_net_bdag`),
      currency:enumValue(item.currency,`${name}.currency`,["BDAG"] as const),created_at:timestamp(item.created_at,`${name}.created_at`),refunded_at:refundedAt,verified:booleanValue(item.verified,`${name}.verified`),
    };
  });
  if(new Set(items.map((item)=>item.reference_id.toLowerCase())).size!==items.length)throw new Error("Respuesta inválida: creator_premium_finance.items.reference_id");
  for(let index=1;index<items.length;index+=1){
    const previous=items[index-1],current=items[index],previousTime=timestampMicros(previous.created_at,"creator_premium_finance.items.created_at"),currentTime=timestampMicros(current.created_at,"creator_premium_finance.items.created_at");
    if(previousTime<currentTime||(previousTime===currentTime&&previous.reference_id.toLowerCase()<=current.reference_id.toLowerCase()))throw new Error("Respuesta inválida: creator_premium_finance.items.order");
  }
  const rawCursor=parsed.next_cursor===null?null:exactRecord(parsed.next_cursor,"creator_premium_finance.next_cursor",["created_at","reference_id"]);
  const nextCursor=rawCursor===null?null:{created_at:timestamp(rawCursor.created_at,"creator_premium_finance.next_cursor.created_at"),reference_id:requiredUuid(rawCursor.reference_id,"creator_premium_finance.next_cursor.reference_id")};
  const lastItem=items.at(-1);
  if(nextCursor!==null&&(lastItem===undefined||timestampMicros(nextCursor.created_at,"creator_premium_finance.next_cursor.created_at")!==timestampMicros(lastItem.created_at,"creator_premium_finance.items.created_at")||nextCursor.reference_id.toLowerCase()!==lastItem.reference_id.toLowerCase()))throw new Error("Respuesta inválida: creator_premium_finance.next_cursor.binding");
  return{
    policy:{purchase_enabled:booleanValue(policy.purchase_enabled,"creator_premium_finance.policy.purchase_enabled"),subscription_enabled:booleanValue(policy.subscription_enabled,"creator_premium_finance.policy.subscription_enabled"),refunds_enabled:booleanValue(policy.refunds_enabled,"creator_premium_finance.policy.refunds_enabled"),platform_fee_bps:platformFeeBps,policy_version:requiredString(policy.policy_version,"creator_premium_finance.policy.policy_version")},
    counts:{purchase_receipts:nonNegativeInteger(counts.purchase_receipts,"creator_premium_finance.counts.purchase_receipts"),subscription_relationships:nonNegativeInteger(counts.subscription_relationships,"creator_premium_finance.counts.subscription_relationships"),subscription_periods:nonNegativeInteger(counts.subscription_periods,"creator_premium_finance.counts.subscription_periods"),refunds:nonNegativeInteger(counts.refunds,"creator_premium_finance.counts.refunds"),integrity_failures:nonNegativeInteger(counts.integrity_failures,"creator_premium_finance.counts.integrity_failures")},
    reconciliation,items,next_cursor:nextCursor,
  };
}

export async function searchAdminCreatorPremiumFinance(filters:AdminCreatorPremiumFinanceFilters):Promise<AdminCreatorPremiumFinanceResponse>{
  const source=filters.p_source===null?null:enumValue(filters.p_source,"creator_premium_finance.filters.source",["purchase","subscription"] as const);
  const state=filters.p_state===null?null:enumValue(filters.p_state,"creator_premium_finance.filters.state",["active","expired","revoked","refunded","cancelled"] as const);
  const query=filters.p_query===null?null:requiredString(filters.p_query.trim(),"creator_premium_finance.filters.query");
  if(query!==null&&query.length>120)throw new Error("Respuesta inválida: creator_premium_finance.filters.query");
  const limit=nonNegativeInteger(filters.p_limit,"creator_premium_finance.filters.limit");
  if(limit<1||limit>100)throw new Error("Respuesta inválida: creator_premium_finance.filters.limit");
  const cursorCreatedAt=filters.p_cursor_created_at===null?null:timestamp(filters.p_cursor_created_at,"creator_premium_finance.filters.cursor_created_at"),cursorReferenceId=filters.p_cursor_reference_id===null?null:requiredUuid(filters.p_cursor_reference_id,"creator_premium_finance.filters.cursor_reference_id");
  if((cursorCreatedAt===null)!==(cursorReferenceId===null))throw new Error("Respuesta inválida: creator_premium_finance.filters.cursor");
  let response:unknown;
  try{
    response=await rpc("search_admin_creator_premium_finance_v1",{p_source:source,p_state:state,p_query:query,p_cursor_created_at:cursorCreatedAt,p_cursor_reference_id:cursorReferenceId,p_limit:limit});
  }catch(reason){
    const message=reason instanceof Error?reason.message:"";
    const domainCode=message.match(/\bcreator_premium_[a-z0-9_]{1,80}\b/)?.[0];
    throw new Error(domainCode??"No se pudo consultar Creator Premium.");
  }
  return parseAdminCreatorPremiumFinance(response);
}

export const getAdminFinanceOverview=async()=>record(await rpc("get_admin_finance_overview"),"finance_overview");
export const getAdminPlatformRevenue=async(period:"today"|"month"|"year"|"all"="year")=>record(await rpc("get_admin_platform_revenue",{p_period:period}),"platform_revenue");
export const searchAdminLedgerAccounts=async(filters:JsonRecord={})=>page(await rpc("search_admin_ledger_accounts",filters),"ledger_accounts");
export const searchAdminFinancialTransactions=async(filters:JsonRecord={})=>page(await rpc("search_admin_financial_transactions",filters),"financial_transactions");
export const getAdminFinancialTransactionDetail=async(id:string)=>record(await rpc("get_admin_financial_transaction_detail",{p_transaction_id:id}),"financial_transaction_detail");
export const getAdminFinanceReconciliation=async()=>record(await rpc("get_admin_finance_reconciliation"),"finance_reconciliation");
export const searchAdminFinanceAnomalies=async(filters:JsonRecord={})=>record(await rpc("search_admin_finance_anomalies",filters),"finance_anomalies");
export const searchAdminGlobalAudit=async(filters:JsonRecord={})=>page(await rpc("search_admin_global_audit",filters),"global_audit");
export const searchAdminFinanceAudit=async(filters:JsonRecord={})=>page(await rpc("search_admin_finance_audit",filters),"finance_audit");
export const searchAdminSystemAudit=async(filters:JsonRecord={})=>page(await rpc("search_admin_system_audit",filters),"system_audit");
export const getAdminSystemHealth=async()=>record(await rpc("get_admin_system_health"),"system_health");
export const searchAdminSystemJobs=async(filters:JsonRecord={})=>record(await rpc("search_admin_system_jobs",filters),"system_jobs");
export const getAdminSystemJobDetail=async(id:string)=>record(await rpc("get_admin_system_job_detail",{p_job_id:Number(id)}),"system_job_detail");
