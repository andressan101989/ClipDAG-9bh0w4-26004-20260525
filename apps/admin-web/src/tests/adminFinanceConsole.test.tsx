import {cleanup,render,screen} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {
  AdminFinanceAnomaliesPage,AdminFinanceAuditPage,AdminFinanceOverviewPage,
  AdminFinanceReconciliationPage,AdminFinancialTransactionDetailPage,
  AdminFinancialTransactionsPage,AdminLedgerAccountsPage,
} from "../pages/AdminFinanceAuditSystemPages";
import {
  getAdminFinanceOverview,getAdminFinanceReconciliation,getAdminFinancialTransactionDetail,
  searchAdminFinanceAnomalies,searchAdminFinanceAudit,searchAdminFinancialTransactions,
  searchAdminLedgerAccounts,
} from "../lib/adminObservabilityApi";

vi.mock("../lib/adminObservabilityApi",()=>({
  getAdminFinanceOverview:vi.fn(),getAdminFinanceReconciliation:vi.fn(),getAdminFinancialTransactionDetail:vi.fn(),
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
    expect(screen.getByText(/223\.96430556 BDAG de balance/)).toBeInTheDocument();
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
    expect(screen.getByText("Fee 1")).toBeInTheDocument();
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
