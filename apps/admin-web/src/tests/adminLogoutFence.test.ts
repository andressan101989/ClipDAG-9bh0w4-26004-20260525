import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createAdminLogoutFence,logoutCookieName,logoutFenceKey} from "../auth/adminLogoutFence";

beforeEach(()=>{localStorage.clear();window.history.replaceState(null,"","/admin/");document.cookie=`${logoutCookieName}=; Path=/admin; Max-Age=0`});
afterEach(()=>{vi.restoreAllMocks();document.cookie=`${logoutCookieName}=; Path=/admin; Max-Age=0`;window.history.replaceState(null,"","/")});
it("a fresh module fence observes the verified cookie after readable-but-unwritable storage logout",()=>{
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new DOMException("quota","QuotaExceededError")});
  const original=createAdminLogoutFence();expect(original.block()).toBe(true);expect(localStorage.getItem(logoutFenceKey)).toBeNull();expect(document.cookie).toContain(`${logoutCookieName}=`);
  const afterReload=createAdminLogoutFence();expect(afterReload.isBlocked()).toBe(true);afterReload.clearAfterPasswordLogin();expect(afterReload.isBlocked()).toBe(false);expect(document.cookie).not.toContain(`${logoutCookieName}=`);
});
it("an unverified fallback preserves module intent but never reports durable success",()=>{
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new DOMException("quota","QuotaExceededError")});vi.spyOn(document,"cookie","get").mockReturnValue("");vi.spyOn(document,"cookie","set").mockImplementation(()=>undefined);
  const fence=createAdminLogoutFence();expect(fence.block()).toBe(false);expect(fence.isBlocked()).toBe(true);
});
it("explicit password authentication remains usable when all persistent browser storage is unavailable",()=>{
  for(const method of ["getItem","setItem","removeItem"] as const)vi.spyOn(Storage.prototype,method).mockImplementation(()=>{throw new DOMException("blocked","SecurityError")});
  vi.spyOn(document,"cookie","get").mockImplementation(()=>{throw new DOMException("blocked","SecurityError")});vi.spyOn(document,"cookie","set").mockImplementation(()=>{throw new DOMException("blocked","SecurityError")});
  const fence=createAdminLogoutFence();expect(fence.isBlocked()).toBe(true);expect(fence.block()).toBe(false);fence.clearAfterPasswordLogin();expect(fence.isBlocked()).toBe(false);
});
it("preserves ordinary local storage logout and clears only owned markers on password login",()=>{
  localStorage.setItem("unrelated","keep");const fence=createAdminLogoutFence();expect(fence.isBlocked()).toBe(false);expect(fence.block()).toBe(true);expect(createAdminLogoutFence().isBlocked()).toBe(true);
  fence.clearAfterPasswordLogin();expect(fence.isBlocked()).toBe(false);expect(localStorage.getItem(logoutFenceKey)).toBeNull();expect(localStorage.getItem("unrelated")).toBe("keep");
});
it("a retained read-only old marker permits explicit login but a newer logout intent still blocks",()=>{
  const old="blocked:old-intent";localStorage.setItem(logoutFenceKey,old);
  vi.spyOn(Storage.prototype,"removeItem").mockImplementation(()=>{throw new DOMException("readonly","SecurityError")});
  const fence=createAdminLogoutFence();expect(fence.isBlocked()).toBe(true);fence.clearAfterPasswordLogin();expect(localStorage.getItem(logoutFenceKey)).toBe(old);expect(fence.isBlocked()).toBe(false);
  localStorage.setItem(logoutFenceKey,"blocked:new-intent");expect(fence.isBlocked()).toBe(true);expect(createAdminLogoutFence().isBlocked()).toBe(true);
});
it("scopes the fallback to the admin path with SameSite protection and no Domain attribute",()=>{
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new DOMException("quota","QuotaExceededError")});const assignments:string[]=[];
  const original=Object.getOwnPropertyDescriptor(Document.prototype,"cookie")!;vi.spyOn(document,"cookie","set").mockImplementation((value)=>{assignments.push(value);original.set!.call(document,value)});
  expect(createAdminLogoutFence().block()).toBe(true);expect(assignments[0]).toMatch(/Path=\/admin(?:;|$)/);expect(assignments[0]).toContain("SameSite=Strict");expect(assignments[0]).not.toMatch(/Domain=/i);
});
