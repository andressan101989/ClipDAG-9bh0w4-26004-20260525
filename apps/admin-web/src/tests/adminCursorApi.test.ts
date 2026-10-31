import {beforeEach,expect,it,vi} from "vitest";
import {supabase} from "../lib/supabase";
import {searchAdminLiveSessions,searchAdminLiveBattles,searchAdminMediaAssets} from "../lib/adminApi";
vi.mock("../lib/supabase",()=>({supabase:{rpc:vi.fn()}}));
beforeEach(()=>vi.resetAllMocks());
const id="11111111-1111-4111-8111-111111111111",created_at="2026-10-01T00:00:00.000Z";
it.each([
 ["LIVE",searchAdminLiveSessions,"search_admin_live_sessions",{started_at:created_at,id},{p_cursor_started_at:created_at,p_cursor_id:id,p_limit:50}],
 ["Battles",searchAdminLiveBattles,"search_admin_live_battles",{created_at,id},{p_cursor_created_at:created_at,p_cursor_id:id,p_limit:50}],
 ["Media",searchAdminMediaAssets,"search_admin_media_assets",{created_at,id},{p_cursor_created_at:created_at,p_cursor_id:id,p_limit:50}],
] as const)("%s validates server cursors and forwards the exact bounded keyset",async(_name,read,rpc,cursor,args)=>{
 vi.mocked(supabase.rpc).mockResolvedValue({data:{items:[],next_cursor:cursor},error:null} as never);
 const page=await read({cursor:cursor as never,limit:50});expect(page.next_cursor).toEqual(cursor);expect(supabase.rpc).toHaveBeenCalledWith(rpc,expect.objectContaining(args));
 vi.mocked(supabase.rpc).mockResolvedValue({data:{items:[],next_cursor:{id:"bad",created_at:"bad",started_at:"bad"}},error:null} as never);await expect(read()).rejects.toThrow();
});
