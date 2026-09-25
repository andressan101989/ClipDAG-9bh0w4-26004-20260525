import { BrowserVideoPreview } from "@nelyon/web-media";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import {
  businessMediaPresentationState,
  searchAllBusinessMedia,
  type BusinessMediaItem,
  type UploadProgress,
  uploadBusinessMedia,
} from "../lib/businessMediaApi";
import { presentAdsError } from "../lib/adsErrorPresentation";

export function BusinessMediaPreview({ item, compact = false, locale = "es" }: { item: BusinessMediaItem; compact?: boolean; locale?: "en" | "es" }) {
  const [failed, setFailed] = useState(false);
  const url = item.playbackUrl ?? item.previewUrl;
  const presentationState = businessMediaPresentationState(item);
  const copy = locale === "en"
    ? { failed: "Unavailable", processing: "Processing", expired: "Upload expired", unavailable: "Preview unavailable", imageAlt: "Business Library asset" }
    : { failed: "No disponible", processing: "Procesando", expired: "Carga expirada", unavailable: "Vista previa no disponible", imageAlt: "Asset de la biblioteca" };
  if (presentationState !== "ready") {
    const unavailable = presentationState === "failed" || presentationState === "expired";
    const label = presentationState === "expired" ? copy.expired : presentationState === "failed" ? copy.failed : copy.processing;
    return <div className="media-placeholder" role="status"><span>{unavailable ? "!" : "…"}</span>{label}</div>;
  }
  if (!url || failed) return <div className="media-placeholder"><span>!</span>{copy.unavailable}</div>;
  if (item.mediaKind === "image") {
    return <img className={compact ? "media-image is-compact" : "media-image"} src={url} alt={copy.imageAlt} onError={() => setFailed(true)} />;
  }
  return <BrowserVideoPreview className={compact ? "media-video is-compact" : "media-video"} url={url} poster={item.thumbnailUrl} onError={() => setFailed(true)} />;
}

export function BusinessMediaPicker({
  open,
  selectedId,
  title,
  kind = "image",
  businessOwnerId,
  allowUpload = false,
  requiredPurpose,
  showUnavailable = false,
  locale = "es",
  onSelect,
  onClose,
}: {
  open: boolean;
  selectedId: string | null;
  title: string;
  kind?: "image" | "video" | null;
  businessOwnerId?: string;
  allowUpload?: boolean;
  requiredPurpose?: string;
  showUnavailable?: boolean;
  locale?: "en" | "es";
  onSelect: (item: BusinessMediaItem) => void;
  onClose: () => void;
}) {
  const { currentBusiness } = useBusinessAuth();
  const ownerId = businessOwnerId ?? currentBusiness?.businessOwnerId ?? "";
  const [items, setItems] = useState<BusinessMediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<"read" | "upload" | null>(null);
  const requestRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async (preserveError = false) => {
    if (!ownerId || !open) return;
    const request = ++requestRef.current;
    setLoading(true);
    if (!preserveError) {
      setError(null);
      setErrorSource(null);
    }
    try {
      const allItems = await searchAllBusinessMedia(ownerId, { kind: kind ?? undefined, status: showUnavailable ? undefined : "ready", limit: 50 });
      const visible = allItems.filter((item) => (!requiredPurpose || item.purpose === requiredPurpose) && !["delete_pending", "deleted"].includes(item.status));
      if (request === requestRef.current) setItems(visible);
    } catch (cause) {
      if (request === requestRef.current && !preserveError) {
        setError(presentAdsError(cause, { operation: "read", resource: "media library" }).message);
        setErrorSource("read");
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [kind, open, ownerId, requiredPurpose, showUnavailable]);
  useEffect(() => {
    setItems([]);
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("keydown", closeFromKeyboard);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose, open]);
  const upload = async (file: File) => {
    if (!allowUpload || !ownerId || uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setUploading(true);
    setUploadProgress(null);
    setError(null);
    setErrorSource(null);
    try {
      const uploaded = await uploadBusinessMedia(ownerId, file, setUploadProgress);
      if (uploaded.item
        && (!kind || uploaded.item.mediaKind === kind)
        && (!requiredPurpose || uploaded.item.purpose === requiredPurpose)) {
        setItems((current) => [uploaded.item, ...current.filter((item) => item.assetId !== uploaded.item?.assetId)]);
      } else {
        await load();
      }
    } catch (cause) {
      const uploadError = presentAdsError(cause, { operation: "mutation" }).message;
      await load(true);
      setError(uploadError);
      setErrorSource("upload");
    } finally {
      uploadInFlightRef.current = false;
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
  if (!open) return null;
  const copy = locale === "en" ? {
    eyebrow: "Business Media", upload: "Upload media", uploading: "Uploading…", close: "Close",
    loading: "Loading library…", retry: "Try again", empty: "No media in your Business Library yet.",
    ready: "Ready", processing: "Processing", failed: "Upload failed", expired: "Upload expired",
  } : {
    eyebrow: "Business Media", upload: "Subir archivo", uploading: "Subiendo…", close: "Cerrar",
    loading: "Cargando biblioteca…", retry: "Reintentar", empty: kind === "video" ? "No hay videos listos en la biblioteca." : "No hay imágenes listas en la biblioteca.",
    ready: "Biblioteca", processing: "Procesando", failed: "Carga fallida", expired: "Carga expirada",
  };
  return (
    <div className="media-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="media-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header><div><p className="eyebrow">{copy.eyebrow}</p><h2>{title}</h2></div><div className="inline-actions">{allowUpload && <><input ref={fileInputRef} hidden disabled={uploading} type="file" accept={kind === "image" ? "image/jpeg,image/png,image/webp,image/gif" : kind === "video" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }} /><button className="secondary-button" disabled={uploading} aria-busy={uploading} type="button" onClick={() => fileInputRef.current?.click()}>{uploading ? copy.uploading : copy.upload}</button></>}<button ref={closeButtonRef} className="icon-button" type="button" aria-label={copy.close} onClick={onClose}>×</button></div></header>
        {uploading && uploadProgress && <div className="media-dialog-state" role="status">{uploadProgress.phase} · {uploadProgress.percent}%</div>}
        {loading && <div className="media-dialog-state">{copy.loading}</div>}
        {error && <div className="media-dialog-state" role="alert"><p>{error}</p>{errorSource === "read" && <button className="secondary-button" type="button" onClick={() => void load()}>{copy.retry}</button>}</div>}
        {!loading && !error && items.length === 0 && <div className="media-dialog-state">{copy.empty}</div>}
        {!loading && !error && items.length > 0 && <div className="media-picker-grid">{items.map((item) => {
          const state = businessMediaPresentationState(item);
          const stateLabel = state === "failed" ? copy.failed : state === "expired" ? copy.expired : state === "ready" ? `${item.mediaKind === "image" ? "Image" : "Video"} · ${copy.ready}` : copy.processing;
          return <button className={item.assetId === selectedId ? "media-picker-item is-selected" : "media-picker-item"} type="button" key={item.assetId} disabled={state !== "ready"} aria-pressed={item.assetId === selectedId} onClick={() => { if (state === "ready") onSelect(item); }}>
            <BusinessMediaPreview item={item} compact locale={locale} />
            <span>{stateLabel}</span>
          </button>;
        })}</div>}
      </section>
    </div>
  );
}
