import {beforeEach,expect,it,vi} from "vitest";
import {supabase} from "../lib/supabase";
import {issueAdminUserWarning,moderateAdminUser} from "../lib/adminApi";
import {createAdminCommandCoordinator} from "../lib/adminCommandRetry";
vi.mock("../lib/supabase",()=>({supabase:{functions:{invoke:vi.fn()}}}));
const id="11111111-1111-4111-8111-111111111111",input={targetUserId:id,reason:"Motivo humano",idempotencyKey:id};
beforeEach(()=>vi.resetAllMocks());
it.each([issueAdminUserWarning,(value:typeof input)=>moderateAdminUser({...value,action:"suspend"})])("preserves Edge HTTP status so an authorization denial retires its command",async(service)=>{
 vi.mocked(supabase.functions.invoke).mockResolvedValue({data:null,error:{message:"Edge Function returned a non-2xx status code",context:Response.json({error:"forbidden"},{status:403})}} as never);
 let sequence=0;const coordinator=createAdminCommandCoordinator(()=>`key-${++sequence}`);coordinator.observe("actor",{warning:input});const keys:string[]=[];
 for(let n=0;n<2;n++)await expect(coordinator.run("warning",input,async key=>{keys.push(key);await service(input)})).rejects.toMatchObject({status:403,rejectionCode:"forbidden"});
 expect(keys).toEqual(["key-1","key-2"]);
});
it("preserves a retry UUID through Edge 503 responses",async()=>{
 vi.mocked(supabase.functions.invoke).mockResolvedValue({data:null,error:{message:"Edge Function returned a non-2xx status code",context:new Response(null,{status:503})}} as never);
 const coordinator=createAdminCommandCoordinator(()=>"same-key"),keys:string[]=[];coordinator.observe("actor",{warning:input});
 for(let n=0;n<2;n++)await expect(coordinator.run("warning",input,async key=>{keys.push(key);await issueAdminUserWarning(input)})).rejects.toMatchObject({status:503});
 expect(keys).toEqual(["same-key","same-key"]);
});

it.each([{error:"warning_failed"},{error:"prepare_failed"},{error:"unexpected_failure",code:"42501",details:"sensitive upstream failure"},{}])("retains the UUID for unrecognized HTTP 400 Edge responses: %o",async(body)=>{
 vi.mocked(supabase.functions.invoke).mockImplementation(async()=>({data:null,error:{message:"Edge Function returned a non-2xx status code",context:Response.json(body,{status:400})}} as never));
 let sequence=0;const coordinator=createAdminCommandCoordinator(()=>`key-${++sequence}`),keys:string[]=[];
 for(let n=0;n<2;n++)await expect(coordinator.run("warning",input,async key=>{keys.push(key);await issueAdminUserWarning(input)})).rejects.toMatchObject({status:400,code:null});
 expect(keys).toEqual(["key-1","key-1"]);
});
it.each([[400,"invalid_request"],[400,"warning_limit_reached"],[401,"unauthorized"],[403,"forbidden"],[409,"idempotency_conflict"]] as const)("retires only a verified Edge rejection %i/%s without leaking response detail",async(status,rejectionCode)=>{
 vi.mocked(supabase.functions.invoke).mockImplementation(async()=>({data:null,error:{message:"Edge Function returned a non-2xx status code",context:Response.json({error:rejectionCode,details:"private provider state",message:"sensitive SQL query"},{status})}} as never));
 let sequence=0;const coordinator=createAdminCommandCoordinator(()=>`key-${++sequence}`),keys:string[]=[];
 for(let n=0;n<2;n++)await expect(coordinator.run("warning",input,async key=>{keys.push(key);try{await issueAdminUserWarning(input)}catch(error){expect(String(error)).not.toMatch(/private provider|sensitive SQL/);throw error}})).rejects.toMatchObject({status,rejectionCode});
 expect(keys).toEqual(["key-1","key-2"]);
});
it.each([[403,{error:"invalid_request"}],[400,{error:"forbidden"}],[400,{error:"command_mismatch"}],[503,{error:"forbidden"}],[401,null]] as const)("retains intent when the discriminator and HTTP status do not prove rejection: %i/%o",async(status,body)=>{
 vi.mocked(supabase.functions.invoke).mockImplementation(async()=>({data:null,error:{message:"Edge failure",context:body?Response.json(body,{status}):new Response("upstream connection lost",{status})}} as never));
 let sequence=0;const coordinator=createAdminCommandCoordinator(()=>`key-${++sequence}`),keys:string[]=[];
 for(let n=0;n<2;n++)await expect(coordinator.run("warning",input,async key=>{keys.push(key);await issueAdminUserWarning(input)})).rejects.toMatchObject({status});
 expect(keys).toEqual(["key-1","key-1"]);
});
