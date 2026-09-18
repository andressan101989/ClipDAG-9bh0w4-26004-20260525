import { BrowserVideoPreview } from "@nelyon/web-media";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import {
  searchBusinessMedia,
  type BusinessMediaItem,
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
  onSelect,
  onClose,
}: {
  open: boolean;
  selectedId: string | null;
  title: string;
  onSelect: (item: BusinessMediaItem) => void;
  onClose: () => void;
}) {
  const { currentBusiness } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const [items, setItems] = useState<BusinessMediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    if (!ownerId || !open) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await searchBusinessMedia(ownerId, { kind: "image", status: "ready", limit: 60 });
      if (request === requestRef.current) setItems(page.items);
    } catch (cause) {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar Media");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [open, ownerId]);
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
  if (!open) return null;
  return (
    <div className="media-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="media-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header><div><p className="eyebrow">Business Media</p><h2>{title}</h2></div><button ref={closeButtonRef} className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}>×</button></header>
        {loading && <div className="media-dialog-state">Cargando biblioteca…</div>}
        {error && <div className="media-dialog-state"><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Reintentar</button></div>}
        {!loading && !error && items.length === 0 && <div className="media-dialog-state">No hay imágenes listas en la biblioteca.</div>}
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
