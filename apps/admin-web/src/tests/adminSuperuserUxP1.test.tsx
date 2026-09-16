import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {getAdminContentDetail,moderateAdminContent,searchAdminContent} from "../lib/adminApi";
import {formatAdminMoney,formatAdminUsd} from "../lib/adminMoney";
import {AdminContentDetailPage,AdminContentPage} from "../pages/AdminContentPages";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminApi",async(importOriginal)=>{
  const original=await importOriginal<typeof import("../lib/adminApi")>();
  return {...original,getAdminContentDetail:vi.fn(),moderateAdminContent:vi.fn(),searchAdminContent:vi.fn()};
});

const id="10000000-0000-4000-8000-000000000001";
const owner={id:"20000000-0000-4000-8000-000000000002",username:"creator",display_name:"Creator",avatar_url:null};
const base={type:"video",id,owner,caption:"Contenido de prueba",created_at:"2026-09-16T12:00:00Z",visibility:"visible",public_counters:{likes_count:2,comments_count:3,views_count:4},media_asset_id:null,video_asset_id:null};

function renderDetail(overrides:Record<string,unknown>){
  vi.mocked(getAdminContentDetail).mockResolvedValue({...base,...overrides});
  return render(<MemoryRouter initialEntries={[`/content/video/${id}`]}><Routes><Route path="/content/:type/:id" element={<AdminContentDetailPage/>}/></Routes></MemoryRouter>);
}

beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(useAdminAuth).mockReturnValue({hasCapability:()=>true} as never);
  vi.mocked(moderateAdminContent).mockResolvedValue({ok:true} as never);
  vi.mocked(searchAdminContent).mockResolvedValue({items:[],nextCursor:null} as never);
});

describe("ADMIN-SUPERUSER-UX-P1 content preview",()=>{
  it("renders canonical Cloudflare Stream HLS with controls and poster",async()=>{
    renderDetail({media_kind:"video",media_origin:"cloudflare_stream",media_url:"https://customer.example.cloudflarestream.com/id/manifest/video.m3u8",playback_url:"https://customer.example.cloudflarestream.com/id/manifest/video.m3u8",poster_url:"https://customer.example.cloudflarestream.com/id/thumbnails/thumbnail.jpg",video_asset_id:"30000000-0000-4000-8000-000000000003"});
    const video=await screen.findByLabelText("Vista previa administrativa del contenido");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("poster","https://customer.example.cloudflarestream.com/id/thumbnails/thumbnail.jpg");
    expect(screen.getByText("cloudflare_stream")).toBeInTheDocument();
  });

  it.each([
    ["MP4 legacy","https://legacy.example/post.mp4","legacy_video_url"],
    ["Supabase MP4","https://project.supabase.co/storage/v1/object/public/media/post.mp4","legacy_video_url"],
  ])("renders %s as video",async(_label,url,origin)=>{
    renderDetail({media_kind:"video",media_origin:origin,media_url:url,playback_url:url,poster_url:null});
    expect(await screen.findByLabelText("Vista previa administrativa del contenido")).toHaveAttribute("controls");
  });

  it.each([
    ["R2 JPG","https://pub.example.r2.dev/post.jpg","r2"],
    ["R2 PNG","https://pub.example.r2.dev/post.png","r2"],
    ["Supabase JPG","https://project.supabase.co/storage/v1/object/public/media/post.jpg","legacy_video_url"],
  ])("renders %s as an image and never as video",async(_label,url,origin)=>{
    renderDetail({media_kind:"image",media_origin:origin,media_url:url,playback_url:null,poster_url:url,media_asset_id:"40000000-0000-4000-8000-000000000004"});
    expect(await screen.findByRole("img",{name:"Vista previa administrativa del contenido"})).toHaveAttribute("src",url);
    expect(screen.queryByLabelText("Vista previa administrativa del contenido",{selector:"video"})).not.toBeInTheDocument();
  });

  it("shows a friendly unavailable state instead of a blank player",async()=>{
    renderDetail({media_kind:null,media_origin:null,media_url:null,playback_url:null,poster_url:null});
    expect(await screen.findByText("Vista previa no disponible")).toBeInTheDocument();
    expect(screen.getByText("El asset no tiene URL reproducible.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Vista previa administrativa del contenido")).not.toBeInTheDocument();
  });

  it("keeps canonical moderation behavior unchanged",async()=>{
    renderDetail({media_kind:"image",media_origin:"r2",media_url:"https://pub.example.r2.dev/post.jpg",playback_url:null,poster_url:null});
    await screen.findByRole("img",{name:"Vista previa administrativa del contenido"});
    fireEvent.change(screen.getByLabelText("Motivo"),{target:{value:"Revisión humana confirmada"}});
    fireEvent.click(screen.getByRole("button",{name:"Ocultar contenido"}));
    await waitFor(()=>expect(moderateAdminContent).toHaveBeenCalledWith(expect.objectContaining({type:"video",id,action:"hide",reason:"Revisión humana confirmada"})));
  });

  it("keeps the content list bounded to its single search projection",async()=>{
    vi.mocked(searchAdminContent).mockResolvedValue({items:[{type:"video",id,preview:"Texto",preview_url:"https://cdn.example/thumb.jpg",owner,visibility:"visible",created_at:"2026-09-16T12:00:00Z"}],nextCursor:null} as never);
    render(<MemoryRouter><AdminContentPage/></MemoryRouter>);
    expect(await screen.findByText("Texto")).toBeInTheDocument();
    expect(searchAdminContent).toHaveBeenCalledTimes(1);
    expect(getAdminContentDetail).not.toHaveBeenCalled();
  });
});

describe("ADMIN-SUPERUSER-UX-P1 monetary presentation",()=>{
  it("formats all monetary values to two decimals without changing raw precision",()=>{
    const raw=991.07569444;
    expect(formatAdminMoney(raw,"BDAG")).toBe("991.08 BDAG");
    expect(formatAdminMoney(1215.04,"BDAG")).toBe("1,215.04 BDAG");
    expect(formatAdminMoney(0,"BDAG")).toBe("0.00 BDAG");
    expect(formatAdminUsd(9.9107569444)).toBe("$9.91 USD");
    expect(raw).toBe(991.07569444);
  });
});
