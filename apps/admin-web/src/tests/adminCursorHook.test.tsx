import {act,renderHook,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {useAdminCursorPage} from "../lib/useAdminCursorPage";
const deferred=<T,>()=>{let resolve!:(value:T)=>void;let reject!:(reason:Error)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}};
type Page={items:{id:string}[];next_cursor:{id:string}|null};
afterEach(()=>vi.useRealTimers());
it("replaces bounded pages, blocks same-render next clicks, retains back history and ends at null",async()=>{
 const load=vi.fn().mockResolvedValueOnce({items:[{id:"one"}],next_cursor:{id:"one"}}).mockResolvedValueOnce({items:[{id:"two"},{id:"two"}],next_cursor:null}).mockResolvedValueOnce({items:[{id:"one"}],next_cursor:{id:"one"}});
 const {result}=renderHook(()=>useAdminCursorPage({},load));await waitFor(()=>expect(result.current.items).toEqual([{id:"one"}]));
 act(()=>{result.current.next();result.current.next()});await waitFor(()=>expect(result.current.items).toEqual([{id:"two"}]));expect(load).toHaveBeenCalledTimes(2);expect(result.current.hasNext).toBe(false);
 act(()=>result.current.previous());await waitFor(()=>expect(result.current.page).toBe(1));await waitFor(()=>expect(result.current.items).toEqual([{id:"one"}]));
});
it("resets page immediately on filters, debounces requests and fences old resolutions including failures",async()=>{
 const old=deferred<Page>(),fresh=deferred<Page>();const load=vi.fn().mockReturnValue(fresh.promise).mockReturnValueOnce(old.promise);
 const {result,rerender}=renderHook(({q})=>useAdminCursorPage({q},load),{initialProps:{q:"old"}});await waitFor(()=>expect(load).toHaveBeenCalledTimes(1));vi.useFakeTimers();rerender({q:"new"});rerender({q:"newest"});
 await act(async()=>old.resolve({items:[{id:"stale"}],next_cursor:{id:"old"}}));expect(result.current.items).toBeNull();expect(result.current.loading).toBe(true);
 await act(async()=>vi.advanceTimersByTime(300));expect(load).toHaveBeenCalledTimes(2);await act(async()=>fresh.resolve({items:[],next_cursor:null}));expect(result.current.items).toEqual([]);
});
it("retries a failed next page using its cursor and resets cursor on a material edit",async()=>{
 const load=vi.fn().mockResolvedValueOnce({items:[{id:"one"}],next_cursor:{id:"one"}}).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({items:[],next_cursor:null});
 const {result,rerender}=renderHook(({status})=>useAdminCursorPage({status},load),{initialProps:{status:"active"}});await waitFor(()=>expect(result.current.hasNext).toBe(true));act(()=>result.current.next());await waitFor(()=>expect(result.current.error).toBe("offline"));act(()=>result.current.retry());await waitFor(()=>expect(result.current.items).toEqual([]));expect(load.mock.calls[2][1]).toEqual({id:"one"});
 rerender({status:"all"});expect(result.current.page).toBe(1);await waitFor(()=>expect(load).toHaveBeenCalledTimes(4));expect(load.mock.calls[3][1]).toBeUndefined();
});

it("keeps the current read mounted during ordinary refetch and fences out-of-order completion",async()=>{
 const pending=deferred<Page>();const load=vi.fn().mockResolvedValueOnce({items:[{id:"existing"}],next_cursor:null}).mockReturnValueOnce(pending.promise);
 const {result}=renderHook(()=>useAdminCursorPage({},load));await waitFor(()=>expect(result.current.items).toEqual([{id:"existing"}]));act(()=>result.current.retry());expect(result.current.items).toEqual([{id:"existing"}]);expect(result.current.loading).toBe(true);await act(async()=>pending.resolve({items:[{id:"fresh"}],next_cursor:null}));expect(result.current.items).toEqual([{id:"fresh"}]);
});
it("forgets cursor history on every material edit, including changing away and back",async()=>{
 const load=vi.fn().mockResolvedValue({items:[{id:"row"}],next_cursor:{id:"next"}});
 const {result,rerender}=renderHook(({query})=>useAdminCursorPage({query},load),{initialProps:{query:"first"}});await waitFor(()=>expect(result.current.hasNext).toBe(true));act(()=>result.current.next());await waitFor(()=>expect(result.current.page).toBe(2));await waitFor(()=>expect(result.current.loading).toBe(false));
 rerender({query:"other"});await waitFor(()=>expect(load).toHaveBeenCalledTimes(3));rerender({query:"first"});expect(result.current.page).toBe(1);await waitFor(()=>expect(load).toHaveBeenCalledTimes(4));expect(load.mock.calls[3][1]).toBeUndefined();
});
it.each(["resolve","reject"] as const)("ignores an old request that %ss after the newest request has completed",async(outcome)=>{
 const old=deferred<Page>();const load=vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({items:[{id:"newest"}],next_cursor:null});
 const {result,rerender}=renderHook(({query})=>useAdminCursorPage({query},load),{initialProps:{query:"old"}});await waitFor(()=>expect(load).toHaveBeenCalledTimes(1));rerender({query:"fresh"});await waitFor(()=>expect(result.current.items).toEqual([{id:"newest"}]));await act(async()=>{if(outcome==="resolve")old.resolve({items:[{id:"stale"}],next_cursor:{id:"old"}});else old.reject(new Error("stale failure"))});expect(result.current.items).toEqual([{id:"newest"}]);expect(result.current.error).toBeNull();
});
