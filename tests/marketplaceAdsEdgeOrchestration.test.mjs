import assert from "node:assert/strict";
import test from "node:test";
import { materializeSponsoredCandidates } from "../supabase/functions/marketplace-ads/orchestration.ts";

test("sponsored delivery fails closed when candidate materialization fails", async () => {
  const delivered = [];
  await assert.rejects(
    materializeSponsoredCandidates(
      [{ campaign_id: "campaign-a" }],
      async () => ({ data: null, error: new Error("materialization_failed") }),
    ),
    /materialization_failed/,
  );
  assert.deepEqual(delivered, []);
});

test("all selected candidates must materialize successfully", async () => {
  const seen = [];
  await materializeSponsoredCandidates(
    [{ campaign_id: "a" }, { campaign_id: "b" }],
    async (id) => { seen.push(id); return { data: { id }, error: null }; },
  );
  assert.deepEqual(seen, ["a", "b"]);
});
