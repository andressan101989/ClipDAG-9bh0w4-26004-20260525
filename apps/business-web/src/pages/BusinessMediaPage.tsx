import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { BusinessMediaPreview } from "../components/BusinessMedia";
import { InlineError, PageHeader } from "../components/BusinessUI";
import {
  searchBusinessMedia,
  uploadBusinessMedia,
  type BusinessMediaCursor,
  type BusinessMediaItem,
  type BusinessMediaKind,
  type UploadProgress,
} from "../lib/businessMediaApi";

const statusLabels: Record<string, string> = { ready: "Listo", pending: "Pendiente", uploading: "Subiendo", processing: "Procesando", failed: "Fallido" };

export function BusinessMediaPage() {
  const { currentBusiness, hasCapability } = useBusinessAuth();
  const canManage = hasCapability("business.media.manage");
  const [kind, setKind] = useState<BusinessMediaKind | undefined>();
  const [items, setItems] = useState<BusinessMediaItem[]>([]);
  const [cursor, setCursor] = useState<BusinessMediaCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (append = false) => {
    if (!currentBusiness) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await searchBusinessMedia(currentBusiness.businessOwnerId, { kind, cursor: append ? cursor ?? undefined : undefined, limit: 24 });
      setItems((current) => append ? [...current, ...page.items.filter((next) => !current.some((item) => item.assetId === next.assetId))] : page.items);
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la biblioteca");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [currentBusiness, cursor, kind]);

  useEffect(() => { setCursor(null); void load(false); }, [currentBusiness?.businessOwnerId, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !currentBusiness || !canManage) return;
    setError(null);
    try {
      await uploadBusinessMedia(currentBusiness.businessOwnerId, file, setProgress);
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir el archivo");
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Business Media" title="Biblioteca multimedia" description="Activos canónicos de tu Store y catálogo, listos para reutilizar." action={canManage ? <><input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(event) => void upload(event)} /><button className="primary-button" type="button" onClick={() => inputRef.current?.click()} disabled={Boolean(progress)}>{progress ? `${progress.phase === "processing" ? "Procesando" : "Subiendo"} ${progress.percent}%` : "Subir archivo"}</button></> : undefined} />
      {!canManage && <div className="readonly-note media-readonly">Vista de solo lectura. Se necesita business.media.manage para subir archivos.</div>}
      <div className="media-toolbar" role="group" aria-label="Filtrar biblioteca">
        {([{ label: "Todos", value: undefined }, { label: "Imágenes", value: "image" }, { label: "Videos", value: "video" }] as const).map((filter) => <button key={filter.label} type="button" className={kind === filter.value ? "filter-chip is-active" : "filter-chip"} onClick={() => setKind(filter.value)}>{filter.label}</button>)}
      </div>
      <InlineError message={error} />
      {error && <button className="secondary-button media-retry" type="button" onClick={() => void load(false)}>Reintentar</button>}
      {loading && <div className="media-page-state">Cargando biblioteca…</div>}
      {!loading && !error && items.length === 0 && <div className="media-page-state"><strong>Tu biblioteca está lista para empezar</strong><p>{canManage ? "Sube una imagen o video, o reutiliza media canónica vinculada a tu Store." : "No hay media disponible para este negocio."}</p></div>}
      {!loading && items.length > 0 && <div className="media-grid">{items.map((item) => <article className="media-card" key={`${item.assetSource}:${item.assetId}`}>
        <div className="media-card-preview"><BusinessMediaPreview item={item} /></div>
        <div className="media-card-body"><div><strong>{item.mediaKind === "image" ? "Imagen" : "Video"}</strong><span className={`media-status status-${item.status}`}>{statusLabels[item.status] ?? item.status}</span></div><p>{item.usage.includes("store") ? "En uso en Store" : item.usage.includes("product") ? `En ${item.usageCount} producto${item.usageCount === 1 ? "" : "s"}` : "Biblioteca"}</p><time dateTime={item.createdAt}>{new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(item.createdAt))}</time></div>
      </article>)}</div>}
      {!loading && cursor && <div className="media-pagination"><button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? "Cargando…" : "Ver más"}</button></div>}
    </>
  );
}
