import { useRef, useState } from "react";

export function OperationConfirm({
  title,
  actions,
  onRun,
}: {
  title: string;
  actions: Array<{
    value: string;
    label: string;
    reasonRequired?: boolean;
    danger?: boolean;
  }>;
  onRun: (
    action: string,
    reason: string,
    idempotencyKey: string,
  ) => Promise<void>;
}) {
  const [action, setAction] = useState(actions[0]?.value ?? ""),
    [reason, setReason] = useState(""),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const selected = actions.find((item) => item.value === action);
  const submit = async () => {
    if (!selected) return;
    const normalized = reason.trim();
    if (selected.reasonRequired && !normalized) {
      setMessage("El motivo es obligatorio.");
      return;
    }
    if (!window.confirm(`Confirmar: ${selected.label}`)) return;
    const fingerprint = `${action}|${normalized}`,
      idempotency =
        retry.current?.fingerprint === fingerprint
          ? retry.current
          : { fingerprint, key: crypto.randomUUID() };
    retry.current = idempotency;
    setPending(true);
    setMessage(null);
    try {
      await onRun(action, normalized, idempotency.key);
      retry.current = null;
      setReason("");
      setMessage("Operación confirmada por el servidor.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo completar la operación",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="panel operation-panel">
      <div className="panel-title">
        <h3>{title}</h3>
        <span>Acción privilegiada auditada</span>
      </div>
      <label>
        Acción
        <select
          aria-label="Acción"
          value={action}
          disabled={pending}
          onChange={(event) => setAction(event.target.value)}
        >
          {actions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Motivo
        <textarea
          aria-label="Motivo"
          maxLength={1000}
          value={reason}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
          placeholder={selected?.reasonRequired ? "Obligatorio" : "Opcional"}
        />
      </label>
      {message && (
        <p className="operation-message" role="status">
          {message}
        </p>
      )}
      <button
        className={selected?.danger ? "danger" : ""}
        disabled={pending || !action}
        onClick={() => void submit()}
      >
        {pending ? "Procesando…" : "Confirmar operación"}
      </button>
    </section>
  );
}
