import {expect,it} from "vitest";
import {createAdminCommandCoordinator} from "../lib/adminCommandRetry";
const uncertain=()=>Promise.reject(new TypeError("response lost"));
it.each([
 {status:400},{status:401},{status:403},{status:409},{status:500},{status:503},{status:408},{status:429},{status:499},{code:"08006"},{code:"57014"},{code:"PGRST000"},new TypeError("Failed to fetch"),new DOMException("timeout","AbortError"),new Error("Respuesta inválida"),
])("retains the UUID when the result is uncertain: %o",async(error)=>{
 let sequence=0;const commands=createAdminCommandCoordinator(()=>`key-${++sequence}`),keys:string[]=[];
 commands.observe("actor",{warning:{id:"resource",reason:"reason"}});
 for(let i=0;i<2;i++)await expect(commands.run("warning",{id:"resource",reason:"reason"},async key=>{keys.push(key);throw error})).rejects.toBe(error);
 expect(keys).toEqual(["key-1","key-1"]);
});
it.each([{status:400,rejectionCode:"invalid_request"},{status:401,rejectionCode:"unauthorized"},{status:403,rejectionCode:"forbidden"},{status:409,rejectionCode:"idempotency_conflict"},{code:"42501"},{code:"P0001"},{code:"23505"},{code:"PGRST301"}])("retires the UUID on a definitive denial: %o",async(error)=>{
 let sequence=0;const commands=createAdminCommandCoordinator(()=>`key-${++sequence}`),keys:string[]=[];
 for(let i=0;i<2;i++)await expect(commands.run("command",{},async key=>{keys.push(key);throw error})).rejects.toBe(error);
 expect(keys).toEqual(["key-1","key-2"]);
});
it("isolates commands and retains an unrelated unresolved form",async()=>{
 let sequence=0;const commands=createAdminCommandCoordinator(()=>`key-${++sequence}`),keys:string[]=[];
 commands.observe("actor",{warning:{id:"one",reason:"first"},moderation:{id:"one",reason:"second"}});
 await expect(commands.run("warning",{id:"one",reason:"first"},async key=>{keys.push(key);await uncertain()})).rejects.toThrow();
 commands.observe("actor",{warning:{id:"one",reason:"first"},moderation:{id:"one",reason:"edited"}});
 await commands.run("moderation",{id:"one",action:"suspend",reason:"edited"},async key=>{keys.push(key)});
 await expect(commands.run("warning",{reason:"first",id:"one"},async key=>{keys.push(key);await uncertain()})).rejects.toThrow();
 expect(keys).toEqual(["key-1","key-2","key-1"]);
});
it("rotates across different actors, resources, actions and reasons",async()=>{
 let sequence=0;const commands=createAdminCommandCoordinator(()=>`key-${++sequence}`),keys:string[]=[];
 for(const [actor,id,action,reason] of [["one","target","hide","reason"],["two","target","hide","reason"],["one","target","hide","reason"],["one","other","hide","reason"],["one","other","restore","reason"],["one","other","restore","new reason"]]){
 commands.observe(actor,{command:{id,reason}});await expect(commands.run("command",{id,action,reason},async key=>{keys.push(key);await uncertain()})).rejects.toThrow();
 }
 expect(keys).toEqual(["key-1","key-2","key-3","key-4","key-5","key-6"]);
});
it("blocks overlapping different commands until the first settles and refuses cancellation in flight",async()=>{
 let finish!:()=>void;const commands=createAdminCommandCoordinator(()=>"key");let requests=0;
 const first=commands.run("first",{},async()=>{requests++;await new Promise<void>(resolve=>{finish=resolve})});commands.reset();
 expect(await commands.run("second",{},async()=>{requests++})).toBe(false);expect(requests).toBe(1);finish();expect(await first).toBe(true);
});
