import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export function OperationConfirm({
  title,
  actions,
  maxReasonLength,
  onRun,
}: {
  title: string;
  actions: Array<{
    value: string;
    label: string;
    reasonRequired?: boolean;
    danger?: boolean;
  }>;
  maxReasonLength: number;
  onRun: (
    action: string,
    reason: string,
    idempotencyKey: string,
  ) => Promise<void>;
}) {
  const [action, setAction] = useState(actions[0]?.value ?? ""),
    [reason, setReason] = useState(""),
    [pending, setPending] = useState(false),
    [dialogOpen, setDialogOpen] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null),
    running = useRef(false),
    trigger = useRef<HTMLButtonElement>(null);
  const selected = actions.find((item) => item.value === action);
  const requestConfirmation = () => {
    if (!selected) return;
    const normalized = reason.trim();
    if (selected.reasonRequired && !normalized) {
      setMessage("El motivo es obligatorio.");
      return;
    }
    if (normalized.length > maxReasonLength) {
      setMessage(`El motivo no puede superar ${maxReasonLength} caracteres.`);
      return;
    }
    setMessage(null);
    setDialogOpen(true);
  };
  const closeDialog = useCallback(() => {
    if (pending) return;
    setDialogOpen(false);
    queueMicrotask(() => trigger.current?.focus());
  }, [pending]);
  const submit = async () => {
    if (!selected || pending || running.current) return;
    const normalized = reason.trim();
    const fingerprint = `${action}|${normalized}`,
      idempotency =
        retry.current?.fingerprint === fingerprint
          ? retry.current
          : { fingerprint, key: crypto.randomUUID() };
    retry.current = idempotency;
    running.current = true;
    setPending(true);
    setMessage(null);
    try {
      await onRun(action, normalized, idempotency.key);
      retry.current = null;
      setReason("");
      setDialogOpen(false);
      setMessage("Operación confirmada por el servidor.");
    } catch (error) {
      setDialogOpen(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo completar la operación",
      );
    } finally {
      running.current = false;
      setPending(false);
      queueMicrotask(() => trigger.current?.focus());
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
          maxLength={maxReasonLength}
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
        onClick={requestConfirmation}
        ref={trigger}
        type="button"
      >
        Revisar operación
      </button>
      <ConfirmDialog
        actionLabel={selected?.label ?? "Confirmar"}
        consequence={`Esta acción privilegiada se registrará en la auditoría y aplicará el estado canónico: ${selected?.label ?? "operación"}.`}
        danger={selected?.danger}
        onCancel={closeDialog}
        onConfirm={() => void submit()}
        open={dialogOpen}
        pending={pending}
        reason={reason.trim()}
        title={title}
      />
    </section>
  );
}
