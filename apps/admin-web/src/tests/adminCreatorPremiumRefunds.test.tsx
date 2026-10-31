import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {supabase} from "../lib/supabase";
import {AdminCreatorPremiumDetailPage} from "../pages/AdminCreatorPremiumPages";

// Keep the actual page, presentation, API validation and retry coordinator.
// Only Auth context and the external Supabase transport are synthetic.
vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
const transport=vi.hoisted(()=>({rpc:vi.fn<(name:string,args?:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string;code?:string}|null}>>(),invoke:vi.fn()}));
vi.mock("../lib/supabase",()=>({supabase:{rpc:transport.rpc,functions:{invoke:transport.invoke}}}));
const contentId="10000000-0000-4000-8000-000000000001",receiptId="20000000-0000-4000-8000-000000000002",periodId="30000000-0000-4000-8000-000000000003";
let capability=true,level:"aal1"|"aal2"|null="aal2",policy=true;
const rpc=transport.rpc;
const renderPage=()=>render(<MemoryRouter initialEntries={[`/creator-premium/${contentId}`]}><Routes><Route path="/creator-premium/:id" element={<AdminCreatorPremiumDetailPage/>}/></Routes></MemoryRouter>);
const refundCalls=()=>rpc.mock.calls.filter(([name])=>String(name).startsWith("admin_refund_"));
const ready=async()=>{await screen.findByRole("button",{name:"Reembolsar compra"});fireEvent.change(screen.getByRole("textbox",{name:"Motivo del reembolso"}),{target:{value:"admin_requested"}})};
const refundReceipt=(replay=false)=>({receipt_id:receiptId,reversal_financial_transaction_id:"40000000-0000-4000-8000-000000000004",access_state:"refunded",money_moved:!replay,replayed:replay,already_refunded:replay});
beforeEach(()=>{
  vi.clearAllMocks();capability=true;level="aal2";policy=true;
  vi.spyOn(window,"confirm").mockReturnValue(true);
  vi.mocked(useAdminAuth).mockImplementation(()=>({session:{user:{id:"50000000-0000-4000-8000-000000000005"}},security:{currentLevel:level,nextLevel:"aal2",error:null},hasCapability:(cap:string)=>capability&&cap==="creator_premium.refunds.write"}) as never);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({data:null,error:new Error("synthetic media unavailable")} as never);
  rpc.mockImplementation(async(name)=>{
    if(name==="get_admin_creator_premium_content_v1")return {data:{id:contentId,title:"Synthetic Premium",content_kind:"image",lifecycle_status:"published",finance_policy:{refunds_enabled:policy},plans:[],audit:[],reverification:{lifecycle_eligible:false,ready:false,reason_code:"creator_premium_content_not_restricted",current_scan_alert_count:0,favorable_alert_count:0,blocking_alert_count:0,actionable_alert_count:0,terminal_unfavorable_alert_count:0}},error:null} as never;
    if(name==="get_admin_creator_premium_refund_candidates_v1")return {data:{purchases:[{receipt_id:receiptId,gross_amount_bdag:"10.00000000",refundable:true}],subscription_periods:[{period_id:periodId,gross_amount_bdag:"20.00000000",refundable:true}]},error:null} as never;
    return {data:refundReceipt(),error:null} as never;
  });
});
it("hides financial actions and never requests candidates without the capability",async()=>{
  capability=false;renderPage();await screen.findByRole("heading",{name:"Synthetic Premium"});
  expect(screen.queryByRole("heading",{name:"Reembolsos Premium"})).not.toBeInTheDocument();
  expect(rpc.mock.calls.some(([name])=>name==="get_admin_creator_premium_refund_candidates_v1")).toBe(false);expect(refundCalls()).toHaveLength(0);
});
it.each(["aal1",null] as const)("locks refunds at %s with a security route and no confirmation or candidate request",async(assurance)=>{
  level=assurance;renderPage();await screen.findByRole("heading",{name:"Synthetic Premium"});
  expect(screen.getByText(/reembolsos requieren.*AAL2/i)).toBeInTheDocument();
  expect(screen.getByRole("link",{name:/verificar seguridad/i})).toHaveAttribute("href","/system/security");
  expect(screen.queryByRole("button",{name:/Reembolsar/})).not.toBeInTheDocument();
  expect(window.confirm).not.toHaveBeenCalled();expect(refundCalls()).toHaveLength(0);
  expect(rpc.mock.calls.some(([name])=>name==="get_admin_creator_premium_refund_candidates_v1")).toBe(false);
});
it("keeps the server policy disabled state even at AAL2",async()=>{
  policy=false;renderPage();await screen.findByText(/deshabilitados por la política financiera/);expect(refundCalls()).toHaveLength(0);expect(screen.queryByRole("button",{name:/Reembolsar/})).not.toBeInTheDocument();
});
it("AAL2 uses the existing confirmation and cancellation sends no refund",async()=>{
  vi.mocked(window.confirm).mockReturnValue(false);renderPage();await ready();fireEvent.click(screen.getByRole("button",{name:"Reembolsar compra"}));
  expect(window.confirm).toHaveBeenCalledWith("Confirmar reembolso completo y revocación de acceso");expect(refundCalls()).toHaveLength(0);
});
it.each([false,true])("retains the logical key after response loss and refreshes canonical reconciliation on success (replay %s)",async(replay)=>{
  const original=rpc.getMockImplementation()!;let attempts=0;
  rpc.mockImplementation(async(...args)=>{if(args[0]==="admin_refund_creator_premium_purchase_v1")return ++attempts===1?{data:null,error:{message:"private transport diagnostic",code:"PGRST000"}} as never:{data:refundReceipt(replay),error:null} as never;return original(...args)});
  renderPage();await ready();fireEvent.click(screen.getByRole("button",{name:"Reembolsar compra"}));await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent(/Resultado no confirmado/);expect(screen.queryByText(/private transport diagnostic/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Reembolsar compra"}));await screen.findByRole("status");
  expect(screen.getByRole("status")).toHaveTextContent(replay?"Reembolso ya realizado; no se movieron fondos.":"Reembolso efectuado.");
  const calls=refundCalls();expect(calls).toHaveLength(2);expect(calls[0][1]).toMatchObject({p_receipt_id:receiptId,p_reason_code:"admin_requested"});expect(calls[1][1]).toEqual(calls[0][1]);
  await waitFor(()=>expect(rpc.mock.calls.filter(([name])=>name==="get_admin_creator_premium_content_v1")).toHaveLength(2));
  await waitFor(()=>expect(rpc.mock.calls.filter(([name])=>name==="get_admin_creator_premium_refund_candidates_v1")).toHaveLength(2));
});
it("sanitizes definitive server denial and creates a fresh key only for a new accepted attempt",async()=>{
  const original=rpc.getMockImplementation()!;
  rpc.mockImplementation(async(...args)=>args[0]==="admin_refund_creator_premium_subscription_period_v1"?{data:null,error:{code:"42501",message:"private financial information"}} as never:original(...args));
  renderPage();await ready();fireEvent.click(screen.getByRole("button",{name:"Reembolsar periodo"}));await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("Operación rechazada por la autoridad financiera.");expect(screen.queryByText(/private financial information/)).not.toBeInTheDocument();expect(screen.queryByRole("status")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Reembolsar periodo"}));await waitFor(()=>expect(refundCalls()).toHaveLength(2));
  expect(refundCalls()[0][1]).toMatchObject({p_period_id:periodId});expect(refundCalls()[1][1]?.p_idempotency_key).not.toBe(refundCalls()[0][1]?.p_idempotency_key);
});
