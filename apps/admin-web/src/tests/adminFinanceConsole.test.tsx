import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {
  AdminFinanceAnomaliesPage,AdminFinanceAuditPage,AdminFinanceOverviewPage,
  AdminFinanceReconciliationPage,AdminFinancialTransactionDetailPage,
  AdminFinancialTransactionsPage,AdminLedgerAccountsPage,
} from "../pages/AdminFinanceAuditSystemPages";
import {
  getAdminFinanceOverview,getAdminFinanceReconciliation,getAdminFinancialTransactionDetail,getAdminPlatformRevenue,
  searchAdminFinanceAnomalies,searchAdminFinanceAudit,searchAdminFinancialTransactions,
  searchAdminLedgerAccounts,
} from "../lib/adminObservabilityApi";

vi.mock("../lib/adminObservabilityApi",()=>({
  getAdminFinanceOverview:vi.fn(),getAdminFinanceReconciliation:vi.fn(),getAdminFinancialTransactionDetail:vi.fn(),getAdminPlatformRevenue:vi.fn(),
  getAdminSystemHealth:vi.fn(),getAdminSystemJobDetail:vi.fn(),searchAdminFinanceAnomalies:vi.fn(),
  searchAdminFinanceAudit:vi.fn(),searchAdminFinancialTransactions:vi.fn(),searchAdminGlobalAudit:vi.fn(),
  searchAdminLedgerAccounts:vi.fn(),searchAdminSystemAudit:vi.fn(),searchAdminSystemJobs:vi.fn(),
}));
vi.mock("../lib/adminApi",()=>({formatDate:(value:unknown)=>String(value??"—")}));

const txId="45196c06-4a78-4557-83e2-af60fd010487";
const accountId="9acc88f7-0fbf-4c61-b8e0-af8406561391";
const owner={id:"0915681e-e9eb-4d7c-b6c8-81aba3c36242",username:"blr",display_name:"Ledger Owner",avatar_url:null};

beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(getAdminFinanceOverview).mockResolvedValue({
    financial_transaction_count:921,ledger_account_count:131,ledger_entry_count:1896,frozen_account_count:0,
    marketplace_settlement_count:34,marketplace_refund_count:4,
    transactions_by_status:[{status:"completed",count:915},{status:"failed",count:6}],
    transactions_by_operation:[{operation_type:"withdrawal",status:"completed",count:9}],
    accounts_by_type:[{account_type:"user",currency:"BDAG",account_count:124,balance_total:223.96430556}],
    blockchain_settlements_by_status:[{status:"confirmed",count:11},{status:"provisional",count:7}],
  });
  vi.mocked(getAdminPlatformRevenue).mockResolvedValue({
    period:"year",period_start:"2026-01-01T00:00:00Z",period_end:"2026-09-14T13:00:00Z",timezone:"UTC",generated_at:"2026-09-14T13:00:00Z",
    kpis:[{currency:"BDAG",today_net:0,month_net:36,year_net:1033.44589444,all_net:1033.44589444}],
    summary:[{currency:"BDAG",gross_revenue:1051.94589444,reversals:18.5,net_revenue:1033.44589444,event_count:93}],
    sources:[
      {source_code:"live_gifts",label:"LIVE Gifts",currency:"BDAG",gross_revenue:841,reversals:0,net_revenue:841,event_count:41},
      {source_code:"marketplace",label:"Marketplace Fees",currency:"BDAG",gross_revenue:70.1,reversals:18.5,net_revenue:51.6,event_count:38},
      {source_code:"marketplace_ads",label:"Marketplace Ads",currency:"BDAG",gross_revenue:99.97569444,reversals:0,net_revenue:99.97569444,event_count:5},
      {source_code:"withdrawal_fees",label:"Withdrawal Fees",currency:"BDAG",gross_revenue:40.8702,reversals:0,net_revenue:40.8702,event_count:9},
    ],
    trend:[{bucket_start:"2026-09-01T00:00:00Z",currency:"BDAG",gross_revenue:36,reversals:0,net_revenue:36,event_count:8}],
    current_balances:[{account_type:"platform",currency:"BDAG",balance:891.1},{account_type:"marketplace_ads_revenue",currency:"BDAG",balance:99.97569444}],
    current_balance_totals:[{currency:"BDAG",balance:991.07569444}],
    platform_balance_summary:{currency:"BDAG",bdag_balance:991.07569444,usd_equivalent:9.9107569444,usd_per_bdag:.01},
    reconciliation:{overall_status:"pass",sources:[
      {source_code:"live_gifts",label:"LIVE Gifts",currency:"BDAG",status:"pass",primary_net:841,crosscheck_net:841,ledger_net:null},
      {source_code:"marketplace",label:"Marketplace Fees",currency:"BDAG",status:"pass",primary_net:51.6,crosscheck_net:51.6,ledger_net:51.6},
      {source_code:"marketplace_ads",label:"Marketplace Ads",currency:"BDAG",status:"pass",primary_net:99.97569444,crosscheck_net:99.97569444,ledger_net:99.97569444},
      {source_code:"withdrawal_fees",label:"Withdrawal Fees",currency:"BDAG",status:"pass",primary_net:40.8702,crosscheck_net:40.8702,ledger_net:null},
    ]},
  });
  vi.mocked(searchAdminLedgerAccounts).mockResolvedValue({items:[{id:accountId,owner,frozen:false,balance:0,currency:"BDAG",created_at:"2026-09-06T23:23:13Z",updated_at:"2026-09-06T23:43:07Z",account_type:"user"}],next_cursor:null});
  vi.mocked(searchAdminFinancialTransactions).mockResolvedValue({items:[{id:txId,amount:100,status:"completed",currency:"BDAG",created_at:"2026-09-06T23:43:07Z",fee_amount:1,entry_count:2,operation_type:"withdrawal",reference_type:"marketplace_order"}],next_cursor:null});
  vi.mocked(getAdminFinancialTransactionDetail).mockResolvedValue({transaction:{id:txId,amount:100,status:"completed",chain_id:null,currency:"BDAG",created_at:"2026-09-06T23:43:07Z",fee_amount:1,reference_id:"order-public-reference",operation_type:"withdrawal",reference_type:"marketplace_order",blockchain_txid:"0x5e58c27583a41e584e42fe29f7a2a56a51f960f8707a31df8cc4f756edb07cd5"},ledger_entries:[{id:"20000000-0000-4000-8000-000000000001",entry_type:"debit",amount:100,balance_after:0,account:{id:accountId,account_type:"user",owner}}]});
  vi.mocked(getAdminFinanceReconciliation).mockResolvedValue({marketplace_payments:{captured:34},marketplace_settlements:{released:34},settlement_legs:81,settlement_reversals:{},refund_holds:{released:4},refunds:4,settlement_run_failures:0,blockchain_settlements:{confirmed:11,provisional:7},financial_transactions:[{operation_type:"marketplace_payment_capture",status:"completed",count:268}],jobs:[{job_name:"settle-eligible-marketplace-orders",active:true,last_run:{status:"succeeded",started_at:"2026-09-13T10:00:00Z",ended_at:"2026-09-13T10:00:01Z"}}]});
  vi.mocked(searchAdminFinanceAnomalies).mockResolvedValue({items:[{rule_code:"MISSING_CANONICAL_REFERENCE",severity:"critical",entity_type:"refund",entity_id:"30000000-0000-4000-8000-000000000001",facts:{reference_type:"marketplace_return_refund"}}],rule_contracts:[]});
  vi.mocked(searchAdminFinanceAudit).mockResolvedValue({items:[{id:"40000000-0000-4000-8000-000000000001",actor:owner,action:"dispute_release_seller",domain:"marketplace",reason:null,outcome:"succeeded",target_id:"50000000-0000-4000-8000-000000000001",target_type:"dispute",created_at:"2026-08-23T17:18:12Z",metadata:{private_wallet:"wallet-secret"},request_fingerprint:"fingerprint-secret",idempotency_key:"idempotency-secret"}],next_cursor:null});
});

