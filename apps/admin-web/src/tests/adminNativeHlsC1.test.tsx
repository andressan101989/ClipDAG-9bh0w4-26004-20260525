import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {AdminMediaPreview,AdminVideoPreview} from "../components/AdminPresentation";

const hlsMock=vi.hoisted(()=>({
  isSupported:vi.fn(),
  loadSource:vi.fn(),
  attachMedia:vi.fn(),
  destroy:vi.fn(),
  on:vi.fn(),
}));

vi.mock("hls.js",()=>{
  class MockHls{
    static isSupported=hlsMock.isSupported;
    static Events={ERROR:"error"};
    loadSource=hlsMock.loadSource;
    attachMedia=hlsMock.attachMedia;
    destroy=hlsMock.destroy;
    on=hlsMock.on;
  }
  return {default:MockHls};
});

const hlsUrl="https://customer-example.cloudflarestream.com/video/manifest/video.m3u8";
const posterUrl="https://customer-example.cloudflarestream.com/video/thumbnails/thumbnail.jpg";

describe("ADMIN-SUPERUSER-UX-P1-C1 native HLS playback",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    hlsMock.isSupported.mockReturnValue(true);
  });

  afterEach(()=>vi.restoreAllMocks());

  it("attaches HLS directly when the browser supports native playback",()=>{
    vi.spyOn(HTMLMediaElement.prototype,"canPlayType").mockReturnValue("probably");
    render(<AdminVideoPreview url={hlsUrl} poster={posterUrl} alt="HLS nativo"/>);
    const video=screen.getByLabelText("HLS nativo");
    expect(video).toHaveAttribute("src",hlsUrl);
    expect(video).toHaveAttribute("poster",posterUrl);
    expect(hlsMock.loadSource).not.toHaveBeenCalled();
    expect(hlsMock.attachMedia).not.toHaveBeenCalled();
  });

  it("uses hls.js exactly once when native HLS is unavailable",async()=>{
    vi.spyOn(HTMLMediaElement.prototype,"canPlayType").mockReturnValue("");
    const {unmount}=render(<AdminVideoPreview url={hlsUrl} alt="HLS mediante hls.js"/>);
    const video=screen.getByLabelText("HLS mediante hls.js");
    await waitFor(()=>expect(hlsMock.loadSource).toHaveBeenCalledTimes(1));
    expect(hlsMock.loadSource).toHaveBeenCalledWith(hlsUrl);
    expect(hlsMock.attachMedia).toHaveBeenCalledTimes(1);
    expect(hlsMock.attachMedia).toHaveBeenCalledWith(video);
    expect(video).not.toHaveAttribute("src");
    unmount();
    expect(hlsMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("shows the friendly error state when neither HLS path is supported",async()=>{
    vi.spyOn(HTMLMediaElement.prototype,"canPlayType").mockReturnValue("");
    hlsMock.isSupported.mockReturnValue(false);
    render(<AdminMediaPreview url={hlsUrl} kind="video" alt="HLS no soportado"/>);
    expect(await screen.findByText("Vista previa no disponible")).toBeInTheDocument();
    expect(screen.getByText("El asset no pudo reproducirse de forma segura.")).toBeInTheDocument();
    expect(hlsMock.loadSource).not.toHaveBeenCalled();
    expect(hlsMock.attachMedia).not.toHaveBeenCalled();
  });

  it("keeps direct MP4 playback on the native source element",()=>{
    render(<AdminVideoPreview url="https://cdn.example/video.mp4" alt="MP4 directo"/>);
    const video=screen.getByLabelText("MP4 directo");
    expect(video).toHaveAttribute("controls");
    expect(video.querySelector("source")).toHaveAttribute("src","https://cdn.example/video.mp4");
  });

  it("keeps image previews out of the video player",()=>{
    render(<AdminMediaPreview url="https://cdn.example/image.jpg" kind="image" alt="Imagen directa"/>);
    expect(screen.getByRole("img",{name:"Imagen directa"})).toHaveAttribute("src","https://cdn.example/image.jpg");
    expect(screen.queryByRole("video")).not.toBeInTheDocument();
  });

  it("replaces a native HLS source without retaining the previous URL",()=>{
    vi.spyOn(HTMLMediaElement.prototype,"canPlayType").mockReturnValue("maybe");
    const {rerender}=render(<AdminVideoPreview url={hlsUrl} alt="HLS cambiante"/>);
    const video=screen.getByLabelText("HLS cambiante");
    expect(video).toHaveAttribute("src",hlsUrl);
    const replacement="https://customer-example.cloudflarestream.com/replacement/manifest/video.m3u8";
    rerender(<AdminVideoPreview url={replacement} alt="HLS cambiante"/>);
    expect(video).toHaveAttribute("src",replacement);
  });

  it("keeps the friendly media error and retry interaction",()=>{
    const retry=vi.fn();
    render(<AdminMediaPreview url="https://cdn.example/video.mp4" kind="video" alt="Video con error" onRetry={retry}/>);
    fireEvent.error(screen.getByLabelText("Video con error"));
    expect(screen.getByText("Vista previa no disponible")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Reintentar"}));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
