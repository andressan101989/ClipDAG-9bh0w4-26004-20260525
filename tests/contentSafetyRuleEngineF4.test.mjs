import test from "node:test";
import assert from "node:assert/strict";
import {evaluateTextRules,matchTextRule,normalizeContentSafetyText} from "../supabase/functions/content-safety-scan/ruleEngine.mjs";

const rule=(overrides={})=>({id:"10000000-0000-4000-8000-000000000001",code:"policy_rule",detector_type:"keyword",pattern:"alerta",scopes:["video_caption"],...overrides});

test("keyword matches a normalized whole word but never a substring",()=>{
  assert.ok(matchTextRule({text:"Una ALERTA aquí",scope:"video_caption"},rule()));
  assert.equal(matchTextRule({text:"prealertasufijo",scope:"video_caption"},rule()),null);
});

test("Unicode NFKC and whitespace normalization are deterministic",()=>{
  assert.equal(normalizeContentSafetyText("  ＡＬＥＲＴＡ\n  seria  "),"alerta seria");
});

test("phrase matching is boundary-aware and whitespace canonical",()=>{
  assert.ok(matchTextRule({text:"inicio frase   aprobada final",scope:"story_text"},rule({detector_type:"phrase",pattern:"frase aprobada",scopes:["story_text"]})));
  assert.equal(matchTextRule({text:"inici frase aprobadafinal",scope:"story_text"},rule({detector_type:"phrase",pattern:"frase aprobada",scopes:["story_text"]})),null);
});

test("wrong scope and malformed or unsupported rules never match",()=>{
  assert.equal(matchTextRule({text:"alerta",scope:"comment"},rule()),null);
  assert.equal(matchTextRule({text:"alerta",scope:"video_caption"},rule({detector_type:"regex"})),null);
  assert.equal(matchTextRule({text:"dos palabras",scope:"video_caption"},rule({pattern:"dos palabras"})),null);
});

test("evaluation emits compact evidence once per matching rule",()=>{
  const matches=evaluateTextRules({text:`${"contexto ".repeat(40)}alerta final`,scope:"video_caption"},[rule(),rule({id:"20000000-0000-4000-8000-000000000002",code:"other",pattern:"missing"})]);
  assert.equal(matches.length,1);
  assert.ok(matches[0].excerpt.length<=240);
  assert.deepEqual(matches[0].matched_terms,["alerta"]);
});
