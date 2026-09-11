import {supabase} from "./supabase";

export type JsonRecord=Record<string,unknown>;
export type JsonPage={items:JsonRecord[];next_cursor:JsonRecord|null};

const isRecord=(value:unknown):value is JsonRecord=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const record=(value:unknown,name:string):JsonRecord=>{if(!isRecord(value))throw new Error(`Respuesta inválida: ${name}`);return value};
const page=(value:unknown,name:string):JsonPage=>{const parsed=record(value,name);if(!Array.isArray(parsed.items)||!parsed.items.every(isRecord))throw new Error(`Respuesta inválida: ${name}.items`);return{items:parsed.items,next_cursor:parsed.next_cursor===null?null:record(parsed.next_cursor,`${name}.next_cursor`)}};
async function rpc(name:string,args:JsonRecord={}){const {data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.message||`No se pudo ejecutar ${name}`);return data as unknown}

export const getAdminFinanceOverview=async()=>record(await rpc("get_admin_finance_overview"),"finance_overview");
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
