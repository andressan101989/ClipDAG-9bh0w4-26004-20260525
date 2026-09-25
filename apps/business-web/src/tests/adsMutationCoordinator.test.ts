import { describe, expect, it, vi } from "vitest";
import {
  ADS_MUTATION_TTL_MS,
  AdsMutationPayloadChangedError,
  ResilientAdsMutationStorage,
  areAdsMutationPayloadsEquivalent,
  createAdsMutationCoordinator,
  fingerprintAdsMutationPayload,
  type AdsMutationLockManager,
  type AdsMutationStorage,
} from "../lib/adsMutationCoordinator";

class MemoryStorage implements AdsMutationStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class SerialLocks implements AdsMutationLockManager {
  private tails = new Map<string, Promise<void>>();
  async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(name, prior.then(() => current));
    await prior;
    try { return await callback(); }
    finally { release(); if (this.tails.get(name) === current) this.tails.delete(name); }
  }
}

const applied = <T>(value: T) => ({ status: "applied_as_intended" as const, value });
const notApplied = () => ({ status: "not_applied" as const });
const different = () => ({ status: "applied_differently" as const });
const unknown = () => ({ status: "unknown" as const });

describe("Ads V2 mutation coordinator", () => {
  it("fingerprints normalized payloads with stable property ordering and omits undefined", async () => {
    await expect(fingerprintAdsMutationPayload({ b: 2, ignored: undefined, a: { y: 2, x: 1 } }))
      .resolves.toBe(await fingerprintAdsMutationPayload({ a: { x: 1, y: 2 }, b: 2 }));
  });

  it("compares nested audience definitions semantically instead of by object member order", () => {
    expect(areAdsMutationPayloadsEquivalent(
      { dayparts: [{ weekday: 1, start_time: "09:00", end_time: "10:00" }], frequency: { max_impressions: 1, window_hours: 24 } },
      { frequency: { window_hours: 24, max_impressions: 1 }, dayparts: [{ end_time: "10:00", start_time: "09:00", weekday: 1 }] },
    )).toBe(true);
  });

  it("coalesces two rapid submissions into one mutation with one stable key", async () => {
    const storage = new MemoryStorage();
    const coordinator = createAdsMutationCoordinator({ storage, uuid: () => "key-1" });
    let release!: (value: string) => void;
    const response = new Promise<string>((resolve) => { release = resolve; });
    const mutate = vi.fn(() => response);
    const input = { operation: "audience:create", scope: "set-1", payload: { age_scope: "adults_only" }, mutate, reconcile: vi.fn().mockResolvedValue(notApplied()) };

    const first = coordinator.run(input);
    const second = coordinator.run(input);
    release("audience-1");

    await expect(first).resolves.toMatchObject({ state: "success", value: "audience-1", idempotencyKey: "key-1" });
    await expect(second).resolves.toMatchObject({ state: "success", idempotencyKey: "key-1" });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith("key-1");
  });

  it.each([
    ["create", "audience:create", "set-1"],
    ["version", "audience:version", "audience-1"],
    ["review", "review:submit", "ad-1"],
    ["finance", "finance:create", "campaign-1"],
    ["lifecycle", "lifecycle:cancel", "campaign-1"],
  ])("uses one network call for rapid %s submissions", async (_family, operation, scope) => {
    const coordinator = createAdsMutationCoordinator({ storage: new MemoryStorage(), uuid: () => `${operation}-key` });
    let release!: (value: string) => void;
    const delayed = new Promise<string>((resolve) => { release = resolve; });
    const mutate = vi.fn(() => delayed);
    const input = { operation, scope, payload: { value: 1 }, mutate, reconcile: vi.fn().mockResolvedValue(notApplied()) };

    const first = coordinator.run(input);
    const second = coordinator.run(input);
    release("saved");

    await Promise.all([first, second]);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(`${operation}-key`);
  });

  it("keeps the same key after an uncertain request and an unchanged retry", async () => {
    const coordinator = createAdsMutationCoordinator({ storage: new MemoryStorage(), uuid: () => "key-uncertain" });
    const firstMutate = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const reconcile = vi.fn().mockResolvedValue(notApplied());
    const input = { operation: "finance:create", scope: "campaign-1", payload: { budget: 1 }, mutate: firstMutate, reconcile };

    await expect(coordinator.run(input)).resolves.toMatchObject({ state: "uncertain", idempotencyKey: "key-uncertain" });
    const retryMutate = vi.fn().mockResolvedValue("finance-1");
    await expect(coordinator.run({ ...input, mutate: retryMutate })).resolves.toMatchObject({ state: "success", idempotencyKey: "key-uncertain" });
    expect(retryMutate).toHaveBeenCalledWith("key-uncertain");
  });

  it("turns a lost response into success when canonical reconciliation finds the intended state", async () => {
    const coordinator = createAdsMutationCoordinator({ storage: new MemoryStorage(), uuid: () => "key-applied" });
    const mutate = vi.fn().mockRejectedValue(new TypeError("network reset"));
    const reconcile = vi.fn().mockResolvedValue(applied("audience-1"));

    await expect(coordinator.run({ operation: "audience:create", scope: "set-1", payload: { value: 1 }, mutate, reconcile }))
      .resolves.toEqual(expect.objectContaining({ state: "success", value: "audience-1", reconciled: true }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("reconciles an idempotency conflict without exposing the raw error", async () => {
    const coordinator = createAdsMutationCoordinator({ storage: new MemoryStorage(), uuid: () => "key-conflict" });
    const mutate = vi.fn().mockRejectedValue(new Error("advertising_audience_idempotency_conflict"));
    await expect(coordinator.run({ operation: "audience:create", scope: "set-1", payload: { value: 1 }, mutate, reconcile: vi.fn().mockResolvedValue(applied("audience-1")) }))
      .resolves.toMatchObject({ state: "success", reconciled: true, message: "Already saved. We refreshed the saved version." });
  });

  it("returns a safe conflict and never retries when canonical state differs", async () => {
    const coordinator = createAdsMutationCoordinator({ storage: new MemoryStorage(), uuid: () => "key-conflict" });
    const mutate = vi.fn().mockRejectedValue(new Error("advertising_audience_idempotency_conflict"));
    await expect(coordinator.run({ operation: "audience:create", scope: "set-1", payload: { value: 1 }, mutate, reconcile: vi.fn().mockResolvedValue(different()) }))
      .resolves.toMatchObject({ state: "conflict", message: "This step was already saved with different values. Review the saved version before trying again." });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("discovers an unresolved operation after hard refresh and reuses its key", async () => {
    const storage = new MemoryStorage();
    const first = createAdsMutationCoordinator({ storage, uuid: () => "key-refresh" });
    await first.run({ operation: "ad:create", scope: "set-1", payload: { name: "Ad" }, mutate: vi.fn().mockRejectedValue(new TypeError("timeout")), reconcile: vi.fn().mockResolvedValue(unknown()) });

    const refreshed = createAdsMutationCoordinator({ storage, uuid: () => "must-not-run" });
    const mutate = vi.fn().mockResolvedValue("ad-1");
    await expect(refreshed.run({ operation: "ad:create", scope: "set-1", payload: { name: "Ad" }, mutate, reconcile: vi.fn().mockResolvedValue(notApplied()) }))
      .resolves.toMatchObject({ state: "success", idempotencyKey: "key-refresh" });
    expect(mutate).toHaveBeenCalledWith("key-refresh");
  });

  it("serializes tabs with Web Locks and reconciles instead of issuing a second request", async () => {
    const storage = new MemoryStorage();
    const locks = new SerialLocks();
    const first = createAdsMutationCoordinator({ storage, locks, uuid: () => "shared-key" });
    const second = createAdsMutationCoordinator({ storage, locks, uuid: () => "other-key" });
    let release!: (value: string) => void;
    const delayed = new Promise<string>((resolve) => { release = resolve; });
    const firstMutate = vi.fn(() => delayed);
    const secondMutate = vi.fn().mockResolvedValue("duplicate");
    const reconcile = vi.fn().mockResolvedValue(applied("audience-1"));
    const one = first.run({ operation: "audience:create", scope: "set-1", payload: { value: 1 }, mutate: firstMutate, reconcile });
    await vi.waitFor(() => expect(firstMutate).toHaveBeenCalledTimes(1));
    const two = second.run({ operation: "audience:create", scope: "set-1", payload: { value: 1 }, mutate: secondMutate, reconcile });
    release("audience-1");

    await expect(one).resolves.toMatchObject({ state: "success", idempotencyKey: "shared-key" });
    await expect(two).resolves.toMatchObject({ state: "success", idempotencyKey: "shared-key", reconciled: true });
    expect(secondMutate).not.toHaveBeenCalled();
  });

  it("falls back without Web Locks by discovering the same non-sensitive operation record and key", async () => {
    const storage = new MemoryStorage();
    const first = createAdsMutationCoordinator({ storage, locks: null, uuid: () => "fallback-key" });
    await first.run({ operation: "finance:create", scope: "campaign-1", payload: { budget: 0.01, secret: undefined }, mutate: vi.fn().mockRejectedValue(new TypeError("timeout")), reconcile: vi.fn().mockResolvedValue(unknown()) });

    const retry = vi.fn().mockResolvedValue("finance-1");
    await createAdsMutationCoordinator({ storage, locks: null, uuid: () => "must-not-run" }).run({ operation: "finance:create", scope: "campaign-1", payload: { budget: 0.01 }, mutate: retry, reconcile: vi.fn().mockResolvedValue(notApplied()) });

    expect(retry).toHaveBeenCalledWith("fallback-key");
    const serialized = [...storage.values.values()].join("\n");
    expect(serialized).not.toContain("0.01");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("payload");
  });

  it("reconciles stale metadata before allowing a retry", async () => {
    const storage = new MemoryStorage();
    let time = 1_000;
    const first = createAdsMutationCoordinator({ storage, now: () => time, uuid: () => "stale-key" });
    await first.run({ operation: "review:submit", scope: "ad-1", payload: {}, mutate: vi.fn().mockRejectedValue(new TypeError("timeout")), reconcile: vi.fn().mockResolvedValue(unknown()) });
    time += ADS_MUTATION_TTL_MS + 1;
    const reconcile = vi.fn().mockResolvedValue(notApplied());
    const mutate = vi.fn().mockResolvedValue("submitted");
    await createAdsMutationCoordinator({ storage, now: () => time, uuid: () => "new-key" }).run({ operation: "review:submit", scope: "ad-1", payload: {}, mutate, reconcile });
    expect(reconcile).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith("stale-key");
  });

  it("blocks a changed payload until the unresolved operation is reconciled", async () => {
    const storage = new MemoryStorage();
    const coordinator = createAdsMutationCoordinator({ storage, uuid: () => "first-key" });
    await coordinator.run({ operation: "destination:create", scope: "campaign-1", payload: { url: "https://a.test" }, mutate: vi.fn().mockRejectedValue(new TypeError("timeout")), reconcile: vi.fn().mockResolvedValue(unknown()) });
    const changedMutation = vi.fn();
    await expect(coordinator.run({ operation: "destination:create", scope: "campaign-1", payload: { url: "https://b.test" }, mutate: changedMutation, reconcile: vi.fn().mockResolvedValue(unknown()) }))
      .rejects.toBeInstanceOf(AdsMutationPayloadChangedError);
    expect(changedMutation).not.toHaveBeenCalled();
  });

  it("does not use the changed payload reconciliation callback to discard an unresolved attempt", async () => {
    const storage = new MemoryStorage();
    const coordinator = createAdsMutationCoordinator({ storage, uuid: () => "first-key" });
    const originalMutation = vi.fn().mockRejectedValue(new TypeError("response lost"));
    await coordinator.run({ operation: "business:create", scope: "owner-1", payload: { name: "A" }, mutate: originalMutation, reconcile: vi.fn().mockResolvedValue(unknown()) });

    const changedMutation = vi.fn();
    const changedReconcile = vi.fn().mockResolvedValue(notApplied());
    await expect(coordinator.run({ operation: "business:create", scope: "owner-1", payload: { name: "B" }, mutate: changedMutation, reconcile: changedReconcile }))
      .rejects.toBeInstanceOf(AdsMutationPayloadChangedError);

    expect(originalMutation).toHaveBeenCalledTimes(1);
    expect(changedMutation).not.toHaveBeenCalled();
    expect(changedReconcile).not.toHaveBeenCalled();
  });

  it("falls back to memory when an exposed localStorage throws during operations", () => {
    const memory = new MemoryStorage();
    const throwing = {
      getItem: vi.fn(() => { throw new Error("denied"); }),
      setItem: vi.fn(() => { throw new Error("quota"); }),
      removeItem: vi.fn(() => { throw new Error("denied"); }),
    } as unknown as Storage;
    const storage = new ResilientAdsMutationStorage(throwing, memory);

    expect(() => storage.setItem("operation", "safe-metadata")).not.toThrow();
    expect(storage.getItem("operation")).toBe("safe-metadata");
    expect(() => storage.removeItem("operation")).not.toThrow();
    expect(storage.getItem("operation")).toBeNull();
  });

  it("retains the stable key when localStorage reads work but writes are rejected", () => {
    const memory = new MemoryStorage();
    const primaryValues = new Map<string, string>();
    const writeRejected = {
      getItem: vi.fn((key: string) => primaryValues.get(key) ?? null),
      setItem: vi.fn(() => { throw new Error("quota"); }),
      removeItem: vi.fn((key: string) => { primaryValues.delete(key); }),
    } as unknown as Storage;
    const storage = new ResilientAdsMutationStorage(writeRejected, memory);

    storage.setItem("operation", JSON.stringify({ idempotencyKey: "stable-key" }));
    expect(storage.getItem("operation")).toContain("stable-key");
    expect(writeRejected.getItem).not.toHaveBeenCalled();
  });

  it("creates a new key for a later logical operation after a known applied state no longer matches", async () => {
    const storage = new MemoryStorage();
    const keys = ["first-pause-key", "second-pause-key"];
    const coordinator = createAdsMutationCoordinator({ storage, uuid: () => keys.shift()! });
    const input = { operation: "lifecycle:pause", scope: "campaign-1", payload: { action: "pause" } };
    await coordinator.run({ ...input, mutate: vi.fn().mockResolvedValue("paused-once"), reconcile: vi.fn().mockResolvedValue(notApplied()) });

    const mutate = vi.fn().mockResolvedValue("paused-again");
    await expect(coordinator.run({ ...input, mutate, reconcile: vi.fn().mockResolvedValue(notApplied()) }))
      .resolves.toMatchObject({ state: "success", idempotencyKey: "second-pause-key" });
    expect(mutate).toHaveBeenCalledWith("second-pause-key");
  });
});
