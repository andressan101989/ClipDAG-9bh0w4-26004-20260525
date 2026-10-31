import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {Link,MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {
  getAdminMediaUrl,
  getAdminStoryVideoGrant,
  getAdminStoryDetail,
  moderateAdminStory,
  searchAdminStories,
  type AdminStoryDetail,
} from "../lib/adminApi";
import {AdminStoriesPage,AdminStoryDetailPage} from "../pages/AdminStoriesPages";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminApi",async(importOriginal)=>{
  const original=await importOriginal<typeof import("../lib/adminApi")>();
  return {...original,getAdminMediaUrl:vi.fn(),getAdminStoryVideoGrant:vi.fn(),getAdminStoryDetail:vi.fn(),moderateAdminStory:vi.fn(),searchAdminStories:vi.fn()};
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
  publication_status:"published",
  moderation_status:"unreviewed",
  scan_status:"queued",
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
  video_asset_id:null,
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
  it("opens direct private Stream Stories using a temporary canonical Story grant without rendering URLs",async()=>{
    vi.mocked(getAdminStoryVideoGrant).mockResolvedValue({storyId,hlsUrl:"https://customer.example.cloudflarestream.com/signed-token/manifest/video.m3u8",thumbnailUrl:"https://customer.example.cloudflarestream.com/signed-token/thumbnails/thumbnail.jpg",expiresAt:new Date(Date.now()+300000).toISOString()});
    renderDetail({...sharedDetail,story_kind:"media",media_origin:"story_stream_asset",video_asset_id:assetId,shared_video_id:null,source:null,preview_url:null,media_url:null,poster_url:null});
    const video=await screen.findByLabelText("Vista previa administrativa de la Story");
    await waitFor(()=>expect(video).toHaveAttribute("poster","https://customer.example.cloudflarestream.com/signed-token/thumbnails/thumbnail.jpg"));
    expect(getAdminStoryVideoGrant).toHaveBeenCalledWith(storyId);
    expect(getAdminMediaUrl).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("signed-token");
    expect(document.body.textContent).not.toContain("https://");
  });

  it("keeps a failed private Stream grant unavailable and retries through the same authority",async()=>{
    const user=userEvent.setup();
    vi.mocked(getAdminStoryVideoGrant).mockRejectedValue(new Error("No pudimos cargar esta vista previa autorizada."));
    renderDetail({...sharedDetail,story_kind:"media",media_origin:"story_stream_asset",video_asset_id:assetId,shared_video_id:null,source:null,preview_url:null,media_url:null,poster_url:null});
    expect(await screen.findByText("No pudimos cargar esta vista previa autorizada.")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Reintentar URL"}));
    await waitFor(()=>expect(getAdminStoryVideoGrant).toHaveBeenCalledTimes(2));
    expect(getAdminMediaUrl).not.toHaveBeenCalled();
  });

  it("shows publication, human moderation and pending scan independently without approval",async()=>{
    renderDetail();
    expect(await screen.findByText("Publicada")).toBeInTheDocument();
    expect(screen.getByText("Sin revisar")).toBeInTheDocument();
    expect(screen.getByText("En cola")).toBeInTheDocument();
    expect(screen.queryByText(/PASS|Aprobada/i)).not.toBeInTheDocument();
  });

  it.each([
    ["Conservar Story","keep"],
    ["Restringir Story","restrict"],
    ["Retirar Story","remove"],
  ])("sends the audited %s decision with reason and refreshes authoritative states",async(label,action)=>{
    const user=userEvent.setup();
    renderDetail();
    const button=await screen.findByRole("button",{name:label});
    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("motivo");
    expect(moderateAdminStory).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Motivo"),"Revisión humana completa");
    vi.mocked(getAdminStoryDetail).mockResolvedValue({...sharedDetail,publication_status:"restricted",moderation_status:"reviewed_restrict",scan_status:"completed"});
    await user.click(button);
    await waitFor(()=>expect(moderateAdminStory).toHaveBeenCalledWith({id:storyId,action,reason:"Revisión humana completa",idempotencyKey:expect.stringMatching(/^[0-9a-f-]{36}$/)}));
    expect(await screen.findByText("Restringida")).toBeInTheDocument();
    expect(screen.getByText("Revisada: restringir")).toBeInTheDocument();
    expect(screen.getByText("Completado")).toBeInTheDocument();
  });

  it("preserves legacy restore and does not expose signed URLs or private safety payloads as text",async()=>{
    renderDetail({...sharedDetail,visibility:"hidden"});
    expect(await screen.findByRole("button",{name:"Restaurar Story"})).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("https://");
    expect(document.body.textContent).not.toMatch(/fingerprint|evidence|question_responses|signed/i);
  });

  it.each(["unpublished","restricted","removed"] as const)("does not offer legacy restore for a safety-%s Story",async(publicationStatus)=>{
    renderDetail({...sharedDetail,visibility:"hidden",publication_status:publicationStatus,
      moderation_status:publicationStatus==="restricted"?"reviewed_restrict":publicationStatus==="removed"?"reviewed_remove":"unreviewed"});
    await screen.findByText(publicationStatus==="restricted"?"Restringida":publicationStatus==="removed"?"Retirada":"Sin publicar");
    expect(screen.queryByRole("button",{name:"Restaurar Story"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Conservar Story"})).toBeInTheDocument();
  });

  it("fences an in-flight moderation completion when navigation changes the Story",async()=>{
    let rejectModeration:(reason:Error)=>void=()=>undefined;
    vi.mocked(moderateAdminStory).mockReturnValue(new Promise((_resolve,reject)=>{rejectModeration=reject}));
    vi.mocked(getAdminStoryDetail).mockImplementation(async(id)=>id===storyId
      ?sharedDetail:{...sharedDetail,id:secondStoryId,owner:{...sharedDetail.owner,display_name:"Second Story Author"}});
    render(<MemoryRouter initialEntries={[`/stories/${storyId}`]}><Link to={`/stories/${secondStoryId}`}>Siguiente Story</Link><Routes><Route path="/stories/:id" element={<AdminStoryDetailPage/>}/></Routes></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("Motivo"),{target:{value:"Decisión para la primera Story"}});
    fireEvent.click(screen.getByRole("button",{name:"Retirar Story"}));
    fireEvent.click(screen.getByRole("link",{name:"Siguiente Story"}));
    expect(await screen.findByText("Second Story Author")).toBeInTheDocument();
    const secondReason=screen.getByLabelText("Motivo");
    fireEvent.change(secondReason,{target:{value:"Motivo independiente de la segunda Story"}});
    await act(async()=>{rejectModeration(new Error("Fallo tardío de la primera Story"));await Promise.resolve()});
    await waitFor(()=>expect(screen.getByLabelText("Motivo")).toHaveValue("Motivo independiente de la segunda Story"));
    expect(screen.queryByText("Fallo tardío de la primera Story")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Retirar Story"})).not.toBeDisabled();
  });

  it("fences an old moderation completion across A to B to A navigation",async()=>{
    let rejectFirst:(reason:Error)=>void=()=>undefined,resolveSecond:(value:{ok:boolean})=>void=()=>undefined,call=0;
    vi.mocked(moderateAdminStory).mockImplementation(()=>new Promise((resolve,reject)=>{
      call+=1;
      if(call===1)rejectFirst=reject;
      else resolveSecond=resolve as (value:{ok:boolean})=>void;
    }));
    vi.mocked(getAdminStoryDetail).mockImplementation(async(id)=>id===storyId
      ?sharedDetail:{...sharedDetail,id:secondStoryId,owner:{...sharedDetail.owner,display_name:"Second Story Author"}});
    render(<MemoryRouter initialEntries={[`/stories/${storyId}`]}><Link to={`/stories/${storyId}`}>Story A</Link><Link to={`/stories/${secondStoryId}`}>Story B</Link><Routes><Route path="/stories/:id" element={<AdminStoryDetailPage/>}/></Routes></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("Motivo"),{target:{value:"Primera decisión A"}});
    fireEvent.click(screen.getByRole("button",{name:"Retirar Story"}));
    await waitFor(()=>expect(moderateAdminStory).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("link",{name:"Story B"}));
    expect(await screen.findByText("Second Story Author")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link",{name:"Story A"}));
    expect(await screen.findByText("Story Author")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Motivo"),{target:{value:"Segunda decisión A"}});
    fireEvent.click(screen.getByRole("button",{name:"Restringir Story"}));
    await waitFor(()=>expect(moderateAdminStory).toHaveBeenCalledTimes(2));
    await act(async()=>{rejectFirst(new Error("Fallo obsoleto de A"));await Promise.resolve()});
    expect(screen.queryByText("Fallo obsoleto de A")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Motivo")).toHaveValue("Segunda decisión A");
    expect(screen.getByRole("button",{name:"Restringir Story"})).toBeDisabled();
    await act(async()=>{resolveSecond({ok:true});await Promise.resolve()});
    await waitFor(()=>expect(screen.getByRole("button",{name:"Restringir Story"})).not.toBeDisabled());
  });

  it("renders two shared Stories that reuse one canonical source without duplicating media",async()=>{
    vi.mocked(searchAdminStories).mockResolvedValue({items:[sharedDetail,{...sharedDetail,id:secondStoryId}],next_cursor:null});
    render(<MemoryRouter><AdminStoriesPage/></MemoryRouter>);
    expect(await screen.findAllByText("Compartida")).toHaveLength(2);
    expect(screen.getAllByText(/30000000/)).toHaveLength(2);
    expect(screen.getAllByRole("link",{name:"Abrir Story"})).toHaveLength(2);
    expect(searchAdminStories).toHaveBeenCalledWith({query:"",visibility:"",cursor:undefined,limit:50});
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
