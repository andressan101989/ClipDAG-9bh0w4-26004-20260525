import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../components/PageState";
import { formatBdag, formatDate, type AdminRange } from "../lib/adminApi";
import {
  getAdDetail,
  getCreatorDetail,
  getCreatorOverview,
  getHealth,
  getPromotionDetail,
  safeNumber,
  safeText,
  searchActivity,
  searchAds,
  searchCreators,
  searchPromotions,
  type CreatorCursor,
  type IntelligenceCursor,
  type ValidatedRecord,
} from "../lib/adminIntelligenceApi";

const ranges: AdminRange[] = ["7d", "30d", "90d", "all"];
const label: Record<AdminRange, string> = {
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  all: "Todo",
};
const idOf = (row: ValidatedRecord, key = "id") => safeText(row[key]);
function RangePicker({
  value,
  onChange,
}: {
  value: AdminRange;
  onChange: (value: AdminRange) => void;
}) {
  return (
    <div className="range-tabs" aria-label="Rango">
      {ranges.map((item) => (
        <button
          className={item === value ? "active" : ""}
          key={item}
          onClick={() => onChange(item)}
        >
          {label[item]}
        </button>
      ))}
    </div>
  );
}
function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<string | null>(null),
    [nonce, setNonce] = useState(0),
    loadRef = useRef(load);
  loadRef.current = load;
  const loadKey = JSON.stringify(deps);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    void loadRef
      .current()
      .then((value) => active && setData(value))
      .catch(
        (reason) =>
          active &&
          setError(
            reason instanceof Error ? reason.message : "Error inesperado",
          ),
      );
    return () => {
      active = false;
    };
  }, [loadKey, nonce]);
  return { data, error, retry: () => setNonce((value) => value + 1) };
}
function MoneyCard({ title, value }: { title: string; value: unknown }) {
  return (
    <article className="metric-card">
      <span>{title}</span>
      <strong>{formatBdag(safeNumber(value))}</strong>
    </article>
  );
}
function Pager({
  back,
  next,
  onBack,
  onNext,
}: {
  back: boolean;
  next: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <footer className="pagination">
      <button className="secondary" disabled={!back} onClick={onBack}>
        Anterior
      </button>
      <button className="secondary" disabled={!next} onClick={onNext}>
        Siguiente
      </button>
    </footer>
  );
}

