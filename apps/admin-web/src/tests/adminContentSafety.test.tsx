import {fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {approveAdminContentSafetyRule,createAdminContentSafetyRule,getAdminContentSafetyAlert,getAdminContentSafetyAudioDetail,previewAdminContentSafetyRule,searchAdminContentSafetyAlerts,searchAdminContentSafetyAudio,searchAdminContentSafetyRules,setAdminContentSafetyRuleEnabled,updateAdminContentSafetyRule} from "../lib/adminSafetyApi";
import {AdminContentSafetyAudioDetailPage,AdminContentSafetyAudioPage,AdminContentSafetyDetailPage,AdminContentSafetyPage,AdminContentSafetyRulesPage} from "../pages/AdminContentSafetyPages";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminSafetyApi",()=>({
  getAdminContentSafetyAlert:vi.fn(),searchAdminContentSafetyAlerts:vi.fn(),searchAdminContentSafetyRules:vi.fn(),
  createAdminContentSafetyRule:vi.fn(),updateAdminContentSafetyRule:vi.fn(),previewAdminContentSafetyRule:vi.fn(),previewAdminContentSafetyRuleDraft:vi.fn(),approveAdminContentSafetyRule:vi.fn(),setAdminContentSafetyRuleEnabled:vi.fn(),retireAdminContentSafetyRule:vi.fn(),reviewAdminContentSafetyAlert:vi.fn(),retryAdminContentSafetyScan:vi.fn(),
  searchAdminContentSafetyAudio:vi.fn(),getAdminContentSafetyAudioDetail:vi.fn(),retryAdminContentSafetyAudio:vi.fn(),
}));

const alertId="10000000-0000-4000-8000-000000000001",targetId="20000000-0000-4000-8000-000000000002",ownerId="30000000-0000-4000-8000-000000000003",scanId="40000000-0000-4000-8000-000000000004";
const ruleId="50000000-0000-4000-8000-000000000005";
const item={id:alertId,target_type:"video",target_id:targetId,owner_user_id:ownerId,author:{id:ownerId,username:"creator",display_name:"Creator",avatar_url:null},source_type:"text_rule",category:"threat",severity:"high",priority_score:78,priority_bucket:"high",status:"open",rule_code:"policy_rule",rule_label:"Policy rule",evidence_excerpt:"extracto acotado",reach:12000,related_report_count:4,pending_report_count:4,reports_last_15m:3,active_warning_count:1,coverage:{text:"analyzed",audio:"not_configured",visual:"not_configured",reports:"analyzed"},scan_status:"completed",created_at:"2026-09-14T12:00:00Z"};
const governedRule=(version:number,overrides:Record<string,unknown>={})=>({id:ruleId,code:"policy_rule",label:"Policy rule",category:"threat",detector_type:"keyword",pattern:"policy",severity:"medium",scopes:["video_caption"],locale:"es",policy_source:"owner_manual",policy_reference:"owner-policy-2026-09",policy_version:null,rationale:"Decisión explícita",approval_state:"draft",approved_by:null,approved_at:null,updated_at:`2026-09-14T12:0${version}:00Z`,enabled:false,version,definition_fingerprint:`fingerprint-v${version}`,rescan:{state:"idle",eligible_count:0,queued_count:0},...overrides});
const governedPreview=(version:number,scopes=["video_caption"])=>({rule_id:ruleId,rule_version:version,definition_fingerprint:`fingerprint-v${version}`,detector_type:"keyword",normalized_pattern:"policy",locale:"es",scopes,total_matching_content:1,counts:{videos:1,stories:0,comments:0,live_chat:0,reported_messages:0},samples:[{target_type:"video",target_id:targetId,excerpt:"policy",scope:"video_caption",current_visibility:"visible"}],sample_limit:20,excerpt_limit:240});

beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(useAdminAuth).mockReturnValue({hasCapability:()=>true} as never);
  vi.mocked(searchAdminContentSafetyAlerts).mockResolvedValue({stats:{critical_count:0,high_count:1,medium_count:0,low_count:0,open_count:1,in_review_count:0},active_rule_count:0,items:[item],next_cursor:null});
  vi.mocked(searchAdminContentSafetyRules).mockResolvedValue({items:[]});
  vi.mocked(getAdminContentSafetyAlert).mockResolvedValue({...item,evidence:{matched_terms:["policy term"],matched_text_excerpt:"extracto acotado",detector_version:"text-rules-v1"},rule:{id:"50000000-0000-4000-8000-000000000005",code:"policy_rule",label:"Policy rule",version:1},scan:{id:scanId,status:"completed",requested_reason:"content_created",detector_version:"text-rules-v1",attempt_count:1,last_error_code:null,started_at:"2026-09-14T12:00:00Z",completed_at:"2026-09-14T12:00:01Z",coverage:item.coverage,media_source_scan_id:null},content:{path:`/content/video/${targetId}`,summary:"extracto acotado"},related_reports:[],policy_rules_not_configured:false});
  vi.mocked(searchAdminContentSafetyAudio).mockResolvedValue({provider:{configured:true,name:"Cloudflare Workers AI",model:"@cf/openai/whisper-large-v3-turbo",status:"healthy",last_success_at:"2026-09-15T12:00:00Z"},stats:{eligible:2,pending:0,analyzed:2,failed:0,not_applicable:2,not_configured:3,transcripts:1,provider_calls:1},items:[{scan_id:scanId,target_type:"story",target_id:targetId,summary:"Story compartida",audio_status:"analyzed",provider:"cloudflare_workers_ai",model:"@cf/openai/whisper-large-v3-turbo",duration_seconds:13.6,detected_language:"es",transcript_status:"completed",word_count:4,rule_matches:0,source_reused:true,processed_at:"2026-09-15T12:00:00Z"}]});
  vi.mocked(getAdminContentSafetyAudioDetail).mockResolvedValue({scan_id:scanId,target_type:"story",target_id:targetId,content:{path:`/stories/${targetId}`,summary:"Story compartida"},author:{id:ownerId,username:"creator",display_name:"Creator"},audio_status:"analyzed",provider:"cloudflare_workers_ai",model:"@cf/openai/whisper-large-v3-turbo",source_reused:true,source_scan_id:"60000000-0000-4000-8000-000000000006",source_target_id:"70000000-0000-4000-8000-000000000007",source_asset_id:"80000000-0000-4000-8000-000000000008",duration_seconds:13.6,attempts:1,cleanup_pending:false,transcript:{text:"texto real transcrito",word_count:3,detected_language:"es",segments:[{start:0,end:1.2,text:"texto real"}],fingerprint:"abc",rule_eval_status:"completed"},shared_references:[{id:targetId,path:`/stories/${targetId}`}]});
});

