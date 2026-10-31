import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminAdvertisingOverviewPage,AdminAdvertisingReviewPage,AdminAdvertisingBillingPage} from "../pages/AdminAdvertisingPages";
import * as api from "../lib/adminAdvertisingApi";
vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminAdvertisingApi",()=>({getAdminAdvertisingOverview:vi.fn(),getAdminAdvertisingHealth:vi.fn(),getAdminAdvertisingRolloutControl:vi.fn(),getAdminAdvertisingBillingHealth:vi.fn(),searchAdminAdvertisingBillingRates:vi.fn(),searchAdminAdvertisingAds:vi.fn(),searchAdminAdvertisingAdsPage:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();vi.mocked(useAdminAuth).mockReturnValue({hasCapability:()=>true} as never);
 vi.mocked(api.getAdminAdvertisingOverview).mockResolvedValue({inventory:{campaigns:5,ads:4},review:{pending:1,approved:3},events:{impressions:7,clicks:2},conversions:{conversions:1},finance:{spent_bdag:12,budget_bdag:50}} as never);
 vi.mocked(api.getAdminAdvertisingHealth).mockResolvedValue({finance:{funding_enabled:true,spend_enabled:false,settlement_enabled:true},lifecycle:{activation_enabled:true,automatic_transitions_enabled:false}} as never);
 vi.mocked(api.getAdminAdvertisingRolloutControl).mockResolvedValue({launch_mode:"CANARY",global_delivery_enabled:true,production_delivery_paused:false,authorization_window:{open_count:1,current:{mode:"CANARY"}},placements:[],blockers:[]} as never);
 vi.mocked(api.searchAdminAdvertisingAds).mockResolvedValue([]);
});
it("uses canonical launch and measured facts while keeping funding/spend/settlement independent",async()=>{
 render(<MemoryRouter><AdminAdvertisingOverviewPage/></MemoryRouter>);
 expect(await screen.findByText("CANARY")).toBeInTheDocument();
 expect(screen.getByText("Funding enabled")).toBeInTheDocument();expect(screen.getByText("Spend disabled")).toBeInTheDocument();expect(screen.getByText("Settlement enabled")).toBeInTheDocument();
 expect(screen.getByLabelText("Clicks metric")).toHaveTextContent("2");expect(screen.getByLabelText("Impressions metric")).toHaveTextContent("7");
 expect(screen.queryByText(/pre.launch|not available yet/i)).not.toBeInTheDocument();
});
it("does not claim disarmed or zero when rollout authority fails",async()=>{
 vi.mocked(api.getAdminAdvertisingRolloutControl).mockRejectedValue(new Error("SQLSTATE private.launch"));
 render(<MemoryRouter><AdminAdvertisingOverviewPage/></MemoryRouter>);
 expect(await screen.findByText(/Launch: No disponible/)).toBeInTheDocument();expect(screen.getByLabelText("Clicks metric")).toHaveTextContent("2");expect(screen.queryByText(/SQLSTATE|DISARMED|pre.launch/i)).not.toBeInTheDocument();
});
it("does not coerce malformed or missing aggregate values to zero",async()=>{
 vi.mocked(api.getAdminAdvertisingOverview).mockResolvedValue({inventory:{campaigns:"unavailable"},review:{},events:{impressions:"",clicks:null},conversions:{},finance:{}} as never);
 render(<MemoryRouter><AdminAdvertisingOverviewPage/></MemoryRouter>);
 expect(await screen.findByText("Campaigns")).toBeInTheDocument();
 expect(screen.getByText("Campaigns").closest("article")).toHaveTextContent("No disponible");
 expect(screen.getByLabelText("Impressions metric")).toHaveTextContent("No disponible");
});
it("pages the review authority using the shared real cursor including a nullable submission and retains Back on terminal",async()=>{
 const cursor={submitted_at:null,id:"11111111-1111-4111-8111-111111111111"};
 const item={id:cursor.id,submitted_at:null,name:"Unsubmitted page-one ad",status:"draft",review_status:"not_submitted",submission_fingerprint:null,reviewed_at:null,campaign:{name:"Campaign"},ad_set:{name:"Set"},creative:{},destination:{},latest_decision:null};
 vi.mocked(api.searchAdminAdvertisingAdsPage).mockResolvedValueOnce({items:[item],next_cursor:cursor}).mockResolvedValueOnce({items:[],next_cursor:null}).mockResolvedValueOnce({items:[item],next_cursor:cursor});
 render(<MemoryRouter initialEntries={["/advertising/review?reviewStatus="]}><AdminAdvertisingReviewPage/></MemoryRouter>);
 expect(await screen.findByText("Unsubmitted page-one ad")).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Página siguiente"}));await screen.findByText("Página 2");
 await waitFor(()=>expect(api.searchAdminAdvertisingAdsPage).toHaveBeenLastCalledWith({reviewStatus:"",cursor,limit:50}));
 expect(screen.getByText("No reviews on this page")).toBeInTheDocument();
 expect(screen.queryByText("Unsubmitted page-one ad")).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"Página siguiente"})).toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"Página anterior"}));await screen.findByText("Página 1");expect(await screen.findByText("Unsubmitted page-one ad")).toBeInTheDocument();
 expect(api.searchAdminAdvertisingAdsPage).toHaveBeenLastCalledWith({reviewStatus:"",cursor:undefined,limit:50});
});
it("uses page-scoped Ads rates terminal wording",async()=>{
 vi.mocked(api.getAdminAdvertisingBillingHealth).mockResolvedValue({} as never);
 vi.mocked(api.searchAdminAdvertisingBillingRates).mockResolvedValueOnce({items:[],next_cursor:{created_at:"2026-10-30T00:00:00Z",id:"11111111-1111-4111-8111-111111111111"}}).mockResolvedValueOnce({items:[],next_cursor:null});
 render(<MemoryRouter><AdminAdvertisingBillingPage/></MemoryRouter>);fireEvent.click(await screen.findByRole("button",{name:"Página siguiente"}));await screen.findByText("Página 2");
 expect(await screen.findByText("No rates on this page")).toBeInTheDocument();expect(screen.queryByText(/No real production rate has been configured/)).not.toBeInTheDocument();
});
