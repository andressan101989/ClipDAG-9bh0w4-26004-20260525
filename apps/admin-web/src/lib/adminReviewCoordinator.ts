export const ADMIN_REVIEW_TTL_MS = 15 * 60 * 1000;
const STORAGE_PREFIX = "nelyon:admin:ads-review:";

export type AdminReviewIntent = {
  adId: string;
  submissionFingerprint: string;
  action: "approve" | "reject";
  reasonCode: string | null;
  note: string | null;
};
export type AdminReviewReconciliation = { status: "applied_as_intended" | "not_applied" | "applied_differently" | "unknown" };
export type AdminReviewResult =
  | { state: "success"; idempotencyKey: string; reconciled: boolean }
  | { state: "uncertain"; idempotencyKey: string; message: string }
  | { state: "conflict"; idempotencyKey: string; message: string };
export interface AdminReviewStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
export interface AdminReviewLockManager { request<T>(name: string, callback: () => Promise<T>): Promise<T>; }
type RecordState = { idempotencyKey: string; fingerprint: string; state: "pending" | "uncertain"; updatedAt: number };

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  return value;
}
function serialize(value: unknown) { return JSON.stringify(normalize(value)); }
async function fingerprint(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialize(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function browserStorage(): AdminReviewStorage {
  const memory = new Map<string, string>();
  try { if (typeof window !== "undefined" && window.localStorage) return window.localStorage; } catch { /* use memory */ }
  return { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); }, removeItem: (key) => { memory.delete(key); } };
}
function read(storage: AdminReviewStorage, key: string): RecordState | null {
  const raw = storage.getItem(key); if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RecordState>;
    return typeof value.idempotencyKey === "string" && typeof value.fingerprint === "string" && (value.state === "pending" || value.state === "uncertain") && typeof value.updatedAt === "number" ? value as RecordState : null;
  } catch { return null; }
}
function uncertain(cause: unknown) { return cause instanceof TypeError || cause instanceof SyntaxError || (cause instanceof Error && (cause.name === "AbortError" || /network|fetch|timeout|response|connection|reset/i.test(cause.message))); }
function reconcilable(cause: unknown) { return cause instanceof Error && /advertising_ad_(review_idempotency_conflict|not_pending)/.test(cause.message); }

export function createAdminReviewCoordinator(options: { storage?: AdminReviewStorage; locks?: AdminReviewLockManager | null; uuid?: () => string; now?: () => number; ttlMs?: number } = {}) {
  const storage = options.storage ?? browserStorage();
  const locks = options.locks === undefined ? ((typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: AdminReviewLockManager }).locks : null) ?? null) : options.locks;
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? ADMIN_REVIEW_TTL_MS;
  const inFlight = new Map<string, { payload: string; promise: Promise<AdminReviewResult> }>();

  async function execute(input: { intent: AdminReviewIntent; mutate: (key: string) => Promise<unknown>; reconcile: () => Promise<AdminReviewReconciliation> }, payloadFingerprint: string): Promise<AdminReviewResult> {
    const key = `${STORAGE_PREFIX}${input.intent.adId}`;
    const locked = async () => {
      const record = read(storage, key);
      if (record && record.fingerprint !== payloadFingerprint) throw new Error("This ad has an unresolved review with different details. Refresh it before choosing another decision.");
      if (record) {
        const outcome = await input.reconcile().catch(() => ({ status: "unknown" as const }));
        if (outcome.status === "applied_as_intended") { storage.removeItem(key); return { state: "success" as const, idempotencyKey: record.idempotencyKey, reconciled: true }; }
        if (outcome.status === "applied_differently") { storage.removeItem(key); return { state: "conflict" as const, idempotencyKey: record.idempotencyKey, message: "This review was completed with different details. Refresh the item." }; }
        if (outcome.status === "unknown" && now() - record.updatedAt <= ttlMs) return { state: "uncertain" as const, idempotencyKey: record.idempotencyKey, message: "We could not confirm this review yet. Refresh the item or retry safely." };
      }
      const idempotencyKey = record?.idempotencyKey ?? uuid();
      storage.setItem(key, JSON.stringify({ idempotencyKey, fingerprint: payloadFingerprint, state: "pending", updatedAt: now() } satisfies RecordState));
      try {
        await input.mutate(idempotencyKey);
        storage.removeItem(key);
        return { state: "success" as const, idempotencyKey, reconciled: false };
      } catch (cause) {
        if (!uncertain(cause) && !reconcilable(cause)) { storage.removeItem(key); throw cause; }
        storage.setItem(key, JSON.stringify({ idempotencyKey, fingerprint: payloadFingerprint, state: "uncertain", updatedAt: now() } satisfies RecordState));
        const outcome = await input.reconcile().catch(() => ({ status: "unknown" as const }));
        if (outcome.status === "applied_as_intended") { storage.removeItem(key); return { state: "success" as const, idempotencyKey, reconciled: true }; }
        if (outcome.status === "applied_differently" || reconcilable(cause)) { storage.removeItem(key); return { state: "conflict" as const, idempotencyKey, message: "This review was completed with different details. Refresh the item." }; }
        return { state: "uncertain" as const, idempotencyKey, message: "We could not confirm this review yet. Refresh the item or retry safely." };
      }
    };
    return locks ? locks.request(`nelyon-admin:ads-review:${input.intent.adId}`, locked) : locked();
  }

  function run(input: { intent: AdminReviewIntent; mutate: (key: string) => Promise<unknown>; reconcile: () => Promise<AdminReviewReconciliation> }) {
    const identity = input.intent.adId;
    const payload = serialize(input.intent);
    const active = inFlight.get(identity);
    if (active) return active.payload === payload ? active.promise : Promise.reject(new Error("This ad has an unresolved review with different details. Refresh it before choosing another decision."));
    const promise = fingerprint(input.intent).then((value) => execute(input, value)).finally(() => inFlight.delete(identity));
    inFlight.set(identity, { payload, promise });
    return promise;
  }
  return { run };
}

export const adminReviewCoordinator = createAdminReviewCoordinator();
