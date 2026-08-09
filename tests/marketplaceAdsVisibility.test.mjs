import assert from "node:assert/strict";
import test from "node:test";
import { marketplaceAdVisibilityDecision } from "../services/marketplaceAdVisibility.ts";

test("sponsored impression visibility is thresholded, timed, cancellable and once-only", () => {
  assert.equal(marketplaceAdVisibilityDecision({visibleRatio:.49,visibleSince:null,now:0,sent:false}),"wait");
  assert.equal(marketplaceAdVisibilityDecision({visibleRatio:.5,visibleSince:null,now:0,sent:false}),"start_timer");
  assert.equal(marketplaceAdVisibilityDecision({visibleRatio:.5,visibleSince:0,now:499,sent:false}),"wait");
  assert.equal(marketplaceAdVisibilityDecision({visibleRatio:.5,visibleSince:0,now:500,sent:false}),"record");
  assert.equal(marketplaceAdVisibilityDecision({visibleRatio:.1,visibleSince:100,now:200,sent:false}),"cancel_timer");
  assert.equal(marketplaceAdVisibilityDecision({visibleRatio:1,visibleSince:0,now:1000,sent:true}),"already_sent");
});
