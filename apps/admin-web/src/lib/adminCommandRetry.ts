export type AdminCommandAttempt = { signature: string; idempotencyKey: string };

export function adminCommandSignature(parts: readonly string[]) {
  return JSON.stringify(parts);
}

export function acquireAdminCommandAttempt(
  current: AdminCommandAttempt | null,
  signature: string,
  createId: () => string,
): AdminCommandAttempt {
  if (current?.signature === signature) return current;
  return { signature, idempotencyKey: createId() };
}

// Only positive evidence of a rejection retires an uncertain command. Transport
// errors (including malformed/lost receipts), timeouts and server failures keep it.
export function isDefinitiveAdminCommandFailure(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { code?: unknown; status?: unknown };
  const status = Number(error.status);
  if (status >= 500 || status === 408 || status === 429) return false;
  if (status >= 400 && status < 500) return [400, 401, 403, 404, 405, 406, 409, 410, 413, 415, 422].includes(status);
  const code = String(error.code ?? "");
  if (["42501", "28000", "28P01", "PGRST301", "PGRST302", "PGRST303"].includes(code)) return true;
  // Connection, transaction, cancellation and availability failures stay uncertain.
  return /^(22|23|P0)/.test(code);
}

export function adminCommandMaterial(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, normalize(value)]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

/** Page-local intent memory, never an authority or a server command ledger. */
export function createAdminCommandCoordinator(createId: () => string = () => crypto.randomUUID()) {
  const attempts = new Map<string, AdminCommandAttempt>();
  let drafts: Record<string, string> = {};
  let actor = "";
  let running = false;
  return {
    get running() { return running; },
    observe(nextActor: string, nextDrafts: Record<string, unknown>) {
      if (actor !== nextActor) {
        attempts.clear();
        actor = nextActor;
      }
      const next = Object.fromEntries(Object.entries(nextDrafts)
        .map(([slot, value]) => [slot, adminCommandMaterial(value)]));
      for (const slot of attempts.keys()) {
        if (drafts[slot] !== next[slot]) attempts.delete(slot);
      }
      drafts = next;
    },
    // An in-flight request cannot be cancelled or forgotten until it settles.
    reset(slot?: string) {
      if (running) return;
      if (slot) attempts.delete(slot);
      else attempts.clear();
    },
    async run(slot: string, payload: unknown, mutate: (key: string) => Promise<unknown>): Promise<boolean> {
      if (running) return false;
      const signature = adminCommandSignature([actor, slot, adminCommandMaterial(payload)]);
      const attempt = acquireAdminCommandAttempt(attempts.get(slot) ?? null, signature, createId);
      attempts.set(slot, attempt);
      running = true;
      try {
        await mutate(attempt.idempotencyKey);
        const current = attempts.get(slot) === attempt;
        if (current) attempts.delete(slot);
        // Material edits/navigation may have superseded this completion.
        return current;
      } catch (cause) {
        if (attempts.get(slot) === attempt && isDefinitiveAdminCommandFailure(cause)) attempts.delete(slot);
        throw cause;
      } finally {
        running = false;
      }
    },
  };
}
