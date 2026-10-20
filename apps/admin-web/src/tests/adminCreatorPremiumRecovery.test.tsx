import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {
  AdminRpcError,
  getAdminCreatorPremiumContent,
  getAdminCreatorPremiumImageGrant,
  getAdminCreatorPremiumReviewErrorMessage,
  reviewAdminCreatorPremiumContent,
} from "../lib/adminApi";
import {AdminCreatorPremiumDetailPage} from "../pages/AdminCreatorPremiumPages";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../components/AdminPresentation",()=>({
  AdminFact:({label,value}:{label:string;value:unknown})=><div><span>{label}</span><span>{String(value??"—")}</span></div>,
  AdminFactGrid:({children}:{children:unknown})=><div>{children as never}</div>,
  AdminIdentity:()=> <span>Creator</span>,
  AdminMediaPreview:()=> <div>Vista previa privada</div>,
  asRecord:(value:unknown)=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value:{},
  asRows:(value:unknown)=>Array.isArray(value)?value:[],
  humanValue:(value:unknown,fallback="—")=>value===null||value===undefined||value===""?fallback:String(value),
  shortId:(value:unknown)=>String(value??"—"),
}));
vi.mock("../lib/adminApi",async()=>{
  const actual=await vi.importActual<typeof import("../lib/adminApi")>("../lib/adminApi");
  return{
    ...actual,
    getAdminCreatorPremiumContent:vi.fn(),
    getAdminCreatorPremiumImageGrant:vi.fn(),
    getAdminCreatorPremiumVideoGrant:vi.fn(),
    getAdminCreatorPremiumRefundCandidates:vi.fn(),
    reviewAdminCreatorPremiumContent:vi.fn(),
  };
});

const contentId="10000000-0000-4000-8000-000000000001";
const actorId="20000000-0000-4000-8000-000000000002";
const renderDetail=()=>render(
  <MemoryRouter initialEntries={[`/creator-premium/${contentId}`]}>
    <Routes><Route path="/creator-premium/:id" element={<AdminCreatorPremiumDetailPage/>}/></Routes>
  </MemoryRouter>,
);

const detail=(blockingAlertCount:number,terminalUnfavorableAlertCount=0)=>({
  id:contentId,
  creator:{id:"30000000-0000-4000-8000-000000000003",username:"creator",display_name:"Creator",avatar_url:null},
  title:"Prueba segura",
  description:"Contenido benigno sujeto a revisión humana.",
  content_kind:"image",
  access_mode:"subscription",
  lifecycle_status:"quarantined",
  verification_status:"restricted",
  verification_error_code:"creator_premium_safety_review_required",
  teaser_url:null,
  media_ready:true,
  publication_blocker:"creator_premium_content_not_pending_review",
  offer:null,
  plans:[],
  finance_policy:{purchase_enabled:false,subscription_enabled:false,refunds_enabled:false,policy_version:"creator-premium-b4-v1"},
  submitted_at:"2026-10-19T18:44:34Z",
  reviewed_at:null,
  published_at:null,
  review_reason:null,
  audit:[],
  reverification:{
    lifecycle_eligible:true,
    ready:blockingAlertCount===0,
    reason_code:blockingAlertCount===0?null:"creator_premium_safety_alert_resolution_required",
    current_scan_alert_count:2,
    favorable_alert_count:2-blockingAlertCount,
    blocking_alert_count:blockingAlertCount,
    actionable_alert_count:blockingAlertCount-terminalUnfavorableAlertCount,
    terminal_unfavorable_alert_count:terminalUnfavorableAlertCount,
  },
});

beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(useAdminAuth).mockReturnValue({
    session:{user:{id:actorId}},
    hasCapability:(capability:string)=>capability==="creator_premium.review.moderate"||capability==="creator_premium.review.read",
  } as never);
  vi.mocked(getAdminCreatorPremiumImageGrant).mockResolvedValue({
    contentId,
    url:"https://example.test/private-review.jpg",
    expiresAt:"2026-10-20T04:00:00Z",
  });
});

