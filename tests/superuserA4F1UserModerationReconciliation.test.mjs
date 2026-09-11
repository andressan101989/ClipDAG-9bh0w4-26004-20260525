import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileUserModeration,
  requestedStateIsSatisfied,
} from "../supabase/functions/admin-user-moderation/reconciliation.mjs";

const NOW = Date.parse("2026-09-11T18:30:00.000Z");
const FUTURE = "2126-09-11T18:30:00.000Z";
const OTHER_FUTURE = "2125-09-11T18:30:00.000Z";

const command = (action, before, status = "pending") => ({
  id: "11111111-1111-4111-8111-111111111111",
  target_user_id: "22222222-2222-4222-8222-222222222222",
  action,
  status,
  auth_banned_until_before: before,
  auth_banned_until_after: status === "succeeded" ? (action === "suspend" ? FUTURE : null) : null,
  provider_error_code: status === "failed" ? "provider_failure" : null,
});

function harness({ reads = [], updateResult, updateError, finalizeError } = {}) {
  const calls = { read: 0, update: 0, finalize: 0, finalizations: [] };
  return {
    calls,
    readAuthState: async () => {
      const value = reads[calls.read++];
      if (value instanceof Error) throw value;
      return value;
    },
    updateAuthState: async () => {
      calls.update += 1;
      if (updateError) throw updateError;
      return updateResult;
    },
    finalize: async (input) => {
      calls.finalize += 1;
      calls.finalizations.push(input);
      if (finalizeError) throw finalizeError;
      return { id: command("suspend", null).id, status: input.result };
    },
  };
}

test("normal suspend mutates once, verifies the returned desired state, and succeeds", async () => {
  const deps = harness({ reads: [null], updateResult: FUTURE });
  const result = await reconcileUserModeration({ prepared: command("suspend", null), action: "suspend", nowMs: NOW, ...deps });
  assert.equal(result.kind, "succeeded");
  assert.deepEqual(deps.calls, {
    read: 1,
    update: 1,
    finalize: 1,
    finalizations: [{ result: "succeeded", bannedUntilAfter: FUTURE, providerErrorCode: null }],
  });
});

test("normal restore mutates once and succeeds when Auth returns an unbanned user", async () => {
  const deps = harness({ reads: [FUTURE], updateResult: null });
  const result = await reconcileUserModeration({ prepared: command("restore", FUTURE), action: "restore", nowMs: NOW, ...deps });
  assert.equal(result.kind, "succeeded");
  assert.equal(deps.calls.update, 1);
  assert.deepEqual(deps.calls.finalizations[0], { result: "succeeded", bannedUntilAfter: null, providerErrorCode: null });
});

test("retry converges after Auth success and finalize outage without repeating the mutation", async () => {
  let updates = 0;
  const first = await reconcileUserModeration({
    prepared: command("suspend", null), action: "suspend", nowMs: NOW,
    readAuthState: async () => null,
    updateAuthState: async () => { updates += 1; return FUTURE; },
    finalize: async () => { throw new Error("database unavailable"); },
  });
  assert.deepEqual(first, { kind: "retryable", error: "finalize_unavailable" });

  const second = await reconcileUserModeration({
    prepared: command("suspend", null), action: "suspend", nowMs: NOW,
    readAuthState: async () => FUTURE,
    updateAuthState: async () => { updates += 1; return FUTURE; },
    finalize: async ({ result }) => ({ id: command("suspend", null).id, status: result }),
  });
  assert.equal(second.kind, "succeeded");
  assert.equal(updates, 1);
});

test("an ambiguous update error reconciles to success when the provider applied the mutation", async () => {
  const deps = harness({ reads: [null, FUTURE], updateError: { code: "gateway_timeout" } });
  const result = await reconcileUserModeration({ prepared: command("suspend", null), action: "suspend", nowMs: NOW, ...deps });
  assert.equal(result.kind, "succeeded");
  assert.equal(deps.calls.read, 2);
  assert.deepEqual(deps.calls.finalizations[0], { result: "succeeded", bannedUntilAfter: FUTURE, providerErrorCode: null });
});

