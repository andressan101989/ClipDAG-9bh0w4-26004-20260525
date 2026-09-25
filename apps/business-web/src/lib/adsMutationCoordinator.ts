export const ADS_MUTATION_TTL_MS = 15 * 60 * 1000;
const STORAGE_PREFIX = "nelyon:ads-v2:mutation:";

export type AdsMutationOperationState = "pending" | "uncertain" | "applied";
export type AdsMutationReconciliation<T> =
  | { status: "applied_as_intended"; value: T }
  | { status: "not_applied" }
  | { status: "applied_differently" }
  | { status: "unknown" };

export type AdsMutationResult<T> =
  | { state: "success"; value: T; idempotencyKey: string; reconciled: boolean; message?: string }
  | { state: "uncertain"; idempotencyKey: string; message: string }
  | { state: "conflict"; idempotencyKey: string; message: string };

export type AdsMutationRecord = {
  operation: string;
  scope: string;
  idempotencyKey: string;
  fingerprint: string;
  state: AdsMutationOperationState;
  createdAt: number;
  updatedAt: number;
};

export interface AdsMutationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AdsMutationLockManager {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export type AdsMutationRunInput<T> = {
  operation: string;
  scope: string;
  payload: unknown;
  mutate: (idempotencyKey: string) => Promise<T>;
  reconcile: (context: { idempotencyKey: string; fingerprint: string }) => Promise<AdsMutationReconciliation<T>>;
};

type CoordinatorOptions = {
  storage?: AdsMutationStorage;
  locks?: AdsMutationLockManager | null;
  now?: () => number;
  uuid?: () => string;
  ttlMs?: number;
};

export class AdsMutationPayloadChangedError extends Error {
  constructor() {
    super("This step has an unresolved save with different values. Refresh the saved state before trying again.");
    this.name = "AdsMutationPayloadChangedError";
  }
}

function normalizedPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedPayload);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizedPayload(item)]);
    return Object.fromEntries(entries);
  }
  return value;
}

function serializedPayload(value: unknown) {
  return JSON.stringify(normalizedPayload(value));
}

export function areAdsMutationPayloadsEquivalent(left: unknown, right: unknown) {
  return serializedPayload(left) === serializedPayload(right);
}

export async function fingerprintAdsMutationPayload(value: unknown) {
  const bytes = new TextEncoder().encode(serializedPayload(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

class MemoryStorage implements AdsMutationStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const fallbackStorage = new MemoryStorage();

export class ResilientAdsMutationStorage implements AdsMutationStorage {
  private fallbackOnly = false;
  constructor(private readonly primary: Storage, private readonly fallback: AdsMutationStorage) {}

  getItem(key: string) {
    if (this.fallbackOnly) return this.fallback.getItem(key);
    try {
      const value = this.primary.getItem(key);
      if (value != null) this.fallback.setItem(key, value);
      else this.fallback.removeItem(key);
      return value;
    } catch {
      this.fallbackOnly = true;
      return this.fallback.getItem(key);
    }
  }

  setItem(key: string, value: string) {
    this.fallback.setItem(key, value);
    try { this.primary.setItem(key, value); }
    catch { this.fallbackOnly = true; }
  }

  removeItem(key: string) {
    this.fallback.removeItem(key);
    if (this.fallbackOnly) return;
    try { this.primary.removeItem(key); }
    catch { this.fallbackOnly = true; }
  }
}

function browserStorage(): AdsMutationStorage {
  try {
    if (typeof window !== "undefined" && window.localStorage) return new ResilientAdsMutationStorage(window.localStorage, fallbackStorage);
  } catch {
    // Privacy modes may deny storage. The in-memory fallback still protects one tab.
  }
  return fallbackStorage;
}

function browserLocks(): AdsMutationLockManager | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: AdsMutationLockManager }).locks;
  return locks ?? null;
}

