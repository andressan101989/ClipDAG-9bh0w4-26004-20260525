import {beforeEach,expect,it,vi} from "vitest";
import {supabase} from "../lib/supabase";
import {issueAdminUserWarning,moderateAdminUser} from "../lib/adminApi";
import {createAdminCommandCoordinator} from "../lib/adminCommandRetry";
vi.mock("../lib/supabase",()=>({supabase:{functions:{invoke:vi.fn()}}}));
const id="11111111-1111-4111-8111-111111111111",input={targetUserId:id,reason:"Motivo humano",idempotencyKey:id};
beforeEach(()=>vi.resetAllMocks());
it.each([issueAdminUserWarning,(value:typeof input)=>moderateAdminUser({...value,action:"suspend"})])("preserves Edge HTTP status so an authorization denial retires its command",async(service)=>{
 vi.mocked(supabase.functions.invoke).mockResolvedValue({data:null,error:{message:"Edge Function returned a non-2xx status code",context:new Response(null,{status:403})}} as never);
 let sequence=0;const coordinator=createAdminCommandCoordinator(()=>`key-${++sequence}`);coordinator.observe("actor",{warning:input});const keys:string[]=[];
 for(let n=0;n<2;n++)await expect(coordinator.run("warning",input,async key=>{keys.push(key);await service(input)})).rejects.toMatchObject({status:403});
 expect(keys).toEqual(["key-1","key-2"]);
});
it("preserves a retry UUID through Edge 503 responses",async()=>{
 vi.mocked(supabase.functions.invoke).mockResolvedValue({data:null,error:{message:"Edge Function returned a non-2xx status code",context:new Response(null,{status:503})}} as never);
 const coordinator=createAdminCommandCoordinator(()=>"same-key"),keys:string[]=[];coordinator.observe("actor",{warning:input});
 for(let n=0;n<2;n++)await expect(coordinator.run("warning",input,async key=>{keys.push(key);await issueAdminUserWarning(input)})).rejects.toMatchObject({status:503});
 expect(keys).toEqual(["same-key","same-key"]);
});