export function MarketplaceCreatorCommercePage() {
  const [params, setParams] = useSearchParams(),
    selected = (
      ranges.includes(params.get("range") as AdminRange)
        ? params.get("range")
        : "30d"
    ) as AdminRange,
    [query, setQuery] = useState(params.get("q") ?? ""),
    [cursors, setCursors] = useState<Array<CreatorCursor | undefined>>([
      undefined,
    ]),
    [page, setPage] = useState(0);
  const overview = useLoad(() => getCreatorOverview(selected), [selected]);
  const creators = useLoad(
    () =>
      searchCreators({
        query: params.get("q") ?? "",
        range: selected,
        cursor: cursors[page],
        limit: 50,
      }),
    [params.get("q"), selected, cursors, page],
  );
  const changeRange = (value: AdminRange) => {
    const next = new URLSearchParams(params);
    next.set("range", value);
    setParams(next);
    setCursors([undefined]);
    setPage(0);
  };
  if (overview.error)
    return <ErrorState message={overview.error} onRetry={overview.retry} />;
  if (!overview.data) return <LoadingState />;
  const summary = overview.data.summary as ValidatedRecord;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">INTELIGENCIA</p>
          <h2>Creator Commerce</h2>
          <p>Economía canónica por ítem, superficie y creador.</p>
        </div>
        <RangePicker value={selected} onChange={changeRange} />
      </div>
      <section className="metrics-grid">
        <MoneyCard title="GMV atribuido" value={summary.attributed_gmv} />
        <MoneyCard
          title="Comisión generada"
          value={summary.commission_generated}
        />
        <MoneyCard
          title="Comisión liberada"
          value={summary.commission_released}
        />
        <MoneyCard title="Comisión neta" value={summary.commission_net} />
      </section>
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams(params);
          if (query) next.set("q", query);
          else next.delete("q");
          setParams(next);
          setCursors([undefined]);
          setPage(0);
        }}
      >
        <input
          aria-label="Buscar creadores"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Usuario o nombre"
        />
        <button>Buscar</button>
      </form>
      {creators.error ? (
        <ErrorState message={creators.error} onRetry={creators.retry} />
      ) : !creators.data ? (
        <LoadingState />
      ) : creators.data.items.length === 0 ? (
        <EmptyState
          title="Sin actividad"
          detail="No hay Creator Commerce en este rango."
        />
      ) : (
        <section className="table-panel">
          <div className="orders-table">
            <div className="table-head">
              <span>Creador</span>
              <span>Pedidos</span>
              <span>GMV</span>
              <span>Generada</span>
              <span>Neta</span>
              <span>Superficie</span>
            </div>
            {creators.data.items.map((row) => (
              <Link
                className="table-row"
                key={idOf(row, "creator_id")}
                to={`/marketplace/creator-commerce/${idOf(row, "creator_id")}?range=${selected}`}
              >
                <span>
                  <strong>
                    {safeText(row.display_name) || safeText(row.username)}
                  </strong>
                  <small>{formatDate(row.last_sale)}</small>
                </span>
                <span>{safeNumber(row.orders)}</span>
                <span>{formatBdag(safeNumber(row.attributed_gmv))}</span>
                <span>{formatBdag(safeNumber(row.commission_generated))}</span>
                <span>{formatBdag(safeNumber(row.commission_net))}</span>
                <span>
                  <em className="badge">{safeText(row.top_surface)}</em>
                </span>
              </Link>
            ))}
          </div>
          <Pager
            back={page > 0}
            next={!!creators.data.nextCursor}
            onBack={() => setPage((value) => value - 1)}
            onNext={() => {
              if (creators.data?.nextCursor) {
                setCursors((old) => [
                  ...old.slice(0, page + 1),
                  creators.data?.nextCursor ?? undefined,
                ]);
                setPage((value) => value + 1);
              }
            }}
          />
        </section>
      )}
    </>
  );
}

export function MarketplaceCreatorDetailPage() {
  const { id = "" } = useParams(),
    [params, setParams] = useSearchParams(),
    selected = (
      ranges.includes(params.get("range") as AdminRange)
        ? params.get("range")
        : "30d"
    ) as AdminRange;
  const state = useLoad(() => getCreatorDetail(id, selected), [id, selected]);
  if (state.error)
    return <ErrorState message={state.error} onRetry={state.retry} />;
  if (!state.data) return <LoadingState />;
  const creator = state.data.creator as ValidatedRecord,
    summary = state.data.summary as ValidatedRecord,
    surfaces = state.data.surface_breakdown as ValidatedRecord[],
    items = state.data.item_trace as ValidatedRecord[];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CREATOR COMMERCE</p>
          <h2>
            {safeText(creator.display_name) || safeText(creator.username)}
          </h2>
          <p>Traza financiera histórica; sin controles de comisión o pago.</p>
        </div>
        <RangePicker
          value={selected}
          onChange={(value) => {
            const next = new URLSearchParams(params);
            next.set("range", value);
            setParams(next);
          }}
        />
      </div>
      <section className="metrics-grid">
        <MoneyCard title="GMV" value={summary.attributed_gmv} />
        <MoneyCard title="Generada" value={summary.commission_generated} />
        <MoneyCard title="Liberada" value={summary.commission_released} />
        <MoneyCard title="Revertida" value={summary.commission_reversed} />
      </section>
      <section className="detail-grid">
        <article className="detail-card">
          <h3>Superficies</h3>
          {surfaces.map((row) => (
            <div className="fact-row" key={safeText(row.source_surface)}>
              <span>{safeText(row.source_surface)}</span>
              <strong>{formatBdag(safeNumber(row.attributed_gmv))}</strong>
            </div>
          ))}
        </article>
        <article className="detail-card wide">
          <h3>Traza por ítem</h3>
          {items.length === 0 ? (
            <p>Sin ítems.</p>
          ) : (
            items.map((row) => (
              <div className="fact-row" key={idOf(row, "order_item_id")}>
                <span>
                  {safeText(row.product_title)} · {safeText(row.source_surface)}
                  <small>{idOf(row, "order_id")}</small>
                </span>
                <strong>
                  {formatBdag(safeNumber(row.attributed_gmv))}
                  <small>
                    Comisión {formatBdag(safeNumber(row.commission_generated))}
                  </small>
                </strong>
              </div>
            ))
          )}
        </article>
      </section>
    </>
  );
}

