import {fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {getAdminCreatorPremiumFinanceActivation,searchAdminCreatorPremiumFinance} from "../lib/adminObservabilityApi";
import {formatAdminExactMoney} from "../lib/adminMoney";
import {AdminCreatorPremiumFinancePage} from "../pages/AdminFinanceAuditSystemPages";

vi.mock("../lib/adminObservabilityApi",()=>(
  {
    getAdminFinanceOverview:vi.fn(),getAdminFinanceReconciliation:vi.fn(),getAdminFinancialTransactionDetail:vi.fn(),getAdminPlatformRevenue:vi.fn(),
    getAdminSystemHealth:vi.fn(),getAdminSystemJobDetail:vi.fn(),searchAdminFinanceAnomalies:vi.fn(),searchAdminFinanceAudit:vi.fn(),
    searchAdminFinancialTransactions:vi.fn(),searchAdminGlobalAudit:vi.fn(),searchAdminLedgerAccounts:vi.fn(),searchAdminSystemAudit:vi.fn(),
    searchAdminSystemJobs:vi.fn(),searchAdminCreatorPremiumFinance:vi.fn(),getAdminCreatorPremiumFinanceActivation:vi.fn(),
  }
));
vi.mock("../lib/adminApi",()=>({formatDate:(value:unknown)=>String(value??"—")}));

const purchase={
  source:"purchase" as const,reference_id:"10000000-0000-4000-8000-000000000001",
  financial_transaction_id:"10000000-0000-4000-8000-000000000002",reversal_financial_transaction_id:null,
  content_id:"10000000-0000-4000-8000-000000000003",content_title:"Curso seguro",plan_id:null,plan_name:null,
  customer:{id:"10000000-0000-4000-8000-000000000004",username:"buyer",display_name:"Buyer One",avatar_url:null},
  creator:{id:"10000000-0000-4000-8000-000000000005",username:"creator",display_name:"Creator One",avatar_url:null},
  access_state:"active" as const,subscription_status:null,gross_amount_bdag:"2000.00000000",platform_fee_bdag:"0.00000000",
  creator_net_bdag:"2000.00000000",currency:"BDAG" as const,created_at:"2026-10-24T12:00:00Z",refunded_at:null,verified:true,
};
const baseResponse={
  policy:{purchase_enabled:false,subscription_enabled:false,refunds_enabled:false,platform_fee_bps:0,policy_version:"creator-premium-f2"},
  counts:{purchase_receipts:1,subscription_relationships:0,subscription_periods:0,refunds:0,integrity_failures:0},
  reconciliation:{invalid_purchase_facts:0,invalid_subscription_period_facts:0,subscriptions_without_period:0,multiple_periods_per_relationship:0,orphan_creator_premium_transactions:0,duplicate_open_relationships:0},
  items:[purchase],next_cursor:null,
};

describe("F2 read-only Creator Premium finance console",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.mocked(searchAdminCreatorPremiumFinance).mockResolvedValue(baseResponse);
    vi.mocked(getAdminCreatorPremiumFinanceActivation).mockResolvedValue({activation:{
      mode:"off",scope:null,authorization_id:null,charge_starts_at:null,charge_expires_at:null,refund_expires_at:null,
      operations:{purchase_enabled:false,subscription_enabled:false,refunds_enabled:false},
      limits:{purchase_count:0,subscription_count:0,refund_count:0,purchase_amount_bdag:"0.00000000",subscription_amount_bdag:"0.00000000",gross_bdag:"0.00000000"},
      consumed:{purchase_count:0,subscription_count:0,refund_count:0,gross_bdag:"0.00000000"},
      remaining:{purchase_count:0,subscription_count:0,refund_count:0,gross_bdag:"0.00000000"},
    }});
  });

  it("does not infer OFF from legacy policy when activation is missing",async()=>{
    vi.mocked(getAdminCreatorPremiumFinanceActivation).mockResolvedValue({activation:null});
    render(<MemoryRouter><AdminCreatorPremiumFinancePage/></MemoryRouter>);
    await screen.findByText("Curso seguro");
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.queryByText("Finance OFF")).not.toBeInTheDocument();
    expect(screen.getByText(/Sin activación pública/)).toBeInTheDocument();
  });

  it("shows only finite canary scope, exact exposure and permanent consumption without an activation control",async()=>{
    vi.mocked(getAdminCreatorPremiumFinanceActivation).mockResolvedValue({activation:{
      mode:"canary",scope:"CANARY",authorization_id:"90000000-0000-4000-8000-000000000001",
      charge_starts_at:"2026-10-25T00:00:00Z",charge_expires_at:"2026-10-25T00:30:00Z",refund_expires_at:"2026-10-25T01:00:00Z",
      operations:{purchase_enabled:true,subscription_enabled:true,refunds_enabled:true},
      limits:{purchase_count:1,subscription_count:1,refund_count:1,purchase_amount_bdag:"10.00000000",subscription_amount_bdag:"20.00000000",gross_bdag:"30.00000000"},
      consumed:{purchase_count:1,subscription_count:0,refund_count:0,gross_bdag:"10.00000000"},
      remaining:{purchase_count:0,subscription_count:1,refund_count:1,gross_bdag:"20.00000000"},
    }});
    render(<MemoryRouter><AdminCreatorPremiumFinancePage/></MemoryRouter>);
    expect(await screen.findByText("Canary limitado")).toBeInTheDocument();
    const scope=screen.getByRole("region",{name:"Activación Finance Premium"});
    expect(within(scope).getByText("30.00000000 BDAG")).toBeInTheDocument();
    expect(within(scope).getByText("Compras: límite 1 · consumidos 1 · restantes 0")).toBeInTheDocument();
    expect(within(scope).getByText("Fin de cargos")).toBeInTheDocument();
    expect(scope.textContent).not.toContain("90000000-0000-4000-8000-000000000001");
    expect(within(scope).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a general activation with exact consumption and no invented limits or deadlines",async()=>{
    const generalActivation={activation:{
      mode:"general" as const,scope:"GENERAL" as const,authorization_id:"90000000-0000-4000-8000-000000000002",
      charge_starts_at:"2026-10-26T03:00:00Z",charge_expires_at:null,refund_expires_at:null,
      operations:{purchase_enabled:true,subscription_enabled:true,refunds_enabled:true},
      limits:null,
      consumed:{purchase_count:12,subscription_count:3,refund_count:1,gross_bdag:"4500.00000000"},
      remaining:null,
    }};
    const actualApi=await vi.importActual<typeof import("../lib/adminObservabilityApi")>("../lib/adminObservabilityApi");
    expect(actualApi.parseAdminCreatorPremiumFinanceActivation(generalActivation)).toEqual(generalActivation);
    expect(()=>actualApi.parseAdminCreatorPremiumFinanceActivation({activation:{
      ...generalActivation.activation,
      limits:{purchase_count:0,subscription_count:0,refund_count:0,purchase_amount_bdag:"0.00000000",subscription_amount_bdag:"0.00000000",gross_bdag:"0.00000000"},
    }})).toThrow(/Respuesta inválida/);
    expect(()=>actualApi.parseAdminCreatorPremiumFinanceActivation({activation:{
      ...generalActivation.activation,
      operations:{purchase_enabled:true,subscription_enabled:true,refunds_enabled:false},
    }})).toThrow(/Respuesta inválida/);

    vi.mocked(searchAdminCreatorPremiumFinance).mockResolvedValue({...baseResponse,policy:{...baseResponse.policy,purchase_enabled:true,subscription_enabled:true,platform_fee_bps:2000,policy_version:"creator-premium-f4"}});
    vi.mocked(getAdminCreatorPremiumFinanceActivation).mockResolvedValue(generalActivation);
    render(<MemoryRouter><AdminCreatorPremiumFinancePage/></MemoryRouter>);
    expect(await screen.findByText("Activación general")).toBeInTheDocument();
    const scope=screen.getByRole("region",{name:"Activación Finance Premium"});
    expect(within(scope).getByText("GENERAL")).toBeInTheDocument();
    expect(within(scope).getByText("2000 bps")).toBeInTheDocument();
    expect(within(scope).getByText("4,500.00000000 BDAG")).toBeInTheDocument();
    expect(within(scope).getByText("Compras autorizadas").parentElement).toHaveTextContent("Sí");
    expect(within(scope).getByText("Suscripciones autorizadas").parentElement).toHaveTextContent("Sí");
    expect(within(scope).getByText("Reembolsos autorizados").parentElement).toHaveTextContent("Sí");
    expect(within(scope).getByText("Compras consumidas: 12")).toBeInTheDocument();
    expect(within(scope).getByText("Suscripciones consumidas: 3")).toBeInTheDocument();
    expect(within(scope).getByText("Reembolsos consumidos: 1")).toBeInTheDocument();
    expect(scope.textContent).not.toContain("límite");
    expect(scope.textContent).not.toContain("restantes");
    expect(within(scope).queryByText("Fin de cargos")).not.toBeInTheDocument();
    expect(within(scope).queryByText("Fin de reembolsos")).not.toBeInTheDocument();
  });

  it("accepts the exact pre-F4 OFF projection while requiring scope for GENERAL",async()=>{
    const actualApi=await vi.importActual<typeof import("../lib/adminObservabilityApi")>("../lib/adminObservabilityApi");
    const legacyOff={activation:{
      mode:"off",authorization_id:null,charge_starts_at:null,charge_expires_at:null,refund_expires_at:null,
      operations:{purchase_enabled:false,subscription_enabled:false,refunds_enabled:false},
      limits:{purchase_count:0,subscription_count:0,refund_count:0,purchase_amount_bdag:"0.00000000",subscription_amount_bdag:"0.00000000",gross_bdag:"0.00000000"},
      consumed:{purchase_count:0,subscription_count:0,refund_count:0,gross_bdag:"0.00000000"},
      remaining:{purchase_count:0,subscription_count:0,refund_count:0,gross_bdag:"0.00000000"},
    }};
    expect(actualApi.parseAdminCreatorPremiumFinanceActivation(legacyOff)).toEqual(legacyOff);
    expect(()=>actualApi.parseAdminCreatorPremiumFinanceActivation({activation:{
      ...legacyOff.activation,mode:"general",authorization_id:"90000000-0000-4000-8000-000000000002",
      charge_starts_at:"2026-10-26T03:00:00Z",limits:null,remaining:null,
      operations:{purchase_enabled:true,subscription_enabled:true,refunds_enabled:true},
    }})).toThrow(/Respuesta inválida/);
  });

  it("shows authoritative Finance OFF policy, exact commerce facts and reconciliation without write controls",async()=>{
    render(<MemoryRouter><AdminCreatorPremiumFinancePage/></MemoryRouter>);
    expect(await screen.findByText("Finance OFF")).toBeInTheDocument();
    expect(screen.getByText("Curso seguro")).toBeInTheDocument();
    expect(screen.getByText("Buyer One")).toBeInTheDocument();
    expect(screen.getByText("Creator One")).toBeInTheDocument();
    expect(screen.getByText("2,000.00000000 BDAG")).toBeInTheDocument();
    expect(screen.getByText("Íntegro")).toBeInTheDocument();
    expect(screen.getByText("Reconciliación")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/refund|reembols/i})).not.toBeInTheDocument();
  });

  it("renders canonical eight-decimal BDAG audit facts without IEEE-754 conversion",()=>{
    expect(formatAdminExactMoney("0.00000001","BDAG")).toBe("0.00000001 BDAG");
    expect(formatAdminExactMoney("99999999999999999999.99999999","BDAG"))
      .toBe("99,999,999,999,999,999,999.99999999 BDAG");
    expect(formatAdminExactMoney("-0.00000001","BDAG")).toBe("-0.00000001 BDAG");
    expect(formatAdminExactMoney("-0.00000000","BDAG")).toBe("0.00000000 BDAG");
    expect(()=>formatAdminExactMoney(0.00000001,"BDAG")).toThrow(/decimal canónico/i);
    expect(()=>formatAdminExactMoney("1.0","BDAG")).toThrow(/decimal canónico/i);
    expect(()=>formatAdminExactMoney("1.00000000","")).toThrow(/moneda/i);
  });

  it("sends only the canonical bounded filters",async()=>{
    render(<MemoryRouter><AdminCreatorPremiumFinancePage/></MemoryRouter>);
    await screen.findByText("Curso seguro");
    fireEvent.change(screen.getByRole("combobox",{name:"Origen Premium"}),{target:{value:"subscription"}});
    fireEvent.change(screen.getByRole("combobox",{name:"Estado Premium"}),{target:{value:"refunded"}});
    fireEvent.change(screen.getByRole("searchbox",{name:"Buscar comercio Premium"}),{target:{value:"buyer"}});
    expect(searchAdminCreatorPremiumFinance).not.toHaveBeenLastCalledWith(expect.objectContaining({p_query:"buyer"}));
    fireEvent.click(screen.getByRole("button",{name:"Buscar"}));
    await waitFor(()=>expect(searchAdminCreatorPremiumFinance).toHaveBeenLastCalledWith({
      p_source:"subscription",p_state:"refunded",p_query:"buyer",
      p_cursor_created_at:null,p_cursor_reference_id:null,p_limit:100,
    }));
  });

  it("paginates with the opaque canonical cursor and appends without duplicating facts",async()=>{
    const cursor={created_at:"2026-10-24T12:00:00Z",reference_id:purchase.reference_id};
    const subscription={...purchase,source:"subscription" as const,reference_id:"20000000-0000-4000-8000-000000000001",content_id:null,content_title:null,plan_id:"20000000-0000-4000-8000-000000000002",plan_name:"VIP v2",subscription_status:"active" as const,created_at:"2026-10-23T12:00:00Z"};
    vi.mocked(searchAdminCreatorPremiumFinance)
      .mockResolvedValueOnce({...baseResponse,next_cursor:cursor})
      .mockResolvedValueOnce({...baseResponse,items:[purchase,subscription],next_cursor:null});
    render(<MemoryRouter><AdminCreatorPremiumFinancePage/></MemoryRouter>);
    await screen.findByText("Curso seguro");
    fireEvent.click(screen.getByRole("button",{name:"Cargar más"}));
    await waitFor(()=>expect(searchAdminCreatorPremiumFinance).toHaveBeenLastCalledWith({
      p_source:null,p_state:null,p_query:null,p_cursor_created_at:cursor.created_at,p_cursor_reference_id:cursor.reference_id,p_limit:100,
    }));
    expect(await screen.findByText("VIP v2")).toBeInTheDocument();
    const table=screen.getByRole("table");
    expect(within(table).getAllByText("Curso seguro")).toHaveLength(1);
  });
});
