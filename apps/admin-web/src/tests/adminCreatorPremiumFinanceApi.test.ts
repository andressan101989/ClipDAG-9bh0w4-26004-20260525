import {beforeEach,describe,expect,it,vi} from "vitest";
import {searchAdminCreatorPremiumFinance} from "../lib/adminObservabilityApi";

const {rpcMock}=vi.hoisted(()=>({rpcMock:vi.fn()}));

vi.mock("../lib/supabase",()=>({supabase:{rpc:rpcMock}}));

const response={
  policy:{purchase_enabled:false,subscription_enabled:false,refunds_enabled:false,platform_fee_bps:0,policy_version:"creator-premium-f2"},
  counts:{purchase_receipts:1,subscription_relationships:0,subscription_periods:0,refunds:0,integrity_failures:0},
  reconciliation:{invalid_purchase_facts:0,invalid_subscription_period_facts:0,subscriptions_without_period:0,multiple_periods_per_relationship:0,orphan_creator_premium_transactions:0,duplicate_open_relationships:0},
  items:[{
    source:"purchase",reference_id:"10000000-0000-4000-8000-000000000001",
    financial_transaction_id:"10000000-0000-4000-8000-000000000002",reversal_financial_transaction_id:null,
    content_id:"10000000-0000-4000-8000-000000000003",content_title:"Curso seguro",plan_id:null,plan_name:null,
    customer:{id:"10000000-0000-4000-8000-000000000004",username:"buyer",display_name:"Buyer One",avatar_url:null},
    creator:{id:"10000000-0000-4000-8000-000000000005",username:"creator",display_name:"Creator One",avatar_url:"https://example.com/avatar.png"},
    access_state:"active",subscription_status:null,gross_amount_bdag:"2000.00000000",platform_fee_bdag:"0.00000000",
    creator_net_bdag:"2000.00000000",currency:"BDAG",created_at:"2026-10-24T12:00:00Z",refunded_at:null,verified:true,
  }],
  next_cursor:{created_at:"2026-10-24T12:00:00Z",reference_id:"10000000-0000-4000-8000-000000000001"},
};

const oversizedItems=Array.from({length:101},(_,index)=>({
  ...response.items[0],
  reference_id:`10000000-0000-4000-8000-${String(101-index).padStart(12,"0")}`,
}));
const newerItem={
  ...response.items[0],
  reference_id:"10000000-0000-4000-8000-000000000010",
  financial_transaction_id:"10000000-0000-4000-8000-000000000011",
  created_at:"2026-10-25T12:00:00Z",
};

describe("Creator Premium Finance API contract",()=>{
  beforeEach(()=>rpcMock.mockReset());

  it("calls the canonical read-only RPC with its exact bounded filters",async()=>{
    rpcMock.mockResolvedValueOnce({data:response,error:null});
    await expect(searchAdminCreatorPremiumFinance({
      p_source:"purchase",p_state:"active",p_query:"curso",
      p_cursor_created_at:null,p_cursor_reference_id:null,p_limit:100,
    })).resolves.toEqual(response);
    expect(rpcMock).toHaveBeenCalledWith("search_admin_creator_premium_finance_v1",{
      p_source:"purchase",p_state:"active",p_query:"curso",
      p_cursor_created_at:null,p_cursor_reference_id:null,p_limit:100,
    });
  });

  it.each([
    ["numeric money",{...response,items:[{...response.items[0],gross_amount_bdag:2000}]}],
    ["decimal without canonical scale",{...response,items:[{...response.items[0],gross_amount_bdag:"2000"}]}],
    ["non-boolean integrity",{...response,items:[{...response.items[0],verified:"yes"}]}],
    ["unsafe identity URL",{...response,items:[{...response.items[0],customer:{...response.items[0].customer,avatar_url:"javascript:alert(1)"}}]}],
    ["malformed cursor",{...response,next_cursor:{created_at:"yesterday",reference_id:"not-a-uuid"}}],
    ["negative reconciliation",{...response,reconciliation:{...response.reconciliation,invalid_purchase_facts:-1}}],
    ["missing reconciliation counter",{...response,reconciliation:{invalid_purchase_facts:0}}],
    ["unexpected reconciliation counter",{...response,reconciliation:{...response.reconciliation,unexpected_counter:0}}],
    ["pending relationship without a paid period",{...response,items:[{...response.items[0],source:"subscription",content_id:null,plan_id:"20000000-0000-4000-8000-000000000001",subscription_status:"pending"}]}],
    ["more than 100 facts",{...response,items:oversizedItems,next_cursor:null}],
    ["duplicate references",{...response,items:[response.items[0],response.items[0]],next_cursor:null}],
    ["facts outside descending cursor order",{...response,items:[response.items[0],newerItem],next_cursor:null}],
    ["cursor not bound to the last fact",{...response,next_cursor:{created_at:response.items[0].created_at,reference_id:"10000000-0000-4000-8000-000000000099"}}],
    ["cursor on an empty page",{...response,items:[],next_cursor:response.next_cursor}],
  ])("rejects %s instead of rendering ambiguous financial facts",async(_label,payload)=>{
    rpcMock.mockResolvedValueOnce({data:payload,error:null});
    await expect(searchAdminCreatorPremiumFinance({p_source:null,p_state:null,p_query:null,p_cursor_created_at:null,p_cursor_reference_id:null,p_limit:100})).rejects.toThrow(/Respuesta inválida/);
  });

  it("sanitizes backend SQL details while retaining an approved domain code",async()=>{
    rpcMock.mockResolvedValueOnce({data:null,error:{message:"duplicate key violates private.secret_idx"}});
    await expect(searchAdminCreatorPremiumFinance({p_source:null,p_state:null,p_query:null,p_cursor_created_at:null,p_cursor_reference_id:null,p_limit:100}))
      .rejects.toThrow("No se pudo consultar Creator Premium.");
    rpcMock.mockResolvedValueOnce({data:null,error:{message:"RPC failed: creator_premium_finance_read_forbidden (private detail)"}});
    await expect(searchAdminCreatorPremiumFinance({p_source:null,p_state:null,p_query:null,p_cursor_created_at:null,p_cursor_reference_id:null,p_limit:100}))
      .rejects.toThrow(/^creator_premium_finance_read_forbidden$/);
  });
});
