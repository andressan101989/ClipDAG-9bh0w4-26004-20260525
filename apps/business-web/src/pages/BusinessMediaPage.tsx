import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { BusinessMediaPreview } from "../components/BusinessMedia";
import { InlineError, PageHeader } from "../components/BusinessUI";
import {
  businessMediaPresentationState,
  searchBusinessMedia,
  uploadBusinessMedia,
  type BusinessMediaCursor,
  type BusinessMediaItem,
  type BusinessMediaKind,
  type UploadProgress,
} from "../lib/businessMediaApi";
import { presentAdsError } from "../lib/adsErrorPresentation";

const statusLabels = { ready: "Listo", processing: "Procesando", expired: "Carga expirada", failed: "Fallido" } as const;

export function BusinessMediaPage() {
  const { currentBusiness, hasCapability } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const canManage = hasCapability("business.media.manage");
  const [kind, setKind] = useState<BusinessMediaKind | undefined>();
  const [items, setItems] = useState<BusinessMediaItem[]>([]);
  const [cursor, setCursor] = useState<BusinessMediaCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<"read" | "upload" | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const uploadInFlightRef = useRef(false);

  const load = useCallback(async (append = false) => {
    if (!ownerId) return;
    const request = ++requestRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    setErrorSource(null);
    try {
      const page = await searchBusinessMedia(ownerId, { kind, cursor: append ? cursor ?? undefined : undefined, limit: 24 });
      if (request !== requestRef.current) return;
      setItems((current) => append ? [...current, ...page.items.filter((next) => !current.some((item) => item.assetId === next.assetId))] : page.items);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (request === requestRef.current) {
        setError(presentAdsError(cause, { operation: "read", resource: "media library" }).message);
        setErrorSource("read");
      }
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [cursor, kind, ownerId]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setProgress(null);
    void load(false);
    return () => { requestRef.current += 1; };
  }, [ownerId, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !currentBusiness || !canManage || uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setError(null);
    setErrorSource(null);
    try {
      const uploaded = await uploadBusinessMedia(currentBusiness.businessOwnerId, file, setProgress);
      if (uploaded.item && (!kind || uploaded.item.mediaKind === kind)) {
        setItems((current) => [uploaded.item, ...current.filter((item) => item.assetId !== uploaded.item?.assetId)]);
      } else {
        await load(false);
      }
    } catch (cause) {
      const uploadError = presentAdsError(cause, { operation: "mutation" }).message;
      await load(false);
      setError(uploadError);
      setErrorSource("upload");
    } finally {
      uploadInFlightRef.current = false;
      setProgress(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Business Media" title="Biblioteca multimedia" description="Activos canónicos de tu Store y catálogo, listos para reutilizar." action={canManage ? <><input ref={inputRef} className="visually-hidden" disabled={Boolean(progress)} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(event) => void upload(event)} /><button className="primary-button" type="button" aria-busy={Boolean(progress)} onClick={() => inputRef.current?.click()} disabled={Boolean(progress)}>{progress ? `${progress.phase === "processing" ? "Procesando" : "Subiendo"} ${progress.percent}%` : "Subir archivo"}</button></> : undefined} />
      {!canManage && <div className="readonly-note media-readonly">Vista de solo lectura. Se necesita business.media.manage para subir archivos.</div>}
      <div className="media-toolbar" role="group" aria-label="Filtrar biblioteca">
        {([{ label: "Todos", value: undefined }, { label: "Imágenes", value: "image" }, { label: "Videos", value: "video" }] as const).map((filter) => <button key={filter.label} type="button" className={kind === filter.value ? "filter-chip is-active" : "filter-chip"} onClick={() => setKind(filter.value)}>{filter.label}</button>)}
      </div>
      <InlineError message={error} />
      {errorSource === "read" && <button className="secondary-button media-retry" type="button" onClick={() => void load(false)}>Reintentar</button>}
      {loading && <div className="media-page-state">Cargando biblioteca…</div>}
      {!loading && !error && items.length === 0 && <div className="media-page-state"><strong>Tu biblioteca está lista para empezar</strong><p>{canManage ? "Sube una imagen o video, o reutiliza media canónica vinculada a tu Store." : "No hay media disponible para este negocio."}</p></div>}
      {!loading && items.length > 0 && <div className="media-grid">{items.map((item) => {
        const state = businessMediaPresentationState(item);
        return <article className="media-card" key={`${item.assetSource}:${item.assetId}`}>
        <div className="media-card-preview"><BusinessMediaPreview item={item} /></div>
        <div className="media-card-body"><div><strong>{item.mediaKind === "image" ? "Imagen" : "Video"}</strong><span className={`media-status status-${state}`}>{statusLabels[state]}</span></div><p>{item.usage.includes("store") ? "En uso en Store" : item.usage.includes("product") ? `En ${item.usageCount} producto${item.usageCount === 1 ? "" : "s"}` : "Biblioteca"}</p><time dateTime={item.createdAt}>{new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(item.createdAt))}</time></div>
      </article>;
      })}</div>}
      {!loading && cursor && <div className="media-pagination"><button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? "Cargando…" : "Ver más"}</button></div>}
    </>
  );
}