describe("ADMIN-SUPERUSER-OPT-F4 Content Safety",()=>{
  it("renders priority, signals, honest coverage and the no-policy state without raw JSON",async()=>{
    render(<MemoryRouter><AdminContentSafetyPage/></MemoryRouter>);
    expect(await screen.findByRole("heading",{name:"Content Safety"})).toBeInTheDocument();
    expect(screen.getByText("Motor textual listo · 0 reglas activas")).toBeInTheDocument();
    expect(screen.getByText("Alta · 78")).toBeInTheDocument();
    expect(screen.getByText(/Audio No configurado/)).toBeInTheDocument();
    expect(document.querySelector("pre")).toBeNull();
    fireEvent.change(screen.getByLabelText("Categoría"),{target:{value:"threat"}});
    await waitFor(()=>expect(searchAdminContentSafetyAlerts).toHaveBeenLastCalledWith(expect.objectContaining({p_category:"threat"})));
  });

  it("keeps review human-only and routes enforcement to canonical content/user surfaces",async()=>{
    render(<MemoryRouter initialEntries={[`/content-safety/${alertId}`]}><Routes><Route path="/content-safety/:id" element={<AdminContentSafetyDetailPage/>}/></Routes></MemoryRouter>);
    expect(await screen.findByText("El análisis automático no cubrió audio/visual. Esta alerta no certifica que el contenido sea seguro.")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Abrir contenido canónico"})).toHaveAttribute("href",`/content/video/${targetId}`);
    expect(screen.getByRole("link",{name:"Abrir usuario / disciplina F2"})).toHaveAttribute("href",`/users/${ownerId}`);
    const review=screen.getByRole("heading",{name:"Revisión humana"}).closest("section") as HTMLElement;
    expect(within(review).getByRole("button",{name:"Tomar para revisión"})).toBeInTheDocument();
    expect(within(review).getByRole("button",{name:"Sin infracción"})).toBeInTheDocument();
    expect(within(review).queryByRole("button",{name:/ocultar|suspender|warning/i})).not.toBeInTheDocument();
  });

  it("shows Audio AI source reuse, transcript timing and no automatic sanctions",async()=>{
    render(<MemoryRouter><AdminContentSafetyAudioPage/></MemoryRouter>);
    expect(await screen.findByRole("heading",{name:"Speech-to-Text"})).toBeInTheDocument();
    expect(screen.getByText(/Cloudflare Workers AI · Activo/)).toBeInTheDocument();
    expect(screen.getByText(/Reutilizada desde video fuente/)).toBeInTheDocument();
    render(<MemoryRouter initialEntries={[`/content-safety/audio/${scanId}`]}><Routes><Route path="/content-safety/audio/:id" element={<AdminContentSafetyAudioDetailPage/>}/></Routes></MemoryRouter>);
    expect(await screen.findByText("Transcripción reutilizada desde video fuente")).toBeInTheDocument();
    expect(screen.getByText("texto real transcrito")).toBeInTheDocument();
    expect(screen.getByText("0.0 s – 1.2 s")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/warning|suspender|ocultar|eliminar/i})).not.toBeInTheDocument();
  });

  it("capability-gates rule mutation and explains that production starts without invented rules",async()=>{
    vi.mocked(useAdminAuth).mockReturnValue({hasCapability:(capability:string)=>capability!=="content.items.moderate"} as never);
    render(<MemoryRouter><AdminContentSafetyRulesPage/></MemoryRouter>);
    expect(await screen.findByText("0 reglas configuradas")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Crear regla"})).not.toBeInTheDocument();
  });

  it("binds approval to the canonical rule id, version and definition fingerprint",async()=>{
    vi.mocked(searchAdminContentSafetyRules).mockResolvedValue({stats:{total:1,draft:1,approved:0,enabled:0,retired:0},items:[governedRule(1)]});
    vi.mocked(previewAdminContentSafetyRule).mockResolvedValue(governedPreview(1));
    vi.mocked(approveAdminContentSafetyRule).mockResolvedValue({rule_id:ruleId});
    vi.spyOn(window,"confirm").mockReturnValue(true);
    render(<MemoryRouter><AdminContentSafetyRulesPage/></MemoryRouter>);
    const card=(await screen.findByText("Policy rule")).closest("article") as HTMLElement;
    expect(within(card).getByRole("button",{name:"Aprobar regla"})).toBeDisabled();
    fireEvent.click(within(card).getByRole("button",{name:"Probar regla"}));
    expect(await within(card).findByText("1 coincidencias potenciales")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button",{name:"Aprobar regla"}));
    await waitFor(()=>expect(approveAdminContentSafetyRule).toHaveBeenCalledWith(expect.objectContaining({id:ruleId,definitionFingerprint:"fingerprint-v1"})));
    expect(previewAdminContentSafetyRule).toHaveBeenCalledWith({id:ruleId,limit:20});
  });

  it("invalidates stale preview through dirty edits, save refresh, approval version change and canonical prop synchronization",async()=>{
    const editedScopes=["video_caption","comment"];
    const v1=governedRule(1),v2=governedRule(2,{scopes:editedScopes}),v3=governedRule(3,{scopes:editedScopes,approval_state:"approved",approved_at:"2026-09-14T12:03:00Z"});
    vi.mocked(searchAdminContentSafetyRules)
      .mockResolvedValueOnce({stats:{total:1,draft:1,approved:0,enabled:0,retired:0},items:[v1]})
      .mockResolvedValueOnce({stats:{total:1,draft:1,approved:0,enabled:0,retired:0},items:[v2]})
      .mockResolvedValue({stats:{total:1,draft:0,approved:1,enabled:0,retired:0},items:[v3]});
    vi.mocked(previewAdminContentSafetyRule)
      .mockResolvedValueOnce(governedPreview(1))
      .mockResolvedValueOnce(governedPreview(2,editedScopes))
      .mockResolvedValue(governedPreview(3,editedScopes));
    vi.mocked(updateAdminContentSafetyRule).mockResolvedValue({rule_id:ruleId,version:2});
    vi.mocked(approveAdminContentSafetyRule).mockResolvedValue({rule_id:ruleId,version:3});
    vi.mocked(setAdminContentSafetyRuleEnabled).mockResolvedValue({rule_id:ruleId,version:4,enabled:true});
    vi.spyOn(window,"confirm").mockReturnValue(true);
    render(<MemoryRouter><AdminContentSafetyRulesPage/></MemoryRouter>);
    let card=(await screen.findByText("Policy rule")).closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button",{name:"Probar regla"}));
    expect(await within(card).findByText("1 coincidencias potenciales")).toBeInTheDocument();
    fireEvent.click(within(card).getByText("Editar gobierno"));
    fireEvent.click(within(card).getByLabelText("comment"));
    expect(within(card).queryByText("1 coincidencias potenciales")).not.toBeInTheDocument();
    expect(within(card).getByRole("button",{name:"Aprobar regla"})).toBeDisabled();
    expect(within(card).getByRole("button",{name:"Probar regla"})).toBeDisabled();
    fireEvent.click(within(card).getByRole("button",{name:"Guardar como borrador"}));
    await waitFor(()=>expect(updateAdminContentSafetyRule).toHaveBeenCalledWith(expect.objectContaining({scopes:["video_caption","comment"]})));
    await waitFor(()=>expect(screen.getByText("policy_rule · v2")).toBeInTheDocument());
    card=screen.getByText("Policy rule").closest("article") as HTMLElement;
    expect(within(card).queryByText("1 coincidencias potenciales")).not.toBeInTheDocument();
    expect(within(card).getByRole("button",{name:"Aprobar regla"})).toBeDisabled();
    fireEvent.click(within(card).getByRole("button",{name:"Probar regla"}));
    await within(card).findByText("1 coincidencias potenciales");
    fireEvent.click(within(card).getByRole("button",{name:"Aprobar regla"}));
    await waitFor(()=>expect(screen.getByText("policy_rule · v3")).toBeInTheDocument());
    card=screen.getByText("Policy rule").closest("article") as HTMLElement;
    expect(within(card).getByRole("button",{name:"Activar"})).toBeDisabled();
    expect(within(card).queryByText("1 coincidencias potenciales")).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button",{name:"Probar regla"}));
    await within(card).findByText("1 coincidencias potenciales");
    fireEvent.click(within(card).getByRole("button",{name:"Activar"}));
    await waitFor(()=>expect(setAdminContentSafetyRuleEnabled).toHaveBeenCalledWith(expect.objectContaining({id:ruleId,definitionFingerprint:"fingerprint-v3",enabled:true})));
  });

  it("rejects a server preview whose fingerprint differs from the canonical projection",async()=>{
    vi.mocked(searchAdminContentSafetyRules).mockResolvedValue({stats:{total:1,draft:1,approved:0,enabled:0,retired:0},items:[governedRule(1)]});
    vi.mocked(previewAdminContentSafetyRule).mockResolvedValue({...governedPreview(1),definition_fingerprint:"stale-fingerprint"});
    render(<MemoryRouter><AdminContentSafetyRulesPage/></MemoryRouter>);
    const card=(await screen.findByText("Policy rule")).closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button",{name:"Probar regla"}));
    await within(card).findByText("1 coincidencias potenciales");
    expect(within(card).getByRole("button",{name:"Aprobar regla"})).toBeDisabled();
  });

  it("creates owner-authorized rules only as disabled drafts with provenance",async()=>{
    vi.mocked(createAdminContentSafetyRule).mockResolvedValue({rule_id:"50000000-0000-4000-8000-000000000005",approval_state:"draft",enabled:false});
    render(<MemoryRouter><AdminContentSafetyRulesPage/></MemoryRouter>);
    await screen.findByText("0 reglas configuradas");
    fireEvent.change(screen.getByLabelText("Code de regla"),{target:{value:"owner_term"}});
    fireEvent.change(screen.getByLabelText("Nombre de regla"),{target:{value:"Término del propietario"}});
    fireEvent.change(screen.getByLabelText("Palabra o frase"),{target:{value:"literal"}});
    fireEvent.change(screen.getByLabelText("Policy reference"),{target:{value:"owner-policy-2026-09"}});
    fireEvent.change(screen.getByLabelText("Rationale"),{target:{value:"Decisión humana explícita"}});
    fireEvent.click(screen.getByRole("button",{name:"Guardar borrador"}));
    await waitFor(()=>expect(createAdminContentSafetyRule).toHaveBeenCalledWith(expect.objectContaining({code:"owner_term",policySource:"owner_manual",policyReference:"owner-policy-2026-09",rationale:"Decisión humana explícita"})));
  });
});
