import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {
  getAdminMediaUrl,
  getAdminStoryDetail,
  moderateAdminStory,
  searchAdminStories,
  type AdminStoryDetail,
} from "../lib/adminApi";
import {AdminStoriesPage,AdminStoryDetailPage} from "../pages/AdminStoriesPages";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminApi",async(importOriginal)=>{
  const original=await importOriginal<typeof import("../lib/adminApi")>();
  return {...original,getAdminMediaUrl:vi.fn(),getAdminStoryDetail:vi.fn(),moderateAdminStory:vi.fn(),searchAdminStories:vi.fn()};
});

const storyId="10000000-0000-4000-8000-000000000001";
const secondStoryId="10000000-0000-4000-8000-000000000002";
const authorId="20000000-0000-4000-8000-000000000001";
const sourceId="30000000-0000-4000-8000-000000000001";
const sourceOwnerId="40000000-0000-4000-8000-000000000001";
const assetId="50000000-0000-4000-8000-000000000001";
const createdAt="2026-09-14T01:00:00.000Z";
const expiresAt="2026-09-15T01:00:00.000Z";

const sharedDetail:AdminStoryDetail={
  id:storyId,
  owner:{id:authorId,username:"story_author",display_name:"Story Author",avatar_url:null},
  story_kind:"shared",
  media_type:"video",
  resolved_media_kind:"video",
  created_at:createdAt,
  expires_at:expiresAt,
  shared_video_id:sourceId,
  shared_content_type:"reel",
  visibility:"visible",
  source_status:"available",
  media_origin:"shared_stream_asset",
  preview_url:"https://customer.example.cloudflarestream.com/poster.jpg",
  report_count:2,
  expired:false,
  composition:{version:1,elements:[
    {id:"text-1",type:"text",text:"Texto publicado",x:.25,y:.35,scale:1.2,rotation:5,color:"#FFFFFF",size:"large",align:"left"},
    {id:"sticker-1",type:"sticker",value:"🔥",x:.7,y:.8,scale:1.5,rotation:0},
  ]},
  linked_media_asset_id:null,
  media_asset_id:null,
  media_url:"https://customer.example.cloudflarestream.com/manifest/video.m3u8",
  poster_url:"https://customer.example.cloudflarestream.com/poster.jpg",
  source:{id:sourceId,content_type:"reel",owner:{id:sourceOwnerId,username:"source_owner",display_name:"Source Owner",avatar_url:null},caption:"Video canónico compartido",created_at:createdAt,visibility:"visible",views_count:20,likes_count:4,comments_count:3,shares_count:2},
  reports:{total:2,pending:1,last_reported_at:createdAt},
};

const renderDetail=(detail:AdminStoryDetail=sharedDetail)=>{
  vi.mocked(getAdminStoryDetail).mockResolvedValue(detail);
  return render(<MemoryRouter initialEntries={[`/stories/${detail.id}`]}><Routes><Route path="/stories/:id" element={<AdminStoryDetailPage/>}/></Routes></MemoryRouter>);
};

beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(useAdminAuth).mockReturnValue({hasCapability:(capability:string)=>capability==="stories.items.moderate"} as never);
  vi.mocked(getAdminMediaUrl).mockResolvedValue("https://signed.example/story.jpg");
  vi.mocked(moderateAdminStory).mockResolvedValue({ok:true});
});

describe("ADMIN-SUPERUSER-OPT-F1 Story inspection",()=>{
  it("renders two shared Stories that reuse one canonical source without duplicating media",async()=>{
    vi.mocked(searchAdminStories).mockResolvedValue({items:[sharedDetail,{...sharedDetail,id:secondStoryId}],next_cursor:null});
    render(<MemoryRouter><AdminStoriesPage/></MemoryRouter>);
    expect(await screen.findAllByText("Compartida")).toHaveLength(2);
    expect(screen.getAllByText(/30000000/)).toHaveLength(2);
    expect(screen.getAllByRole("link",{name:"Abrir Story"})).toHaveLength(2);
    expect(searchAdminStories).toHaveBeenCalledWith({query:"",visibility:""});
  });

  it("shows the canonical shared video, source, reports, and composition in human form",async()=>{
    renderDetail();
    const video=await screen.findByLabelText("Vista previa administrativa de la Story");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("poster",sharedDetail.poster_url);
    expect(screen.getByText("Video canónico compartido")).toBeInTheDocument();
    expect(screen.getByText("Source Owner")).toBeInTheDocument();
    expect(screen.getAllByText("Texto publicado")).toHaveLength(2);
    expect(screen.getAllByText("🔥")).toHaveLength(2);
    expect(screen.getByText("Revisión pendiente")).toBeInTheDocument();
    expect(getAdminMediaUrl).not.toHaveBeenCalled();
  });

  it("uses the existing signed admin-media flow for an authorized private direct Story",async()=>{
    renderDetail({...sharedDetail,story_kind:"media",shared_video_id:null,shared_content_type:null,resolved_media_kind:"image",source_status:"available",media_origin:"story_asset",preview_url:null,linked_media_asset_id:assetId,media_asset_id:assetId,media_url:null,poster_url:null,source:null,reports:{total:0,pending:0,last_reported_at:null},report_count:0,composition:{version:1,elements:[]}});
    expect(await screen.findByRole("img",{name:"Vista previa administrativa de la Story"})).toHaveAttribute("src","https://signed.example/story.jpg");
    expect(getAdminMediaUrl).toHaveBeenCalledWith(assetId,{surface:"story",entityId:storyId});
  });

  it("identifies a deleted shared source explicitly and does not crash",async()=>{
    renderDetail({...sharedDetail,source_status:"missing",media_origin:null,preview_url:null,media_url:null,poster_url:null,source:null});
    expect(await screen.findByText("Contenido de origen no disponible")).toBeInTheDocument();
    expect(screen.queryByLabelText("Vista previa administrativa de la Story")).not.toBeInTheDocument();
    expect(screen.queryByText("URL insegura")).not.toBeInTheDocument();
  });

  it.each([
    ["an arbitrary HTTPS URL","https://evil.example/story.mp4","shared_r2_asset"],
    ["an HTTP URL","http://cdn.example/story.mp4","shared_r2_asset"],
  ])("does not render %s",async(_label,mediaUrl,origin)=>{
    renderDetail({...sharedDetail,source_status:"unavailable",media_origin:origin as AdminStoryDetail["media_origin"],media_url:mediaUrl,poster_url:null,source:null});
    expect(await screen.findByText("Contenido de origen no disponible")).toBeInTheDocument();
    expect(screen.queryByLabelText("Vista previa administrativa de la Story")).not.toBeInTheDocument();
  });

  it("keeps moderation capability-gated and preserves the existing action contract",async()=>{
    const user=userEvent.setup();
    const {unmount}=renderDetail();
    await screen.findByRole("button",{name:"Ocultar Story"});
    await user.click(screen.getByRole("button",{name:"Ocultar Story"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("motivo");
    await user.type(screen.getByLabelText("Motivo"),"Incumplimiento visible");
    await user.click(screen.getByRole("button",{name:"Ocultar Story"}));
    await waitFor(()=>expect(moderateAdminStory).toHaveBeenCalledWith(expect.objectContaining({id:storyId,action:"hide",reason:"Incumplimiento visible"})));
    unmount();
    vi.mocked(useAdminAuth).mockReturnValue({hasCapability:()=>false} as never);
    renderDetail();
    await screen.findByText("Vista previa para moderación");
    expect(screen.queryByRole("button",{name:/Story$/})).not.toBeInTheDocument();
  });
});