export function MarketplacePromotionsPage() {
  const [params, setParams] = useSearchParams(),
    [query, setQuery] = useState(params.get("q") ?? ""),
    stateFilter = params.get("state") ?? "",
    [cursors, setCursors] = useState<Array<IntelligenceCursor | undefined>>([
      undefined,
    ]),
    [page, setPage] = useState(0);
  const state = useLoad(
    () =>
      searchPromotions({
        query: params.get("q") ?? "",
        state: stateFilter,
        cursor: cursors[page],
        limit: 50,
      }),
    [params.get("q"), stateFilter, cursors, page],
  );
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setCursors([undefined]);
    setPage(0);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">INTELIGENCIA</p>
          <h2>Promociones</h2>
          <p>Precios efectivos actuales y snapshots históricos inmutables.</p>
        </div>
      </div>
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter("q", query);
        }}
      >
        <input
          aria-label="Buscar promociones"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Producto, tienda o vendedor"
        />
        <select
          aria-label="Estado de promoción"
          value={stateFilter}
          onChange={(event) => setFilter("state", event.target.value)}
        >
          <option value="">Todos</option>
          {["scheduled", "active", "ended", "cancelled"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <button>Buscar</button>
      </form>
      {state.error ? (
        <ErrorState message={state.error} onRetry={state.retry} />
      ) : !state.data ? (
        <LoadingState />
      ) : state.data.items.length === 0 ? (
        <EmptyState
          title="Sin promociones"
          detail="No hay promociones para estos filtros."
        />
      ) : (
        <section className="table-panel">
          <div className="orders-table">
            <div className="table-head">
              <span>Producto</span>
              <span>Tienda</span>
              <span>Tipo</span>
              <span>Vigencia</span>
              <span>Uso</span>
              <span>Estado</span>
            </div>
            {state.data.items.map((row) => (
              <Link
                className="table-row"
                key={idOf(row)}
                to={`/marketplace/promotions/${idOf(row)}`}
              >
                <span>
                  <strong>{safeText(row.product_title)}</strong>
                  <small>{safeText(row.variant_title)}</small>
                </span>
                <span>{safeText(row.store_name)}</span>
                <span>{safeText(row.promotion_type)}</span>
                <span>
                  {formatDate(row.starts_at)}
                  <small>{formatDate(row.ends_at)}</small>
                </span>
                <span>{safeNumber(row.historical_orders)} pedidos</span>
                <span>
                  <em className="badge">{safeText(row.state)}</em>
                </span>
              </Link>
            ))}
          </div>
          <Pager
            back={page > 0}
            next={!!state.data.nextCursor}
            onBack={() => setPage((value) => value - 1)}
            onNext={() => {
              if (state.data?.nextCursor) {
                setCursors((old) => [
                  ...old.slice(0, page + 1),
                  state.data?.nextCursor ?? undefined,
                ]);
                setPage((value) => value + 1);
              }
            }}
          />
        </section>
      )}
    </>
  );
}