describe("ADMIN-SUPERPANEL-FULL-F1 Finance console",()=>{
  it("renders the real overview shape in a semantic fact grid",async()=>{
    render(<MemoryRouter><AdminFinanceOverviewPage/></MemoryRouter>);
    expect(await screen.findByText("921")).toBeInTheDocument();
    const summary=screen.getByText("Resumen financiero").closest("section") as HTMLElement;
    expect(summary.querySelector("dl")).not.toBeNull();
    expect(screen.getByText("Transacciones por operación")).toBeInTheDocument();
    expect(screen.getByText("withdrawal")).toBeInTheDocument();
    expect(screen.getByText(/223\.96 BDAG de balance/)).toBeInTheDocument();
  });

  it("renders canonical revenue separately from current balances and changes periods server-side",async()=>{
    render(<MemoryRouter><AdminFinanceOverviewPage/></MemoryRouter>);
    const revenue=await screen.findByRole("region",{name:"Ingresos de Nelyon"});
    expect(within(revenue).getByText("Ingresos netos")).toBeInTheDocument();
    expect(within(revenue).getByText("Marketplace Fees")).toBeInTheDocument();
    expect(within(revenue).getByText("Detalle de cuentas de plataforma")).toBeInTheDocument();
    const balanceCard=within(revenue).getByText("Saldo actual BDAG").closest("article") as HTMLElement;
    expect(within(balanceCard).getByText("991.08 BDAG")).toBeInTheDocument();
    const usdCard=within(revenue).getByText("Equivalente USD").closest("article") as HTMLElement;
    expect(within(usdCard).getByText("$9.91 USD")).toBeInTheDocument();
    expect(within(revenue).getByText(/saldo actual puede diferir del revenue acumulado/i)).toBeInTheDocument();
    expect(within(revenue).getByText("Reconciliado")).toBeInTheDocument();
    fireEvent.change(within(revenue).getByRole("combobox",{name:"Periodo de ingresos"}),{target:{value:"month"}});
    await waitFor(()=>expect(getAdminPlatformRevenue).toHaveBeenLastCalledWith("month"));
  });

  it("renders a controlled platform revenue error without hiding the finance overview",async()=>{
    vi.mocked(getAdminPlatformRevenue).mockRejectedValueOnce(new Error("Revenue projection failed"));
    render(<MemoryRouter><AdminFinanceOverviewPage/></MemoryRouter>);
    expect(await screen.findByText("Revenue projection failed")).toBeInTheDocument();
    expect(await screen.findByText("Resumen financiero")).toBeInTheDocument();
  });

  it("renders a controlled Finance overview error",async()=>{
    vi.mocked(getAdminFinanceOverview).mockRejectedValueOnce(new Error("Finance runtime failed"));
    render(<MemoryRouter><AdminFinanceOverviewPage/></MemoryRouter>);
    expect(await screen.findByText("Finance runtime failed")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/reintentar/i})).toBeInTheDocument();
  });

  it("renders accounts and transactions without undefined access",async()=>{
    const accounts=render(<MemoryRouter><AdminLedgerAccountsPage/></MemoryRouter>);
    expect(await screen.findByText("Ledger Owner")).toBeInTheDocument();
    expect(screen.getByText("Operativa")).toBeInTheDocument();
    accounts.unmount();
    render(<MemoryRouter><AdminFinancialTransactionsPage/></MemoryRouter>);
    const transaction=await screen.findByRole("link",{name:"withdrawal"});
    expect(transaction).toHaveAttribute("href",`/finance/transactions/${txId}`);
    expect(screen.getByText("Fee 1.00 BDAG")).toBeInTheDocument();
  });

  it("renders transaction detail, ledger entries and allow-listed blockchain reference",async()=>{
    render(<MemoryRouter initialEntries={[`/finance/transactions/${txId}`]}><Routes><Route path="/finance/transactions/:id" element={<AdminFinancialTransactionDetailPage/>}/></Routes></MemoryRouter>);
    expect(await screen.findByText("Entradas del ledger")).toBeInTheDocument();
    expect(screen.getByText("debit")).toBeInTheDocument();
    expect(screen.getByText("Ledger Owner")).toBeInTheDocument();
    expect(screen.queryByText(/idempotency/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw receipt/i)).not.toBeInTheDocument();
  });

  it("renders observational reconciliation without financial action buttons",async()=>{
    render(<MemoryRouter><AdminFinanceReconciliationPage/></MemoryRouter>);
    expect(await screen.findByText("Payments")).toBeInTheDocument();
    for(const heading of ["Settlements","Refunds","Blockchain","Jobs","Reversiones por motivo"])expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByText("marketplace_payment_capture")).toBeInTheDocument();
    expect(screen.getByText(/Activo/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/reconcile|settle|refund|retry|repair/i})).not.toBeInTheDocument();
  });

  it("renders anomalies and redacted Finance audit",async()=>{
    const anomalies=render(<MemoryRouter><AdminFinanceAnomaliesPage/></MemoryRouter>);
    expect(await screen.findByText("MISSING CANONICAL REFERENCE")).toBeInTheDocument();
    expect(screen.getByText("Investigar fuera de este panel")).toBeInTheDocument();
    anomalies.unmount();
    render(<MemoryRouter><AdminFinanceAuditPage/></MemoryRouter>);
    expect(await screen.findByText("dispute_release_seller")).toBeInTheDocument();
    expect(screen.getByText("Ledger Owner")).toBeInTheDocument();
    expect(screen.queryByText(/wallet-secret|fingerprint-secret|idempotency-secret/)).not.toBeInTheDocument();
  });

  it("renders empty states for list and anomaly projections",async()=>{
    vi.mocked(searchAdminLedgerAccounts).mockResolvedValueOnce({items:[],next_cursor:null});
    const accounts=render(<MemoryRouter><AdminLedgerAccountsPage/></MemoryRouter>);
    expect(await screen.findByText("Sin cuentas")).toBeInTheDocument();
    accounts.unmount();
    cleanup();
    vi.mocked(searchAdminFinanceAnomalies).mockResolvedValueOnce({items:[],rule_contracts:[]});
    render(<MemoryRouter><AdminFinanceAnomaliesPage/></MemoryRouter>);
    expect(await screen.findByText("Sin anomalías verificadas")).toBeInTheDocument();
  });
});
