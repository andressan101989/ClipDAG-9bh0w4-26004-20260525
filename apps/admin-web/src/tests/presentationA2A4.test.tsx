import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {describe,expect,it,vi} from "vitest";
import {AdminMediaPreview,AdminMessageBubble} from "../components/AdminPresentation";
import {AdminReportSubject} from "../components/AdminReportSubject";

vi.mock("../lib/adminApi",()=>({formatDate:(value:unknown)=>String(value??"—"),getAdminMediaUrl:vi.fn().mockResolvedValue("https://signed.example/media")}));

describe("SUPERUSER-UI-PRESENTATION-A2-A4",()=>{
  it("forbids raw JSON renderers in every page",()=>{const pages=join(process.cwd(),"src","pages");for(const file of readdirSync(pages).filter((name)=>name.endsWith(".tsx"))){const source=readFileSync(join(pages,file),"utf8");expect(source,`${file} raw JSON`).not.toMatch(/<pre[\s\S]{0,120}JSON\.stringify|JSON\.stringify\([^)]*\)[\s\S]{0,120}<\/pre>/)}});

  it("renders public image, video and audio previews with native controls",()=>{const {rerender}=render(<AdminMediaPreview url="https://cdn.example/image.jpg" kind="image" alt="Imagen pública"/>);expect(screen.getByRole("img",{name:"Imagen pública"})).toHaveAttribute("src","https://cdn.example/image.jpg");rerender(<AdminMediaPreview url="https://cdn.example/video.mp4" kind="video" alt="Video público"/>);expect(screen.getByLabelText("Video público")).toHaveAttribute("controls");rerender(<AdminMediaPreview url="https://cdn.example/voice.m4a" kind="voice" alt="Audio reportado"/>);expect(screen.getByLabelText("Audio reportado")).toHaveAttribute("controls")});

  it("rejects non-HTTPS preview input",()=>{render(<AdminMediaPreview url="javascript:alert(1)" kind="image"/>);expect(screen.getByText("Vista previa no disponible")).toBeInTheDocument();expect(screen.getByText("El asset no tiene URL reproducible.")).toBeInTheDocument();expect(screen.queryByRole("img")).not.toBeInTheDocument()});

  it("renders a report subject and real chat bubble instead of a raw object",()=>{render(<MemoryRouter><AdminReportSubject reportId="10000000-0000-4000-8000-000000000001" subject={{type:"comment",id:"20000000-0000-4000-8000-000000000002",text:"Comentario reportado",video_id:"30000000-0000-4000-8000-000000000003",owner:{id:"40000000-0000-4000-8000-000000000004",display_name:"Creator"},created_at:"2026-09-13T10:00:00Z",visibility:"visible"}}/><AdminMessageBubble reported message={{id:"50000000-0000-4000-8000-000000000005",sender:{display_name:"Sender"},message_type:"text",text_excerpt:"Mensaje permitido",created_at:"2026-09-13T10:01:00Z"}}/></MemoryRouter>);expect(screen.getByText("Comentario reportado")).toBeInTheDocument();expect(screen.getByText("Mensaje permitido")).toBeInTheDocument();expect(screen.getByText("Mensaje reportado")).toBeInTheDocument()});

  it("uses the shared lazy HLS implementation without autoplay",()=>{const source=readFileSync(join(process.cwd(),"..","..","shared","web-media","src","BrowserVideoPreview.tsx"),"utf8");expect(source).toContain('import("hls.js")');expect(source).toContain("application/vnd.apple.mpegurl");expect(source).toContain("hls.loadSource(url)");expect(source).not.toMatch(/<video[^>]*autoplay/i)});
});