export function MarketplacePromotionDetailPage() {
  const { id = "" } = useParams(),
    state = useLoad(() => getPromotionDetail(id), [id]);
  if (state.error)
    return <ErrorState message={state.error} onRetry={state.retry} />;
  if (!state.data) return <LoadingState />;
  const promotion = state.data.promotion as ValidatedRecord,
    product = state.data.product as ValidatedRecord,
    current = state.data.current_price as ValidatedRecord | null,
    history = state.data.historical_usage as ValidatedRecord[];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROMOCIÓN</p>
          <h2>{safeText(product.title)}</h2>
          <p>
            Definición canónica y uso histórico; sin edición administrativa.
          </p>
        </div>
      </div>
      <section className="detail-grid">
        <article className="detail-card">
          <h3>Configuración</h3>
          <div className="fact-row">
            <span>Tipo</span>
            <strong>{safeText(promotion.promotion_type)}</strong>
          </div>
          <div className="fact-row">
            <span>Estado</span>
            <strong>{safeText(promotion.status)}</strong>
          </div>
          <div className="fact-row">
            <span>Inicio</span>
            <strong>{formatDate(promotion.starts_at)}</strong>
          </div>
          <div className="fact-row">
            <span>Fin</span>
            <strong>{formatDate(promotion.ends_at)}</strong>
          </div>
          {current && (
            <>
              <div className="fact-row">
                <span>Base actual</span>
                <strong>{formatBdag(safeNumber(current.base_price))}</strong>
              </div>
              <div className="fact-row">
                <span>Efectivo actual</span>
                <strong>
                  {formatBdag(safeNumber(current.effective_price))}
                </strong>
              </div>
            </>
          )}
        </article>
        <article className="detail-card wide">
          <h3>Snapshots de pedidos</h3>
          {history.length === 0 ? (
            <p>Sin uso histórico.</p>
          ) : (
            history.map((row) => (
              <div className="fact-row" key={idOf(row, "order_item_id")}>
                <span>
                  {idOf(row, "order_id")}
                  <small>{safeNumber(row.quantity)} unidades</small>
                </span>
                <strong>
                  {formatBdag(safeNumber(row.unit_price))}
                  <small>
                    Base {formatBdag(safeNumber(row.base_unit_price))} ·
                    descuento {formatBdag(safeNumber(row.discount_amount))}
                  </small>
                </strong>
              </div>
            ))
          )}
        </article>
      </section>
    </>
  );
}

export function MarketplaceAdsPage() {
  const [params, setParams] = useSearchParams(),
    [query, setQuery] = useState(params.get("q") ?? ""),
    status = params.get("status") ?? "",
    [cursors, setCursors] = useState<Array<IntelligenceCursor | undefined>>([
      undefined,
    ]),
    [page, setPage] = useState(0);
  const state = useLoad(
    () =>
      searchAds({
        query: params.get("q") ?? "",
        status,
        cursor: cursors[page],
        limit: 50,
      }),
    [params.get("q"), status, cursors, page],
  );
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setCursors([undefined]);
    setPage(0);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MARKETPLACE ADS</p>
          <h2>Campañas</h2>
          <p>Supervisión de elegibilidad, reserva y entrega canónicas.</p>
        </div>
      </div>
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          filter("q", query);
        }}
      >
        <input
          aria-label="Buscar campañas"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Campaña, producto o tienda"
        />
        <select
          aria-label="Estado de campaña"
          value={status}
          onChange={(event) => filter("status", event.target.value)}
        >
          <option value="">Todos</option>
          {[
            "draft",
            "scheduled",
            "active",
            "paused",
            "exhausted",
            "completed",
            "cancelled",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <button>Buscar</button>
      </form>
      {state.error ? (
        <ErrorState message={state.error} onRetry={state.retry} />
      ) : !state.data ? (
        <LoadingState />
      ) : state.data.items.length === 0 ? (
        <EmptyState
          title="Sin campañas"
          detail="No hay campañas para estos filtros."
        />
      ) : (
        <section className="table-panel">
          <div className="orders-table">
            <div className="table-head">
              <span>Campaña</span>
              <span>Producto</span>
              <span>Presupuesto</span>
              <span>Gastado</span>
              <span>Reserva</span>
              <span>Estado</span>
            </div>
            {state.data.items.map((row) => (
              <Link
                className="table-row"
                key={idOf(row)}
                to={`/marketplace/ads/${idOf(row)}`}
              >
                <span>
                  <strong>{safeText(row.name)}</strong>
                  <small>{safeText(row.store_name)}</small>
                </span>
                <span>{safeText(row.product_title)}</span>
                <span>{formatBdag(safeNumber(row.total_budget))}</span>
                <span>{formatBdag(safeNumber(row.spent))}</span>
                <span>{formatBdag(safeNumber(row.remaining_reserved))}</span>
                <span>
                  <em className={`badge ${row.attention ? "warn" : ""}`}>
                    {safeText(row.status)}
                  </em>
                  <small>{safeText(row.eligibility_reason)}</small>
                </span>
              </Link>
            ))}
          </div>
          <Pager
            back={page > 0}
            next={!!state.data.nextCursor}
            onBack={() => setPage((value) => value - 1)}
            onNext={() => {
              if (state.data?.nextCursor) {
                setCursors((old) => [
                  ...old.slice(0, page + 1),
                  state.data?.nextCursor ?? undefined,
                ]);
                setPage((value) => value + 1);
              }
            }}
          />
        </section>
      )}
    </>
  );
}

