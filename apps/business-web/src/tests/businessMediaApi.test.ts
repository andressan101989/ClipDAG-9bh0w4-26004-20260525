import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchBusinessMedia, setBusinessStoreMedia, uploadBusinessMedia } from "../lib/businessMediaApi";
import type { BusinessSupabaseClient } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

const mediaRow = {
  asset_id: "11111111-1111-4111-8111-111111111111",
  asset_source: "media_asset",
  provider: "r2",
  media_kind: "image",
  mime_type: "image/jpeg",
  status: "ready",
  purpose: "business_library",
  visibility: "public",
  size_bytes: 10,
  created_at: "2026-09-16T00:00:00Z",
  ready_at: "2026-09-16T00:00:01Z",
  preview_url: "https://media.test/image.jpg",
  playback_url: null,
  thumbnail_url: null,
  usage: ["library"],
  usage_count: 1,
  progress: null,
  error_code: null,
};

class FakeXhr {
  static instances: FakeXhr[] = [];
  status = 200;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  headers: Record<string, string> = {};
  method = "";
  url = "";
  constructor() { FakeXhr.instances.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send() { this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 }); this.onload?.(); }
}

describe("canonical Business Media API", () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the bounded business-scoped media RPC and parses its stable cursor", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { items: [mediaRow], next_cursor: { created_at: mediaRow.created_at, source: "media_asset", asset_id: mediaRow.asset_id } }, error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;
    const page = await searchBusinessMedia("owner-id", { kind: "image", limit: 12 }, client);
    expect(page.items[0].usage).toEqual(["library"]);
    expect(page.nextCursor?.assetId).toBe(mediaRow.asset_id);
    expect(rpc).toHaveBeenCalledWith("search_my_business_media", expect.objectContaining({ p_business_owner_id: "owner-id", p_kind: "image", p_limit: 12 }));
  });

  it("sends the server-returned R2 headers and canonical business scope before finalize", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: { success: true, data: { assetId: mediaRow.asset_id, uploadUrl: "https://r2.test/upload", headers: { "Content-Type": "image/jpeg", "If-None-Match": "*" } } }, error: null })
      .mockResolvedValueOnce({ data: { success: true }, error: null });
    const client = { functions: { invoke } } as unknown as BusinessSupabaseClient;
    const file = new File(["image"], "image.jpg", { type: "image/jpeg" });
    await uploadBusinessMedia("owner-id", file, undefined, client);
    expect(invoke).toHaveBeenNthCalledWith(1, "create-media-upload", { body: expect.objectContaining({ business_owner_id: "owner-id", purpose: "business_library" }) });
    expect(FakeXhr.instances[0].headers).toEqual({ "Content-Type": "image/jpeg", "If-None-Match": "*" });
    expect(invoke).toHaveBeenNthCalledWith(2, "finalize-media-upload", { body: { asset_id: mediaRow.asset_id } });
  });

  it("uses the existing Stream direct-upload authority for videos", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { success: true, data: { assetId: mediaRow.asset_id, uploadUrl: "https://stream.test/upload", formField: "file" } }, error: null });
    const client = { functions: { invoke } } as unknown as BusinessSupabaseClient;
    await uploadBusinessMedia("owner-id", new File(["video"], "clip.mp4", { type: "video/mp4" }), undefined, client);
    expect(invoke).toHaveBeenCalledWith("create-stream-upload", { body: expect.objectContaining({ business_owner_id: "owner-id", purpose: "business_library" }) });
    expect(FakeXhr.instances[0].method).toBe("POST");
  });

  it("reuses the canonical Store media RPC without a parallel authority", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await setBusinessStoreMedia("store-id", "logo-id", "banner-id", { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("set_marketplace_store_media", { p_store_id: "store-id", p_logo_asset_id: "logo-id", p_banner_asset_id: "banner-id" });
  });
});
