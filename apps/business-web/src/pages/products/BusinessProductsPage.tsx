import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import { formatDate, formatMoney } from "../../lib/businessFormat";
import { createProductDraft, searchProducts, type ProductCursor, type ProductSummary } from "../../lib/sellerCenterApi";

const filters = [{ label: "Todos", value: "" }, { label: "Borradores", value: "draft" }, { label: "Activos", value: "active" }, { label: "Pausados", value: "paused" }];

export function BusinessProductsPage() {
  const navigate = useNavigate();
  const { currentBusiness, hasCapability } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const canManage = hasCapability("business.catalog.manage");
  const canSeeInventory = hasCapability("business.inventory.read") || hasCapability("business.inventory.manage");
  const [items, setItems] = useState<ProductSummary[]>([]);
  const [categories, setCategories] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<ProductCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const requestRef = useRef(0);

  const load = useCallback(async (append = false) => {
    if (!ownerId) return;
    const request = ++requestRef.current;
    if (append) setMore(true); else setLoading(true);
    setError(null);
    if (!append) {
      setItems([]);
      setCategories([]);
      setCategoryId("");
    }
    try {
      const page = await searchProducts(ownerId, { status: status || undefined, query: query || undefined, cursor: append ? cursor ?? undefined : undefined });
      if (request !== requestRef.current) return;
      setItems((current) => append ? [...current, ...page.items.filter((next) => !current.some((item) => item.id === next.id))] : page.items);
      setCategories(page.categories); setCategoryId((current) => current || String(page.categories[0]?.id ?? "")); setCursor(page.nextCursor);
    } catch (cause) { if (request === requestRef.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar el catálogo"); }
    finally { if (request === requestRef.current) { setLoading(false); setMore(false); } }
  }, [cursor, ownerId, query, status]);

  useEffect(() => {
    setCursor(null);
    void load(false);
    return () => { requestRef.current += 1; };
  }, [ownerId, status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (!currentBusiness?.store || !categoryId || !canManage) return;
    setCreating(true); setError(null);
    try { navigate(`/products/${await createProductDraft(currentBusiness.store.id, categoryId)}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear el producto"); setCreating(false); }
  }

  return <>
    <PageHeader eyebrow="Seller Center" title="Productos" description="Catálogo, variantes e inventario sobre el Marketplace canónico." action={canManage ? <div className="header-actions"><select aria-label="Categoría del nuevo producto" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={String(category.id)} value={String(category.id)}>{String(category.name)}</option>)}</select><button className="primary-button" type="button" disabled={creating || !categoryId} onClick={() => void create()}>{creating ? "Creando…" : "Nuevo producto"}</button></div> : undefined} />
    <div className="seller-subnav"><Link className="is-active" to="/products">Catálogo</Link>{canSeeInventory && <a href="#inventory">Inventario</a>}<Link to="/products/shipping">Envíos</Link></div>
    <section className="seller-toolbar"><div className="filter-row">{filters.map((filter) => <button type="button" key={filter.value} className={status === filter.value ? "filter-chip is-active" : "filter-chip"} onClick={() => setStatus(filter.value)}>{filter.label}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void load(false); }}><input aria-label="Buscar producto o SKU" placeholder="Buscar producto o SKU" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="secondary-button" type="submit">Buscar</button></form></section>
    <InlineError message={error} />
    {loading && <div className="seller-state">Cargando productos…</div>}
    {!loading && !error && items.length === 0 && <div className="seller-state"><strong>No hay productos en esta vista</strong><p>{canManage ? "Crea un borrador para empezar." : "No se encontraron productos."}</p></div>}
    {!loading && items.length > 0 && <div className="seller-table-wrap"><table className="seller-table"><thead><tr><th>Producto</th><th>Estado</th><th>Precio</th><th>Variantes</th>{canSeeInventory && <th>Disponible</th>}<th>Actualizado</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td data-label="Producto"><Link className="product-cell" to={`/products/${item.id}`}>{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span className="product-placeholder">◇</span>}<span><strong>{item.title}</strong><small>{item.readinessReason ? "Requiere configuración" : "Listo para publicar"}</small></span></Link></td><td data-label="Estado"><StatusBadge status={item.status} /></td><td data-label="Precio">{formatMoney(item.price, item.currency)}</td><td data-label="Variantes">{item.variantCount}</td>{canSeeInventory && <td data-label="Disponible">{item.availableStock ?? "—"}</td>}<td data-label="Actualizado">{formatDate(item.updatedAt)}</td></tr>)}</tbody></table></div>}
    {cursor && <div className="media-pagination"><button className="secondary-button" type="button" disabled={more} onClick={() => void load(true)}>{more ? "Cargando…" : "Ver más"}</button></div>}
  </>;
}