export function MarketplaceAdDetailPage() {
  const { id = "" } = useParams(),
    state = useLoad(() => getAdDetail(id), [id]);
  if (state.error)
    return <ErrorState message={state.error} onRetry={state.retry} />;
  if (!state.data) return <LoadingState />;
  const campaign = state.data.campaign as ValidatedRecord,
    financial = state.data.financial as ValidatedRecord,
    events = state.data.financial_events as ValidatedRecord[],
    attribution = state.data.attribution as ValidatedRecord,
    finalization = state.data.finalization as ValidatedRecord | null;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MARKETPLACE ADS</p>
          <h2>{safeText(campaign.name)}</h2>
          <p>
            Sin controles administrativos de gasto, liberación o finalización.
          </p>
        </div>
      </div>
      <section className="metrics-grid">
        <MoneyCard title="Presupuesto" value={financial.total_budget} />
        <MoneyCard title="Gastado" value={financial.spent} />
        <MoneyCard title="Liberado" value={financial.released} />
        <MoneyCard title="Reserva" value={financial.remaining_reserved} />
      </section>
      <section className="detail-grid">
        <article className="detail-card">
          <h3>Ciclo</h3>
          <div className="fact-row">
            <span>Estado</span>
            <strong>{safeText(campaign.status)}</strong>
          </div>
          <div className="fact-row">
            <span>Elegibilidad</span>
            <strong>{safeText(campaign.eligibility_reason)}</strong>
          </div>
          <div className="fact-row">
            <span>Inicio</span>
            <strong>{formatDate(campaign.starts_at)}</strong>
          </div>
          <div className="fact-row">
            <span>Fin</span>
            <strong>{formatDate(campaign.ends_at)}</strong>
          </div>
        </article>
        <article className="detail-card">
          <h3>Atribución</h3>
          <div className="fact-row">
            <span>Pedidos</span>
            <strong>{safeNumber(attribution.orders)}</strong>
          </div>
          <div className="fact-row">
            <span>GMV</span>
            <strong>{formatBdag(safeNumber(attribution.gmv))}</strong>
          </div>
          {finalization && (
            <div className="fact-row">
              <span>Finalizada</span>
              <strong>{formatDate(finalization.finalized_at)}</strong>
            </div>
          )}
        </article>
        <article className="detail-card wide">
          <h3>Eventos financieros canónicos</h3>
          {events.length === 0 ? (
            <p>Sin eventos.</p>
          ) : (
            events.map((row) => (
              <div className="fact-row" key={idOf(row)}>
                <span>
                  {safeText(row.event_type)}
                  <small>{formatDate(row.created_at)}</small>
                </span>
                <strong>{formatBdag(safeNumber(row.amount))}</strong>
              </div>
            ))
          )}
        </article>
      </section>
    </>
  );
}

