import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthProvider";
import { EmptyState, ErrorState, LoadingState } from "../components/PageState";
import {
  formatDate,
  getAdminContentDetail,
  moderateAdminContent,
  searchAdminContent,
  type AdminContentSummary,
  type AdminContentType,
} from "../lib/adminApi";

export function AdminContentPage() {
  const [type, setType] = useState(""),
    [visibility, setVisibility] = useState(""),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<AdminContentSummary[] | null>(null),
    [error, setError] = useState<string | null>(null),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);
    void searchAdminContent({ type, visibility, query })
      .then((page) => {
        if (active) setItems(page.items);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Error");
      });
    return () => {
      active = false;
    };
  }, [type, visibility, query, nonce]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TRUST &amp; SAFETY</p>
          <h2>Contenido</h2>
          <p>Moderación reversible de videos y comentarios.</p>
        </div>
      </div>
      <div className="filters">
        <label className="search">
          <span>⌕</span>
          <input
            aria-label="Buscar contenido"
            placeholder="ID, texto o autor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Tipo de contenido"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">Videos y comentarios</option>
          <option value="video">Videos</option>
          <option value="comment">Comentarios</option>
        </select>
        <select
          aria-label="Visibilidad"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="">Toda visibilidad</option>
          <option value="visible">Visible</option>
          <option value="hidden">Oculto</option>
        </select>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={() => setNonce((x) => x + 1)} />
      ) : !items ? (
        <LoadingState label="Buscando contenido…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Sin contenido"
          detail="No hay coincidencias para estos filtros."
        />
      ) : (
        <section className="table-panel">
          <div className="orders-table" role="table">
            <div className="table-head" role="row">
              <span>Contenido</span>
              <span>Autor</span>
              <span>Tipo</span>
              <span>Vista previa</span>
              <span>Estado</span>
              <span>Creado</span>
            </div>
            {items.map((item) => (
              <Link
                className="table-row"
                role="row"
                to={`/content/${item.type}/${item.id}`}
                key={`${item.type}:${item.id}`}
              >
                <span>
                  <strong>{item.id}</strong>
                </span>
                <span>
                  {item.owner.display_name ??
                    item.owner.username ??
                    item.owner.id}
                </span>
                <span>{item.type}</span>
                <span>{item.preview || "—"}</span>
                <span>
                  <em
                    className={`badge ${item.visibility === "hidden" ? "warn" : ""}`}
                  >
                    {item.visibility}
                  </em>
                </span>
                <span>{formatDate(item.created_at)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function AdminContentDetailPage() {
  const { type = "", id = "" } = useParams(),
    { hasCapability } = useAdminAuth();
  const validType =
    type === "video" || type === "comment" ? (type as AdminContentType) : null;
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!validType) {
      setError("Tipo de contenido inválido");
      return;
    }
    let active = true;
    setDetail(null);
    setError(null);
    void getAdminContentDetail(validType, id)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Error");
      });
    return () => {
      active = false;
    };
  }, [validType, id, nonce]);
  const visibility = detail?.visibility === "hidden" ? "hidden" : "visible";
  const action = visibility === "hidden" ? "restore" : "hide";
  const allowed = hasCapability(
    action === "hide" ? "content.items.hide" : "content.items.restore",
  );
  const run = async () => {
    if (!validType || reason.trim().length < 2)
      return setError("Indica un motivo de al menos 2 caracteres.");
    setBusy(true);
    setError(null);
    try {
      await moderateAdminContent({
        type: validType,
        id,
        action,
        reason: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      setReason("");
      setNonce((x) => x + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo moderar el contenido",
      );
    } finally {
      setBusy(false);
    }
  };
  if (error && !detail)
    return (
      <ErrorState message={error} onRetry={() => setNonce((x) => x + 1)} />
    );
  if (!detail) return <LoadingState label="Cargando contenido…" />;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONTENIDO</p>
          <h2>{validType}</h2>
          <p>{id}</p>
        </div>
        <em className={`badge ${visibility === "hidden" ? "warn" : ""}`}>
          {visibility}
        </em>
      </div>
      <section className="detail-card">
        <h3>Proyección administrativa segura</h3>
        <pre>{JSON.stringify(detail, null, 2)}</pre>
      </section>
      {allowed && (
        <section className="detail-card">
          <h3>{action === "hide" ? "Ocultar" : "Restaurar"}</h3>
          <textarea
            aria-label="Motivo"
            placeholder="Motivo obligatorio"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button disabled={busy} onClick={() => void run()}>
            {action === "hide" ? "Ocultar contenido" : "Restaurar contenido"}
          </button>
          {error && <p role="alert">{error}</p>}
          <small>
            La acción es reversible y no elimina la fila ni la media.
          </small>
        </section>
      )}
    </>
  );
}
