import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthProvider";
import { EmptyState, ErrorState, LoadingState } from "../components/PageState";
import {
  dismissAdminReport,
  formatDate,
  getAdminReportDetail,
  moderateReportedChatMessage,
  reviewAdminReport,
  searchAdminReports,
  type AdminReportDetail,
  type AdminReportSummary,
} from "../lib/adminApi";

export function AdminChatReportsPage() {
  const [status, setStatus] = useState(""),
    [items, setItems] = useState<AdminReportSummary[] | null>(null),
    [error, setError] = useState<string | null>(null),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);
    void searchAdminReports({ status, contentType: "message" })
      .then((page) => {
        if (active) setItems(page.items);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Error");
      });
    return () => {
      active = false;
    };
  }, [status, nonce]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHAT ABUSE</p>
          <h2>Mensajes reportados</h2>
          <p>
            Sólo casos reportados; no existe navegación global de
            conversaciones.
          </p>
        </div>
      </div>
      <div className="filters">
        <select
          aria-label="Estado"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="pending">Pendientes</option>
          <option value="reviewed">Revisados</option>
          <option value="dismissed">Descartados</option>
        </select>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={() => setNonce((x) => x + 1)} />
      ) : !items ? (
        <LoadingState label="Buscando casos de Chat…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Sin reportes de Chat"
          detail="No hay mensajes reportados para este filtro."
        />
      ) : (
        <section className="table-panel">
          <div className="orders-table" role="table">
            <div className="table-head" role="row">
              <span>Reporte</span>
              <span>Reportante</span>
              <span>Motivo</span>
              <span>Estado</span>
              <span>Creado</span>
              <span>Mensaje</span>
            </div>
            {items.map((report) => (
              <Link
                className="table-row"
                role="row"
                to={`/chat/reports/${report.id}`}
                key={report.id}
              >
                <span>
                  <strong>{report.id}</strong>
                </span>
                <span>
                  {report.reporter.display_name ??
                    report.reporter.username ??
                    report.reporter.id}
                </span>
                <span>{report.reason}</span>
                <span>
                  <em className="badge">{report.status}</em>
                </span>
                <span>{formatDate(report.created_at)}</span>
                <span>{report.reported_content_id}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function AdminChatReportDetailPage() {
  const { id = "" } = useParams(),
    { hasCapability } = useAdminAuth();
  const [report, setReport] = useState<AdminReportDetail | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setReport(null);
    setError(null);
    void getAdminReportDetail(id)
      .then((value) => {
        if (active) setReport(value);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Error");
      });
    return () => {
      active = false;
    };
  }, [id, nonce]);
  const run = async (action: "hide" | "review" | "dismiss") => {
    if (reason.trim().length < 2)
      return setError("Indica un motivo de al menos 2 caracteres.");
    setBusy(true);
    setError(null);
    try {
      const key = crypto.randomUUID();
      if (action === "hide")
        await moderateReportedChatMessage({
          reportId: id,
          reason: reason.trim(),
          idempotencyKey: key,
        });
      else if (action === "review")
        await reviewAdminReport({
          id,
          note: reason.trim(),
          idempotencyKey: key,
        });
      else
        await dismissAdminReport({
          id,
          reason: reason.trim(),
          idempotencyKey: key,
        });
      setReason("");
      setNonce((x) => x + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo completar la acción",
      );
    } finally {
      setBusy(false);
    }
  };
  if (error && !report)
    return (
      <ErrorState message={error} onRetry={() => setNonce((x) => x + 1)} />
    );
  if (!report) return <LoadingState label="Cargando caso de Chat…" />;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHAT ABUSE</p>
          <h2>{report.reason}</h2>
          <p>{report.id}</p>
        </div>
        <em className="badge">{report.status}</em>
      </div>
      <section className="detail-grid">
        <article className="detail-card">
          <h3>Mensaje reportado</h3>
          <pre>{JSON.stringify(report.subject, null, 2)}</pre>
        </article>
        <article className="detail-card">
          <h3>Contexto mínimo</h3>
          <p>Máximo 3 mensajes antes y 3 después, de la misma conversación.</p>
          <pre>{JSON.stringify(report.chat_context, null, 2)}</pre>
        </article>
      </section>
      <section className="detail-card">
        <h3>Acción administrativa</h3>
        <textarea
          aria-label="Motivo"
          placeholder="Motivo obligatorio"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="button-row">
          {hasCapability("chat.abuse_reports.moderate") && (
            <button disabled={busy} onClick={() => void run("hide")}>
              Ocultar mensaje reportado
            </button>
          )}
          {report.status === "pending" &&
            hasCapability("reports.cases.review") && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void run("review")}
              >
                Marcar revisado
              </button>
            )}
          {report.status !== "dismissed" &&
            hasCapability("reports.cases.resolve") && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void run("dismiss")}
              >
                Descartar reporte
              </button>
            )}
        </div>
        {error && <p role="alert">{error}</p>}
        <small>
          El mensaje, sus receipts y la media se conservan. La media deja de
          autorizarse al quedar oculto.
        </small>
      </section>
    </>
  );
}
