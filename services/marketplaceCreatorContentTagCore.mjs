export function marketplaceContentTypeForMedia(videoUrl, mediaUrls) {
  if ((mediaUrls?.length ?? 0) > 1) return "feed";
  const clean = videoUrl.split("?")[0].toLowerCase();
  return /\.(mp4|mov|avi|mkv|webm|m4v|m3u8|mpd)$/.test(clean)
    || clean.includes("/videos/")
    || clean.includes("cloudflarestream.com")
    || clean.includes("videodelivery.net")
    || clean.includes("gtv-videos-bucket")
    ? "reel"
    : "feed";
}
