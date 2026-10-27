import {beforeEach,describe,expect,it,vi} from "vitest";
import {getAdminStoryVideoGrant,moderateAdminStory,searchAdminStories,validateAdminStoryDetail} from "../lib/adminApi";
import {supabase} from "../lib/supabase";

vi.mock("../lib/supabase",()=>({supabase:{rpc:vi.fn(),functions:{invoke:vi.fn()}}}));
const id="10000000-0000-4000-8000-000000000001";
const key="20000000-0000-4000-8000-000000000001";
const detail={id,owner:{id,username:"author",display_name:null,avatar_url:null},story_kind:"media",media_type:"photo",resolved_media_kind:null,created_at:"2026-10-27T01:00:00Z",expires_at:"2026-10-28T01:00:00Z",shared_video_id:null,shared_content_type:null,visibility:"visible",source_status:"unavailable",media_origin:null,preview_url:null,report_count:0,expired:false,composition:{version:1,elements:[]},linked_media_asset_id:null,media_asset_id:null,media_url:null,poster_url:null,source:null,reports:{total:0,pending:0,last_reported_at:null},publication_status:"published",moderation_status:"unreviewed",scan_status:"queued"};

beforeEach(()=>vi.clearAllMocks());
describe("Stories C2 sanitized admin boundary",()=>{
  it("validates the direct Stream projection while keeping private URLs out of the detail",()=>{
    const result=validateAdminStoryDetail({...detail,media_origin:"story_stream_asset",video_asset_id:key});
    expect(result).toMatchObject({media_origin:"story_stream_asset",video_asset_id:key,media_url:null,poster_url:null,preview_url:null});
    expect(()=>validateAdminStoryDetail({...detail,media_origin:"story_stream_asset",video_asset_id:"invalid"})).toThrow("story.video_asset_id");
  });
  it("rejects a private Stream projection that includes playback URLs or lacks its canonical asset id",()=>{
    expect(()=>validateAdminStoryDetail({...detail,media_origin:"story_stream_asset",video_asset_id:key,media_url:"https://customer-test.cloudflarestream.com/private/manifest/video.m3u8"})).toThrow("story.private_stream_projection");
    expect(()=>validateAdminStoryDetail({...detail,media_origin:"story_stream_asset",video_asset_id:null})).toThrow("story.video_asset_id");
  });
  it("requests the existing Stream signer by Story identity and returns only an in-memory grant",async()=>{
    const expiresAt=new Date(Date.now()+300000).toISOString();
    vi.mocked(supabase.functions.invoke).mockResolvedValue({data:{success:true,data:{storyId:id,hlsUrl:"https://customer-test.cloudflarestream.com/token/manifest/video.m3u8",thumbnailUrl:"https://customer-test.cloudflarestream.com/token/thumbnails/thumbnail.jpg",expiresAt,provider_metadata:{secret:"private"}}},error:null} as never);
    expect(await getAdminStoryVideoGrant(id)).toEqual({storyId:id,hlsUrl:"https://customer-test.cloudflarestream.com/token/manifest/video.m3u8",thumbnailUrl:"https://customer-test.cloudflarestream.com/token/thumbnails/thumbnail.jpg",expiresAt});
    expect(supabase.functions.invoke).toHaveBeenCalledWith("get-stream-playback",{body:{story_id:id,admin_review:true}});
  });
  it.each([
    {storyId:key},
    {hlsUrl:"https://evil.example/token/manifest/video.m3u8"},
    {thumbnailUrl:"http://customer-test.cloudflarestream.com/token/thumb.jpg"},
    {expiresAt:new Date(Date.now()+3600000).toISOString()},
    {expiresAt:"2020-01-01T00:00:00Z"},
  ])("rejects a mismatched, unsafe or unbounded Stream grant",async(overrides)=>{
    vi.mocked(supabase.functions.invoke).mockResolvedValue({data:{success:true,data:{storyId:id,hlsUrl:"https://customer-test.cloudflarestream.com/token/manifest/video.m3u8",thumbnailUrl:"https://customer-test.cloudflarestream.com/token/thumbnails/thumbnail.jpg",expiresAt:new Date(Date.now()+300000).toISOString(),...overrides}},error:null} as never);
    await expect(getAdminStoryVideoGrant(id)).rejects.toThrow();
  });
  it("projects only the three validated facts from detail without copying private safety fields",()=>{
    const result=validateAdminStoryDetail({...detail,evidence:{signed_url:"secret"},question_responses:["private"],fingerprint:"secret"});
    expect(result).toMatchObject({publication_status:"published",moderation_status:"unreviewed",scan_status:"queued"});
    expect(result).not.toHaveProperty("evidence");
    expect(result).not.toHaveProperty("question_responses");
    expect(result).not.toHaveProperty("fingerprint");
  });
  it.each([
    ["publication_status","passed"],
    ["moderation_status","approved"],
    ["scan_status","passed"],
    ["publication_status",undefined],
    ["moderation_status",{}],
  ])("rejects an invalid %s rather than manufacturing an approval",(field,value)=>{
    expect(()=>validateAdminStoryDetail({...detail,[field]:value})).toThrow(`story.${field}`);
  });
  it("validates the same states on the existing list projection",async()=>{
    vi.mocked(supabase.rpc).mockResolvedValue({data:{items:[detail],next_cursor:null},error:null} as never);
    expect((await searchAdminStories()).items[0]).toMatchObject({publication_status:"published",moderation_status:"unreviewed",scan_status:"queued"});
    vi.mocked(supabase.rpc).mockResolvedValue({data:{items:[{...detail,scan_status:"pass"}],next_cursor:null},error:null} as never);
    await expect(searchAdminStories()).rejects.toThrow("story.scan_status");
  });
  it.each(["keep","restrict","remove","hide","restore"] as const)("uses the canonical audited command for %s",async(action)=>{
    vi.mocked(supabase.rpc).mockResolvedValue({data:{ok:true},error:null} as never);
    await moderateAdminStory({id,action,reason:"Revisión humana",idempotencyKey:key});
    expect(supabase.rpc).toHaveBeenCalledWith("admin_moderate_story",{p_story_id:id,p_action:action,p_reason:"Revisión humana",p_idempotency_key:key});
  });
});