describe("P3-C2 Creator Premium admin recovery",()=>{
  it("keeps re-verification disabled until every current-scan alert is Sin infracción",async()=>{
    vi.mocked(getAdminCreatorPremiumContent).mockResolvedValue(detail(1));
    renderDetail();

    expect(await screen.findByRole("heading",{name:"Prueba segura"})).toBeInTheDocument();
    expect(screen.getByText("Nueva verificación bloqueada")).toBeInTheDocument();
    expect(screen.getByText(/1 de 2 alertas del análisis vigente sigue sin una decisión favorable/i)).toBeInTheDocument();
    expect(screen.getByText(/usa el filtro En revisión y marca Sin infracción/i)).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"Abrir Content Safety → Alertas"})).toHaveAttribute("href","/content-safety");
    expect(screen.getByRole("button",{name:"Solicitar nueva verificación"})).toBeDisabled();
    expect(reviewAdminCreatorPremiumContent).not.toHaveBeenCalled();
  });

  it("does not tell reviewers to overwrite an immutable unfavorable decision",async()=>{
    vi.mocked(getAdminCreatorPremiumContent).mockResolvedValue(detail(1,1));
    renderDetail();

    expect(await screen.findByText("Nueva verificación bloqueada")).toBeInTheDocument();
    expect(screen.getByText(/1 decisión terminal desfavorable no puede sobrescribirse/i)).toBeInTheDocument();
    expect(screen.queryByText(/usa el filtro En revisión y marca Sin infracción/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Solicitar nueva verificación"})).toBeDisabled();
  });

  it("allows the canonical retry only after the server reports recovery readiness",async()=>{
    vi.mocked(getAdminCreatorPremiumContent).mockResolvedValue(detail(0));
    vi.mocked(reviewAdminCreatorPremiumContent).mockResolvedValue({lifecycle_status:"pending_review"});
    renderDetail();

    const button=await screen.findByRole("button",{name:"Solicitar nueva verificación"});
    expect(button).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Motivo de moderación"),{target:{value:"Revisión humana favorable completa"}});
    fireEvent.click(button);
    await waitFor(()=>expect(reviewAdminCreatorPremiumContent).toHaveBeenCalledWith(expect.objectContaining({
      id:contentId,
      action:"restore",
      reason:"Revisión humana favorable completa",
    })));
    expect(await screen.findByText("Nueva verificación solicitada. El contenido permanece privado mientras P3 analiza la generación vigente.")).toBeInTheDocument();
  });

  it("maps the canonical domain rejection instead of hiding it behind a generic error",async()=>{
    expect(getAdminCreatorPremiumReviewErrorMessage(new AdminRpcError(
      "creator_premium_safety_alert_resolution_required",
      "55000",
    ))).toMatch(/alertas del análisis vigente.*Sin infracción/i);
    expect(getAdminCreatorPremiumReviewErrorMessage(new AdminRpcError(
      "creator_premium_admin_restore_invalid_state",
      "55000",
    ))).toMatch(/estado del contenido cambió/i);
  });

  it("surfaces a safe domain message when readiness changes during the command",async()=>{
    vi.mocked(getAdminCreatorPremiumContent).mockResolvedValue(detail(0));
    vi.mocked(reviewAdminCreatorPremiumContent).mockRejectedValue(new AdminRpcError(
      "creator_premium_safety_alert_resolution_required",
      "55000",
    ));
    renderDetail();

    const button=await screen.findByRole("button",{name:"Solicitar nueva verificación"});
    fireEvent.change(screen.getByLabelText("Motivo de moderación"),{target:{value:"Decisión favorable comprobada"}});
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent(/todas las alertas.*Sin infracción/i);
    expect(screen.queryByText("Operación rechazada por la autoridad administrativa.")).not.toBeInTheDocument();
  });
});