test("an update error with unchanged authoritative state finalizes failed with a sanitized provider code", async () => {
  const deps = harness({ reads: [null, null], updateError: { code: "Provider Error With Spaces!" } });
  const result = await reconcileUserModeration({ prepared: command("suspend", null), action: "suspend", nowMs: NOW, ...deps });
  assert.equal(result.kind, "failed");
  assert.equal(result.providerErrorCode, "provider_error_with_spaces_");
  assert.deepEqual(deps.calls.finalizations[0], { result: "failed", bannedUntilAfter: null, providerErrorCode: "provider_error_with_spaces_" });
});

test("an update error followed by an unavailable reread remains pending and retryable", async () => {
  const deps = harness({ reads: [null, new Error("reread unavailable")], updateError: { code: "timeout" } });
  const result = await reconcileUserModeration({ prepared: command("suspend", null), action: "suspend", nowMs: NOW, ...deps });
  assert.deepEqual(result, { kind: "retryable", error: "auth_state_unavailable" });
  assert.equal(deps.calls.finalize, 0);
});

test("an unavailable initial Auth read leaves the command pending without update or finalize", async () => {
  const deps = harness({ reads: [new Error("provider unavailable")], updateResult: FUTURE });
  const result = await reconcileUserModeration({ prepared: command("suspend", null), action: "suspend", nowMs: NOW, ...deps });
  assert.deepEqual(result, { kind: "retryable", error: "auth_state_unavailable" });
  assert.equal(deps.calls.update, 0);
  assert.equal(deps.calls.finalize, 0);
});

test("a concurrent incompatible provider state finalizes auth_state_changed", async () => {
  const deps = harness({ reads: [OTHER_FUTURE], updateResult: null });
  const result = await reconcileUserModeration({ prepared: command("restore", FUTURE), action: "restore", nowMs: NOW, ...deps });
  assert.equal(result.kind, "failed");
  assert.equal(result.providerErrorCode, "auth_state_changed");
  assert.equal(deps.calls.update, 0);
  assert.deepEqual(deps.calls.finalizations[0], { result: "failed", bannedUntilAfter: OTHER_FUTURE, providerErrorCode: "auth_state_changed" });
});

test("an already-suspended retry finalizes without a second Auth update", async () => {
  const deps = harness({ reads: [FUTURE], updateResult: FUTURE });
  const result = await reconcileUserModeration({ prepared: command("suspend", null), action: "suspend", nowMs: NOW, ...deps });
  assert.equal(result.kind, "succeeded");
  assert.equal(deps.calls.update, 0);
});

test("an already-restored retry finalizes without a second Auth update", async () => {
  const deps = harness({ reads: [null], updateResult: null });
  const result = await reconcileUserModeration({ prepared: command("restore", FUTURE), action: "restore", nowMs: NOW, ...deps });
  assert.equal(result.kind, "succeeded");
  assert.equal(deps.calls.update, 0);
});

test("a terminal succeeded retry returns its existing receipt without provider calls", async () => {
  const deps = harness({ reads: [null], updateResult: FUTURE });
  const prepared = command("suspend", null, "succeeded");
  const result = await reconcileUserModeration({ prepared, action: "suspend", nowMs: NOW, ...deps });
  assert.deepEqual(result, { kind: "succeeded", receipt: prepared });
  assert.deepEqual({ read: deps.calls.read, update: deps.calls.update, finalize: deps.calls.finalize }, { read: 0, update: 0, finalize: 0 });
});

test("a terminal failed retry returns failure without provider calls", async () => {
  const deps = harness({ reads: [null], updateResult: FUTURE });
  const prepared = command("suspend", null, "failed");
  const result = await reconcileUserModeration({ prepared, action: "suspend", nowMs: NOW, ...deps });
  assert.equal(result.kind, "failed");
  assert.equal(result.error, "command_failed");
  assert.deepEqual({ read: deps.calls.read, update: deps.calls.update, finalize: deps.calls.finalize }, { read: 0, update: 0, finalize: 0 });
});

test("desired-state predicates are provider-state-aware and time-safe", () => {
  assert.equal(requestedStateIsSatisfied("suspend", FUTURE, NOW), true);
  assert.equal(requestedStateIsSatisfied("suspend", null, NOW), false);
  assert.equal(requestedStateIsSatisfied("restore", null, NOW), true);
  assert.equal(requestedStateIsSatisfied("restore", "2026-09-11T18:29:59.000Z", NOW), true);
  assert.equal(requestedStateIsSatisfied("restore", FUTURE, NOW), false);
  assert.equal(requestedStateIsSatisfied("restore", "invalid", NOW), false);
});
