import {beforeEach,expect,it,vi} from "vitest";
import {supabase} from "../lib/supabase";
import {getAdminControlCenterOverview} from "../lib/adminControlCenterApi";
import {searchAdminAdvertisingAdsPage,searchAdminAdvertisingAds} from "../lib/adminAdvertisingApi";
vi.mock("../lib/supabase",()=>({supabase:{rpc:vi.fn()}}));
beforeEach(()=>vi.resetAllMocks());
const range={from:"2026-10-01",to:"2026-10-30"},id="11111111-1111-4111-8111-111111111111";
const result={authority:"admin_control_center_v1",module:"users",...range,timezone:"UTC",metrics:[{key:"users",label:"Users",value:0,unit:"count",source:"auth.users",reason:null}],series:[{day:"2026-10-01",value:0}],recent:[]};
const response=(data:unknown)=>vi.mocked(supabase.rpc).mockResolvedValue({data,error:null} as never);
it("passes bounded dates only and validates the echoed authority",async()=>{
 response(result);expect((await getAdminControlCenterOverview("users",range)).metrics[0].value).toBe(0);
 expect(supabase.rpc).toHaveBeenCalledWith("get_admin_control_center_overview_v1",{p_module:"users",p_from:range.from,p_to:range.to});
 response({...result,to:"2026-10-29"});await expect(getAdminControlCenterOverview("users",range)).rejects.toThrow();
 vi.mocked(supabase.rpc).mockClear();await expect(getAdminControlCenterOverview("users",{from:"2026-01-01",to:"2026-12-31"})).rejects.toThrow();expect(supabase.rpc).not.toHaveBeenCalled();
});
it("bounds concurrent dashboard reads instead of starting the full fan-out",async()=>{
 const modules=["users","content","stories","live","marketplace","finance"] as const,deferred:Array<{module:string;resolve:(value:unknown)=>void}>=[];
 vi.mocked(supabase.rpc).mockImplementation((_,args)=>new Promise(resolve=>deferred.push({module:String((args as Record<string,unknown>).p_module),resolve})) as never);
 const reads=modules.map(module=>getAdminControlCenterOverview(module,range));
 await Promise.resolve();
 expect(supabase.rpc).toHaveBeenCalledTimes(4);
 for(let index=0;index<modules.length;index++){
   while(!deferred[index])await Promise.resolve();
   const module=deferred[index].module;
   deferred[index].resolve({data:{...result,module,metrics:[{...result.metrics[0],key:module,label:module}]},error:null});
 }
 await expect(Promise.all(reads)).resolves.toHaveLength(6);
 expect(supabase.rpc).toHaveBeenCalledTimes(6);
});
it("passes AbortSignal to Supabase and removes an aborted queued read before it starts",async()=>{
 const modules=["users","content","stories","live"] as const;
 const deferred:Array<{module:string;signal?:AbortSignal;resolve:(value:unknown)=>void}>=[];
 vi.mocked(supabase.rpc).mockImplementation((_,args)=>{
  const module=String((args as Record<string,unknown>).p_module);
  return {abortSignal:vi.fn((signal:AbortSignal)=>new Promise(resolve=>deferred.push({module,signal,resolve})))} as never;
 });
 const activeControllers=modules.map(()=>new AbortController());
 const activeReads=modules.map((module,index)=>getAdminControlCenterOverview(module,range,activeControllers[index].signal));
 const queuedController=new AbortController();
 const queuedRead=getAdminControlCenterOverview("marketplace",range,queuedController.signal);
 await Promise.resolve();
 expect(supabase.rpc).toHaveBeenCalledTimes(4);
 expect(deferred.map(item=>item.signal)).toEqual(activeControllers.map(item=>item.signal));
 queuedController.abort();
 await expect(queuedRead).rejects.toMatchObject({name:"AbortError"});
 expect(supabase.rpc).toHaveBeenCalledTimes(4);
 expect(vi.mocked(supabase.rpc).mock.calls.some(([,args])=>(args as Record<string,unknown>).p_module==="marketplace")).toBe(false);
 for(const item of deferred)item.resolve({data:{...result,module:item.module,metrics:[{...result.metrics[0],key:item.module,label:item.module}]},error:null});
 await expect(Promise.all(activeReads)).resolves.toHaveLength(4);
});
it("rejects identities, duplicate metrics and impossible negative count buckets",async()=>{
 for(const bad of [{...result,email:"private@example.test"},{...result,metrics:[...result.metrics,...result.metrics]},{...result,series:[{day:"2026-10-01",value:-1}]}]){response(bad);await expect(getAdminControlCenterOverview("users",range)).rejects.toThrow()}
});
it("keeps server denial distinct from read failure without exposing SQL text",async()=>{
 for(const code of ["42501","XX000"]){vi.mocked(supabase.rpc).mockResolvedValue({data:null,error:{code,message:"SQLSTATE private.users"}} as never);try{await getAdminControlCenterOverview("users",range);throw Error("unexpected success")}catch(reason){expect(reason).toMatchObject({code});expect(String(reason)).not.toMatch(/SQLSTATE|private\.users/)}}
});
it("uses exact review target reconciliation and a nullable keyset instead of a maximum-100 window",async()=>{
 response({items:[],next_cursor:null});await searchAdminAdvertisingAds("",id);
 expect(supabase.rpc).toHaveBeenLastCalledWith("search_admin_advertising_ads",{p_review_status:null,p_limit:1,p_ad_id:id,p_cursor_id:null,p_cursor_submitted_at:null});
 await searchAdminAdvertisingAdsPage({reviewStatus:"pending",cursor:{submitted_at:null,id},limit:50});
 expect(supabase.rpc).toHaveBeenLastCalledWith("search_admin_advertising_ads",{p_review_status:"pending",p_limit:50,p_ad_id:null,p_cursor_id:id,p_cursor_submitted_at:null});
});
it("rejects malformed review cursor timestamps before RPC and rejects unbound server cursors",async()=>{
 response({items:[],next_cursor:null});await expect(searchAdminAdvertisingAdsPage({cursor:{submitted_at:"2026-10-01",id}})).rejects.toThrow();expect(supabase.rpc).not.toHaveBeenCalled();
 response({items:[],next_cursor:{id,submitted_at:null}});await expect(searchAdminAdvertisingAdsPage()).rejects.toThrow();
});
