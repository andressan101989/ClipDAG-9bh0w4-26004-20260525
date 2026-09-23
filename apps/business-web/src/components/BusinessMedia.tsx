import { BrowserVideoPreview } from "@nelyon/web-media";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import {
  searchBusinessMedia,
  type BusinessMediaItem,
  type UploadProgress,
  uploadBusinessMedia,
} from "../lib/businessMediaApi";

export function BusinessMediaPreview({ item, compact = false }: { item: BusinessMediaItem; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = item.playbackUrl ?? item.previewUrl;
  const pending = item.status !== "ready";
  if (pending) {
    return <div className="media-placeholder" role="status"><span>{item.status === "failed" ? "!" : "…"}</span>{item.status === "failed" ? "No disponible" : "Procesando"}</div>;
  }
  if (!url || failed) return <div className="media-placeholder"><span>!</span>Vista previa no disponible</div>;
  if (item.mediaKind === "image") {
    return <img className={compact ? "media-image is-compact" : "media-image"} src={url} alt="Asset de la biblioteca" onError={() => setFailed(true)} />;
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
  onSelect,
  onClose,
}: {
  open: boolean;
  selectedId: string | null;
  title: string;
  kind?: "image" | "video";
  businessOwnerId?: string;
  allowUpload?: boolean;
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
  const requestRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    if (!ownerId || !open) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await searchBusinessMedia(ownerId, { kind, status: "ready", limit: 60 });
      if (request === requestRef.current) setItems(page.items);
    } catch (cause) {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar Media");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [kind, open, ownerId]);
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
    if (!allowUpload || !ownerId) return;
    setUploading(true);
    setUploadProgress(null);
    setError(null);
    try {
      await uploadBusinessMedia(ownerId, file, setUploadProgress);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir el archivo");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
  if (!open) return null;
  return (
    <div className="media-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="media-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header><div><p className="eyebrow">Business Media</p><h2>{title}</h2></div><div className="inline-actions">{allowUpload && <><input ref={fileInputRef} hidden type="file" accept={kind === "image" ? "image/jpeg,image/png,image/webp,image/gif" : "video/mp4,video/quicktime,video/webm"} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }} /><button className="secondary-button" disabled={uploading} type="button" onClick={() => fileInputRef.current?.click()}>{uploading ? "Subiendo…" : "Subir archivo"}</button></>}<button ref={closeButtonRef} className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></div></header>
        {uploading && uploadProgress && <div className="media-dialog-state" role="status">{uploadProgress.phase} · {uploadProgress.percent}%</div>}
        {loading && <div className="media-dialog-state">Cargando biblioteca…</div>}
        {error && <div className="media-dialog-state"><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Reintentar</button></div>}
        {!loading && !error && items.length === 0 && <div className="media-dialog-state">{kind === "image" ? "No hay imágenes listas en la biblioteca." : "No hay videos listos en la biblioteca."}</div>}
        {!loading && !error && items.length > 0 && <div className="media-picker-grid">{items.map((item) => (
          <button className={item.assetId === selectedId ? "media-picker-item is-selected" : "media-picker-item"} type="button" key={item.assetId} onClick={() => onSelect(item)}>
            <BusinessMediaPreview item={item} compact />
            <span>{item.usage.includes("store") ? "En uso en Store" : item.usage.includes("product") ? "En producto" : "Biblioteca"}</span>
          </button>
        ))}</div>}
      </section>
    </div>
  );
}