export function MarketplaceHealthPage() {
  const state = useLoad(getHealth, []);
  if (state.error)
    return <ErrorState message={state.error} onRetry={state.retry} />;
  if (!state.data) return <LoadingState />;
  const groups = state.data.groups as ValidatedRecord[],
    attention = state.data.attention as ValidatedRecord[];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OBSERVABILIDAD</p>
          <h2>Salud de Marketplace</h2>
          <p>
            Conciliaciones canónicas de solo lectura. No existe reparación desde
            esta pantalla.
          </p>
        </div>
        <em className={`badge ${state.data.healthy ? "" : "warn"}`}>
          {state.data.healthy ? "Saludable" : "Requiere atención"}
        </em>
      </div>
      <section className="health-grid">
        {groups.map((row) => (
          <article className="detail-card" key={safeText(row.name)}>
            <h3>{safeText(row.name)}</h3>
            <strong className={row.healthy ? "health-ok" : "health-bad"}>
              {row.healthy
                ? "OK"
                : `${safeNumber(row.failing_check_count)} fallas`}
            </strong>
            <small>{safeNumber(row.check_count)} controles</small>
          </article>
        ))}
      </section>
      {attention.length > 0 && (
        <section className="detail-card">
          <h3>Atención explicable</h3>
          {attention.map((row) => (
            <div
              className="fact-row"
              key={`${safeText(row.reason_code)}-${idOf(row, "entity_id")}`}
            >
              <span>{safeText(row.message)}</span>
              <em className="badge warn">{safeText(row.severity)}</em>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

export function MarketplaceActivityPage() {
  const [params, setParams] = useSearchParams(),
    action = params.get("action") ?? "",
    target = params.get("target") ?? "",
    [cursors, setCursors] = useState<Array<IntelligenceCursor | undefined>>([
      undefined,
    ]),
    [page, setPage] = useState(0);
  const state = useLoad(
    () =>
      searchActivity({
        action,
        targetType: target,
        cursor: cursors[page],
        limit: 50,
      }),
    [action, target, cursors, page],
  );
  const change = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      if (value) next.set(key, value);
      else next.delete(key);
      setParams(next);
      setCursors([undefined]);
      setPage(0);
    },
    [params, setParams],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">AUDITORÍA</p>
          <h2>Actividad administrativa</h2>
          <p>Historial privilegiado inmutable y escrito por servidor.</p>
        </div>
      </div>
      <div className="filters">
        <input
          aria-label="Filtrar acción"
          value={action}
          onChange={(event) => change("action", event.target.value)}
          placeholder="Acción exacta"
        />
        <input
          aria-label="Filtrar tipo objetivo"
          value={target}
          onChange={(event) => change("target", event.target.value)}
          placeholder="Tipo de objetivo"
        />
      </div>
      {state.error ? (
        <ErrorState message={state.error} onRetry={state.retry} />
      ) : !state.data ? (
        <LoadingState />
      ) : state.data.items.length === 0 ? (
        <EmptyState
          title="Sin actividad"
          detail="No hay acciones para estos filtros."
        />
      ) : (
        <section className="table-panel">
          <div className="orders-table">
            <div className="table-head">
              <span>Fecha</span>
              <span>Administrador</span>
              <span>Acción</span>
              <span>Objetivo</span>
              <span>Motivo</span>
              <span>ID</span>
            </div>
            {state.data.items.map((row) => (
              <div className="table-row" key={idOf(row)}>
                <span>{formatDate(row.created_at)}</span>
                <span>
                  {safeText(row.actor_display_name) ||
                    safeText(row.actor_username)}
                </span>
                <span>
                  <em className="badge">{safeText(row.action)}</em>
                </span>
                <span>{safeText(row.target_type)}</span>
                <span>{safeText(row.reason_code)}</span>
                <span>
                  <small>{idOf(row, "target_id")}</small>
                </span>
              </div>
            ))}
          </div>
          <Pager
            back={page > 0}
            next={!!state.data.nextCursor}
            onBack={() => setPage((value) => value - 1)}
            onNext={() => {
              if (state.data?.nextCursor) {
                setCursors((old) => [
                  ...old.slice(0, page + 1),
                  state.data?.nextCursor ?? undefined,
                ]);
                setPage((value) => value + 1);
              }
            }}
          />
        </section>
      )}
    </>
  );
}
