import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthProvider";
import { EmptyState, ErrorState, LoadingState } from "../components/PageState";
import {
  formatDate,
  getAdminStoryDetail,
  moderateAdminStory,
  searchAdminStories,
  type AdminStorySummary,
} from "../lib/adminApi";

export function AdminStoriesPage() {
  const [query, setQuery] = useState(""),
    [visibility, setVisibility] = useState(""),
    [items, setItems] = useState<AdminStorySummary[] | null>(null),
    [error, setError] = useState<string | null>(null),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);
    void searchAdminStories({ query, visibility })
      .then((page) => {
        if (active) setItems(page.items);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Error");
      });
    return () => {
      active = false;
    };
  }, [query, visibility, nonce]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TRUST &amp; SAFETY</p>
          <h2>Stories</h2>
          <p>
            Visibilidad administrativa reversible sin alterar el lifecycle de
            media.
          </p>
        </div>
      </div>
      <div className="filters">
        <label className="search">
          <span>⌕</span>
          <input
            aria-label="Buscar Stories"
            placeholder="ID o autor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Visibilidad de Story"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="">Toda visibilidad</option>
          <option value="visible">Visible</option>
          <option value="hidden">Oculta</option>
        </select>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={() => setNonce((x) => x + 1)} />
      ) : !items ? (
        <LoadingState label="Buscando Stories…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Sin Stories"
          detail="No hay Stories para estos filtros."
        />
      ) : (
        <section className="table-panel">
          <div className="orders-table" role="table">
            <div className="table-head" role="row">
              <span>Story</span>
              <span>Autor</span>
              <span>Tipo</span>
              <span>Expira</span>
              <span>Estado</span>
              <span>Creada</span>
            </div>
            {items.map((story) => (
              <Link
                className="table-row"
                role="row"
                to={`/stories/${story.id}`}
                key={story.id}
              >
                <span>
                  <strong>{story.id}</strong>
                </span>
                <span>
                  {story.owner.display_name ??
                    story.owner.username ??
                    story.owner.id}
                </span>
                <span>
                  {story.story_kind} · {story.media_type}
                </span>
                <span>{formatDate(story.expires_at)}</span>
                <span>
                  <em
                    className={`badge ${story.visibility === "hidden" ? "warn" : ""}`}
                  >
                    {story.visibility}
                  </em>
                </span>
                <span>{formatDate(story.created_at)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function AdminStoryDetailPage() {
  const { id = "" } = useParams(),
    { hasCapability } = useAdminAuth();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    void getAdminStoryDetail(id)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Error");
      });
    return () => {
      active = false;
    };
  }, [id, nonce]);
  const visibility = detail?.visibility === "hidden" ? "hidden" : "visible",
    action = visibility === "hidden" ? "restore" : "hide";
  const run = async () => {
    if (reason.trim().length < 2)
      return setError("Indica un motivo de al menos 2 caracteres.");
    setBusy(true);
    setError(null);
    try {
      await moderateAdminStory({
        id,
        action,
        reason: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      setReason("");
      setNonce((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo moderar la Story");
    } finally {
      setBusy(false);
    }
  };
  if (error && !detail)
    return (
      <ErrorState message={error} onRetry={() => setNonce((x) => x + 1)} />
    );
  if (!detail) return <LoadingState label="Cargando Story…" />;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STORY</p>
          <h2>{id}</h2>
          <p>Moderación sin delete ni unlink de media.</p>
        </div>
        <em className={`badge ${visibility === "hidden" ? "warn" : ""}`}>
          {visibility}
        </em>
      </div>
      <section className="detail-card">
        <h3>Proyección administrativa segura</h3>
        <pre>{JSON.stringify(detail, null, 2)}</pre>
      </section>
      {hasCapability("stories.items.moderate") && (
        <section className="detail-card">
          <h3>{action === "hide" ? "Ocultar" : "Restaurar"} Story</h3>
          <textarea
            aria-label="Motivo"
            placeholder="Motivo obligatorio"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button disabled={busy} onClick={() => void run()}>
            {action === "hide" ? "Ocultar Story" : "Restaurar Story"}
          </button>
          {error && <p role="alert">{error}</p>}
          <small>La expiración, media y propiedad no se modifican.</small>
        </section>
      )}
    </>
  );
}
