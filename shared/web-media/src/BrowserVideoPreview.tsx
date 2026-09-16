import { useEffect, useRef } from "react";

export function isHlsUrl(url: string) {
  return /\.m3u8(?:$|\?)/i.test(url)
    || (/cloudflarestream\.com|videodelivery\.net/i.test(url) && url.includes("m3u8"));
}

export function BrowserVideoPreview({
  url,
  poster,
  alt = "Vista previa de video",
  className,
  onReady,
  onError,
}: {
  url: string;
  poster?: string | null;
  alt?: string;
  className?: string;
  onReady?: () => void;
  onError?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isHlsUrl(url)) return;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      return () => {
        if (video.getAttribute("src") === url) video.removeAttribute("src");
      };
    }

    let disposed = false;
    let hls: import("hls.js").default | null = null;
    void import("hls.js").then(({ default: Hls }) => {
      if (disposed) return;
      if (!Hls.isSupported()) {
        errorRef.current?.();
        return;
      }
      hls = new Hls({ enableWorker: true });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!disposed && data.fatal) errorRef.current?.();
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    }).catch(() => {
      if (!disposed) errorRef.current?.();
    });

    return () => {
      disposed = true;
      hls?.destroy();
    };
  }, [url]);

  return (
    <video
      ref={videoRef}
      className={className}
      controls
      preload="metadata"
      poster={poster ?? undefined}
      aria-label={alt}
      onLoadedMetadata={onReady}
      onCanPlay={onReady}
      onError={onError}
    >
      {!isHlsUrl(url) && <source src={url} />}
      Tu navegador no puede reproducir este video.
    </video>
  );
}