function storageKey(operation: string, scope: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(operation)}:${encodeURIComponent(scope)}`;
}

function readRecord(storage: AdsMutationStorage, key: string): AdsMutationRecord | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Partial<AdsMutationRecord>;
    if (
      typeof record.operation !== "string" || typeof record.scope !== "string"
      || typeof record.idempotencyKey !== "string" || typeof record.fingerprint !== "string"
      || (record.state !== "pending" && record.state !== "uncertain" && record.state !== "applied")
      || typeof record.createdAt !== "number" || typeof record.updatedAt !== "number"
    ) return null;
    return record as AdsMutationRecord;
  } catch {
    return null;
  }
}

function writeRecord(storage: AdsMutationStorage, key: string, record: AdsMutationRecord) {
  storage.setItem(key, JSON.stringify(record));
}

function isIdempotencyConflict(cause: unknown) {
  return cause instanceof Error && cause.message.includes("idempotency_conflict");
}

function isUncertainFailure(cause: unknown) {
  if (cause instanceof TypeError || cause instanceof SyntaxError) return true;
  if (!(cause instanceof Error)) return false;
  return cause.name === "AbortError" || /network|fetch|timeout|response|connection|reset/i.test(cause.message);
}

async function safeReconcile<T>(
  reconcile: AdsMutationRunInput<T>["reconcile"],
  record: Pick<AdsMutationRecord, "idempotencyKey" | "fingerprint">,
): Promise<AdsMutationReconciliation<T>> {
  try { return await reconcile(record); }
  catch { return { status: "unknown" }; }
}

function reconciledResult<T>(
  outcome: AdsMutationReconciliation<T>,
  idempotencyKey: string,
  conflict: boolean,
): AdsMutationResult<T> | null {
  if (outcome.status === "applied_as_intended") {
    return {
      state: "success",
      value: outcome.value,
      idempotencyKey,
      reconciled: true,
      message: conflict ? "Already saved. We refreshed the saved version." : undefined,
    };
  }
  if (outcome.status === "applied_differently") {
    return {
      state: "conflict",
      idempotencyKey,
      message: "This step was already saved with different values. Review the saved version before trying again.",
    };
  }
  if (outcome.status === "unknown") {
    return {
      state: "uncertain",
      idempotencyKey,
      message: "We could not confirm whether this step was saved. Retry safely or refresh the saved state.",
    };
  }
  return null;
}

export function createAdsMutationCoordinator(options: CoordinatorOptions = {}) {
  const storage = options.storage ?? browserStorage();
  const locks = options.locks === undefined ? browserLocks() : options.locks;
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const ttlMs = options.ttlMs ?? ADS_MUTATION_TTL_MS;
  const inFlight = new Map<string, { payload: string; promise: Promise<AdsMutationResult<unknown>> }>();

  async function execute<T>(input: AdsMutationRunInput<T>, fingerprint: string): Promise<AdsMutationResult<T>> {
    const key = storageKey(input.operation, input.scope);
    const discovered = readRecord(storage, key);

    const executeLocked = async (): Promise<AdsMutationResult<T>> => {
      let record = readRecord(storage, key) ?? discovered;

      if (record && record.fingerprint !== fingerprint) {
        if (record.state !== "applied") {
          // The caller only has the new payload. It cannot prove whether the old
          // payload committed, so it must never reconcile or replace that attempt.
          throw new AdsMutationPayloadChangedError();
        }
        // A successful response already established the prior canonical outcome.
        // A materially changed payload is therefore a new logical operation.
        storage.removeItem(key);
        record = null;
      }

      if (record) {
        const stale = now() - record.updatedAt > ttlMs;
        const prior = await safeReconcile(input.reconcile, record);
        const result = reconciledResult(prior, record.idempotencyKey, false);
        if (result?.state === "success") writeRecord(storage, key, { ...record, state: "applied", updatedAt: now() });
        if (result?.state === "conflict") storage.removeItem(key);
        if (result) return result;
        if (record.state === "applied" && prior.status === "not_applied") {
          // The earlier operation completed, but canonical state has since moved on
          // (for example pause → resume → pause). This is a new logical attempt.
          storage.removeItem(key);
          record = null;
        }
        if (record && !stale && prior.status !== "not_applied") return {
          state: "uncertain",
          idempotencyKey: record.idempotencyKey,
          message: "Another tab is saving this step. Refresh the saved state before trying again.",
        };
      }

      const idempotencyKey = record?.idempotencyKey ?? uuid();
      const createdAt = record?.createdAt ?? now();
      writeRecord(storage, key, {
        operation: input.operation,
        scope: input.scope,
        idempotencyKey,
        fingerprint,
        state: "pending",
        createdAt,
        updatedAt: now(),
      });

      try {
        const value = await input.mutate(idempotencyKey);
        writeRecord(storage, key, {
          operation: input.operation,
          scope: input.scope,
          idempotencyKey,
          fingerprint,
          state: "applied",
          createdAt,
          updatedAt: now(),
        });
        return { state: "success", value, idempotencyKey, reconciled: false };
      } catch (cause) {
        const conflict = isIdempotencyConflict(cause);
        if (!conflict && !isUncertainFailure(cause)) {
          storage.removeItem(key);
          throw cause;
        }

        writeRecord(storage, key, {
          operation: input.operation,
          scope: input.scope,
          idempotencyKey,
          fingerprint,
          state: "uncertain",
          createdAt,
          updatedAt: now(),
        });
        const outcome = await safeReconcile(input.reconcile, { idempotencyKey, fingerprint });
        const result = reconciledResult(outcome, idempotencyKey, conflict);
        if (result?.state === "success") writeRecord(storage, key, {
          operation: input.operation,
          scope: input.scope,
          idempotencyKey,
          fingerprint,
          state: "applied",
          createdAt,
          updatedAt: now(),
        });
        if (result?.state === "conflict") storage.removeItem(key);
        if (result) return result;
        return {
          state: "uncertain",
          idempotencyKey,
          message: "We could not confirm whether this step was saved. Retry safely or refresh the saved state.",
        };
      }
    };

    return locks
      ? locks.request(`nelyon-ads-v2:${input.operation}:${input.scope}`, executeLocked)
      : executeLocked();
  }

  function run<T>(input: AdsMutationRunInput<T>): Promise<AdsMutationResult<T>> {
    const identity = `${input.operation}:${input.scope}`;
    const payload = serializedPayload(input.payload);
    const active = inFlight.get(identity);
    if (active) {
      if (active.payload !== payload) return Promise.reject(new AdsMutationPayloadChangedError());
      return active.promise as Promise<AdsMutationResult<T>>;
    }

    const promise = fingerprintAdsMutationPayload(input.payload)
      .then((fingerprint) => execute(input, fingerprint))
      .finally(() => { inFlight.delete(identity); });
    inFlight.set(identity, { payload, promise: promise as Promise<AdsMutationResult<unknown>> });
    return promise;
  }

  return { run };
}

export const adsMutationCoordinator = createAdsMutationCoordinator();
