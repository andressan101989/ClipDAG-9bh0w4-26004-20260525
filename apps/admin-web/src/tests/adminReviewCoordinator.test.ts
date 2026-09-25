import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAdminReviewCoordinator, type AdminReviewStorage } from "../lib/adminReviewCoordinator";

class MemoryStorage implements AdminReviewStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const intent = { adId: "11111111-1111-4111-8111-111111111111", submissionFingerprint: "submitted-fingerprint", action: "reject" as const, reasonCode: "copy_invalid", note: "Internal moderation detail XYZ" };

describe("Admin review mutation coordination", () => {
  it("coalesces a double click into one mutation and one key", async () => {
    let release!: () => void;
    const mutate = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const coordinator = createAdminReviewCoordinator({ storage: new MemoryStorage(), uuid: () => "22222222-2222-4222-8222-222222222222" });
    const input = { intent, mutate, reconcile: vi.fn().mockResolvedValue({ status: "not_applied" as const }) };
    const first = coordinator.run(input);
    const second = coordinator.run(input);
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ state: "success" }), expect.objectContaining({ state: "success" })]);
  });

  it("retains the same key across an uncertain response and safe retry", async () => {
    const storage = new MemoryStorage();
    const mutate = vi.fn().mockRejectedValueOnce(new TypeError("network reset")).mockResolvedValueOnce(undefined);
    const reconcile = vi.fn().mockResolvedValueOnce({ status: "unknown" }).mockResolvedValueOnce({ status: "not_applied" });
    const coordinator = createAdminReviewCoordinator({ storage, uuid: () => "33333333-3333-4333-8333-333333333333" });
    await expect(coordinator.run({ intent, mutate, reconcile })).resolves.toMatchObject({ state: "uncertain" });
    await expect(coordinator.run({ intent, mutate, reconcile })).resolves.toMatchObject({ state: "success" });
    expect(mutate).toHaveBeenNthCalledWith(1, "33333333-3333-4333-8333-333333333333");
    expect(mutate).toHaveBeenNthCalledWith(2, "33333333-3333-4333-8333-333333333333");
  });

  it("reconciles an idempotency conflict that matches the intended decision", async () => {
    const mutate = vi.fn().mockRejectedValue(new Error("advertising_ad_review_idempotency_conflict"));
    const coordinator = createAdminReviewCoordinator({ storage: new MemoryStorage(), uuid: () => "44444444-4444-4444-8444-444444444444" });
    await expect(coordinator.run({ intent, mutate, reconcile: vi.fn().mockResolvedValue({ status: "applied_as_intended" }) })).resolves.toMatchObject({ state: "success", reconciled: true });
  });

  it("blocks a changed unresolved decision and never stores the internal note plaintext", async () => {
    const storage = new MemoryStorage();
    const coordinator = createAdminReviewCoordinator({ storage, uuid: () => "55555555-5555-4555-8555-555555555555" });
    await coordinator.run({ intent, mutate: vi.fn().mockRejectedValue(new TypeError("timeout")), reconcile: vi.fn().mockResolvedValue({ status: "unknown" }) });
    expect([...storage.values.values()].join("\n")).not.toContain(intent.note);
    await expect(coordinator.run({ intent: { ...intent, action: "approve", reasonCode: null, note: null }, mutate: vi.fn(), reconcile: vi.fn() })).rejects.toThrow(/unresolved review/i);
  });
});
