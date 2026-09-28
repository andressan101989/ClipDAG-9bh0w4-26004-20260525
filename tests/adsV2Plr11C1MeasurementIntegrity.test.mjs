import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const migrationNames = readdirSync(new URL("supabase/migrations/", root))
  .filter((name) => name.endsWith("_ads_v2_plr_11_c1_measurement_integrity.sql"));
const migration = migrationNames.length === 1
  ? readFileSync(new URL(`supabase/migrations/${migrationNames[0]}`, root), "utf8")
  : "";
const chatService = readFileSync(new URL("services/chatService.ts", root), "utf8");
const messagesContext = readFileSync(new URL("contexts/MessagesContext.tsx", root), "utf8");
const chatScreen = readFileSync(new URL("app/chat/[userId].tsx", root), "utf8");
const businessPage = readFileSync(new URL("apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx", root), "utf8");

function loadChatService() {
  const module = { exports: {} };
  const output = ts.transpileModule(chatService, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  } }).outputText;
  Function("require", "module", "exports", output)(
    (name) => {
      if (name === "expo-crypto") return { randomUUID: () => "client-key" };
      if (name === "@/template") return { getSupabaseClient: () => ({}) };
      throw new Error(`unexpected import ${name}`);
    },
    module,
    module.exports,
  );
  return module.exports;
}

test("C1 is one forward migration with structural video-view uniqueness and preserved ACL", () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migration, /^(?:--[^\n]*\n|\s)*begin;/i);
  assert.match(migration, /advertising_events_video_view_parent_uidx/i);
  assert.match(migration, /unique[\s\S]*parent_impression_event_id[\s\S]*event_type\s*=\s*'video_view'/i);
  assert.match(migration, /having\s+count\(\*\)\s*>\s*1/i);
  assert.match(migration, /advertising_video_view_creative_invalid/i);
  assert.match(migration, /advertising_creative_versions[\s\S]{0,240}v_creative_format/i);
  assert.match(migration, /v_creative_format is distinct from 'video'/i);
  assert.match(migration, /grant execute on function public\.record_advertising_interaction_v2\(uuid,text,uuid,uuid\)\s+to service_role/i);
  assert.match(migration, /grant execute on function public\.record_advertising_message_start_conversion_v2\(uuid,uuid\)\s+to authenticated/i);
  assert.match(migration, /commit;\s*$/i);
});

test("message conversion is message-plus-impression authoritative and destination-open independent", () => {
  assert.match(migration, /message_type\s+in\s*\('text','image','video','one_time_image','voice'\)/i);
  assert.match(migration, /sender_id\s*=\s*v_actor/i);
  assert.match(migration, /recipient_id\s*=\s*v_destination\.target_user_id/i);
  assert.match(migration, /created_at\s*>=\s*v_touch_at/i);
  assert.match(migration, /advertising_message_conversion_message_not_first_outbound/i);
  assert.doesNotMatch(migration, /advertising_message_conversion_destination_open_required/i);
  assert.doesNotMatch(migration, /v_destination_open/i);
  assert.doesNotMatch(migration, /message[^\n]*(?:text|content)[^\n]*advertising_(?:conversions|attributions)/i);
});

test("all canonical outbound Chat types feed one shared Ads conversion helper and Premium DM does not", () => {
  assert.match(messagesContext, /sendMediaMessage:[\s\S]{0,180}Promise<Message>/);
  assert.match(messagesContext, /sendVoiceMessage:[\s\S]{0,220}Promise<Message\s*\|\s*null>/);
  assert.match(messagesContext, /return transmitMessage\(recipientId, optimistic\)/);
  assert.match(chatScreen, /recordAdvertisingMessageStartForConfirmedMessage/);
  const sharedCalls = chatScreen.match(/recordAdvertisingMessageStartForConfirmedMessage\(/g) ?? [];
  assert.ok(sharedCalls.length >= 4, "text, media and voice share one helper");
  assert.match(chatScreen, /mediaType: 'video'[\s\S]{0,300}recordAdvertisingMessageStartForConfirmedMessage/);
  assert.match(chatScreen, /mediaType: oneTime \? 'one_time_image' : 'image'[\s\S]{0,300}recordAdvertisingMessageStartForConfirmedMessage/);
  assert.match(chatScreen, /handleSendVoice[\s\S]{0,500}recordAdvertisingMessageStartForConfirmedMessage/);
  assert.match(chatScreen, /retryMessage[\s\S]{0,180}then\(recordAdvertisingMessageStartForConfirmedMessage\)/);
  const premiumBlock = chatScreen.slice(
    chatScreen.indexOf("const handleSendPremiumDM"),
    chatScreen.indexOf("const handleReleasePremiumPayment"),
  );
  assert.doesNotMatch(premiumBlock, /recordAdvertisingMessageStartForConfirmedMessage/);
});

test("bounded message conversion retry preserves the first canonical evidence pair", async () => {
  const { AdvertisingMessageStartRetryController } = loadChatService();
  assert.equal(typeof AdvertisingMessageStartRetryController, "function");
  const calls = [];
  let failures = 1;
  const controller = new AdvertisingMessageStartRetryController(
    async (messageId, impressionId) => {
      calls.push({ messageId, impressionId });
      if (failures-- > 0) throw new Error("temporary_analytics_failure");
      return "conversion-one";
    },
    { retryDelaysMs: [0, 0], wait: async () => undefined },
  );
  const first = controller.submit("message-one", "impression-one");
  const laterMessage = controller.submit("message-two", "impression-one");
  assert.equal(first, laterMessage, "later Chat messages cannot replace first evidence");
  assert.equal(await first, true);
  assert.deepEqual(calls, [
    { messageId: "message-one", impressionId: "impression-one" },
    { messageId: "message-one", impressionId: "impression-one" },
  ]);
  assert.deepEqual(controller.snapshot(), {
    messageId: "message-one", impressionEventId: "impression-one", attempts: 2, confirmed: true,
  });
});

test("bounded retry terminates and reset permits a new Ads opportunity", async () => {
  const { AdvertisingMessageStartRetryController } = loadChatService();
  let calls = 0;
  const controller = new AdvertisingMessageStartRetryController(
    async () => { calls += 1; throw new Error("offline"); },
    { retryDelaysMs: [0, 0, 0], wait: async () => undefined },
  );
  assert.equal(await controller.submit("message-one", "impression-one"), false);
  assert.equal(calls, 3);
  controller.reset();
  assert.equal(await controller.submit("message-two", "impression-two"), false);
  assert.equal(calls, 6);
});

test("Business describes message starts without claiming a new conversation", () => {
  assert.match(businessPage, /Message starts from the first outbound message after the ad/i);
  assert.doesNotMatch(businessPage, /conversations started after the first outbound message/i);
});
