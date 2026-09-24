import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {adminLinks} from "../layout/adminNavigation";
import {AdminAdvertisingCampaignDetailPage,AdminAdvertisingCampaignsPage,AdminAdvertisingHealthPage,AdminAdvertisingOverviewPage,AdminAdvertisingReviewPage} from "../pages/AdminAdvertisingPages";
import {getAdminAdvertisingCampaignDetail,getAdminAdvertisingHealth,getAdminAdvertisingOverview,reviewAdvertisingAd,searchAdminAdvertisingAds,searchAdminAdvertisingCampaigns} from "../lib/adminAdvertisingApi";

vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
vi.mock("../lib/adminApi",()=>({formatBdag:(value:unknown)=>`${value} BDAG`,formatDate:(value:unknown)=>String(value)}));
vi.mock("../lib/adminAdvertisingApi",()=>({
  getAdminAdvertisingCampaignDetail:vi.fn(),getAdminAdvertisingFinanceHealth:vi.fn(),getAdminAdvertisingHealth:vi.fn(),
  getAdminAdvertisingOverview:vi.fn(),reviewAdvertisingAd:vi.fn(),searchAdminAdvertisingAds:vi.fn(),searchAdminAdvertisingCampaigns:vi.fn(),
}));

const access=(capabilities:string[])=>({hasCapability:(capability:string)=>capabilities.includes(capability)});
const overview={authority:"ads_v2" as const,range:"30d" as const,generated_at:"2026-09-23T18:00:00Z",identity:{business_accounts:47,ad_accounts:47},inventory:{campaigns:0,ad_sets:0,ads:0,creatives:0},review:{not_submitted:0,pending:0,approved:0,rejected:0},events:{impressions:0,clicks:0,destination_opens:0,video_views:0,engagements:0,ctr:0},conversions:{conversions:0,attributions:0,marketplace_purchase_value_bdag:0},finance:{campaign_finance_count:0,draft_finance_count:0,funded_finance_count:0,settled_finance_count:0,budget_bdag:0,funded_bdag:0,spent_bdag:0,released_bdag:0,reserved_bdag:0},placements:[],objectives:[]};

beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(useAdminAuth).mockReturnValue(access(["advertising.ads.read","content.items.read","content.items.moderate","finance.reconciliation.read"]) as never);
  vi.mocked(getAdminAdvertisingOverview).mockResolvedValue(overview);
  vi.mocked(searchAdminAdvertisingCampaigns).mockResolvedValue({items:[],next_cursor:null,page_size:0,authority:"ads_v2"});
  vi.mocked(searchAdminAdvertisingAds).mockResolvedValue([]);
  vi.mocked(getAdminAdvertisingHealth).mockResolvedValue({authority:"ads_v2",production_delivery_ready:false,blockers:["age_authority_unavailable","campaign_activation_disabled","campaign_automatic_transitions_disabled","finance_funding_disabled","global_delivery_disabled","no_v2_placement_enabled"],capability_not_enabled:["geo_matching_disabled","language_matching_disabled"],identity:{business_accounts:47,ad_accounts:47},age:{age_eligibility_rows:0,advertiser_eligible_rows:0,advertiser_eligibility_operational:false},targeting:{targeting_policy_version:"nelyon-ads-targeting-v2",geo_targeting_enabled:false,language_targeting_enabled:false,daypart_targeting_enabled:true,frequency_targeting_enabled:true},delivery:{delivery_policy_version:"nelyon-ads-delivery-v2",global_v2_delivery_enabled:false,enabled_placement_count:0,campaign_activation_implemented:true},lifecycle:{policy_version:"nelyon-ads-campaign-lifecycle-v1",activation_enabled:false,automatic_transitions_enabled:false},events:{event_policy_version:"nelyon-ads-events-v1",events:0},finance:{finance_policy_version:"nelyon-ads-finance-v1",funding_enabled:false}});
});

describe("ADS-V2-J Admin Web",()=>{
  it("shows a factual pre-launch overview without launch, delivery, or finance mutation controls",async()=>{
    render(<MemoryRouter><AdminAdvertisingOverviewPage/></MemoryRouter>);
    expect(await screen.findByText("ADS V2 PRE-LAUNCH")).toBeInTheDocument();
    expect(screen.getByText("Delivery disabled")).toBeInTheDocument();
    expect(screen.getByText("Funding disabled")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/launch|activate|fund|enable delivery/i})).not.toBeInTheDocument();
  });

  it("renders a zero-safe campaign authority empty state",async()=>{
    render(<MemoryRouter><AdminAdvertisingCampaignsPage/></MemoryRouter>);
    expect(await screen.findByText("No Ads V2 campaigns")).toBeInTheDocument();
    expect(searchAdminAdvertisingCampaigns).toHaveBeenCalledWith(expect.objectContaining({limit:50}));
  });

  it("keeps moderation on the canonical D RPC and requires the moderation capability for actions",async()=>{
    vi.mocked(searchAdminAdvertisingAds).mockResolvedValue([{id:"11111111-1111-4111-8111-111111111111",name:"Review me",status:"draft",review_status:"pending",submitted_at:"2026-09-23T18:00:00Z",reviewed_at:null,campaign:{name:"Campaign"},ad_set:{name:"Set"},creative:{format:"image",primary_text:"Safe copy",headline:"Exact headline",description:"Exact description",call_to_action:"learn_more",media_status:"ready",media_mime_type:"image/png",preview_url:"https://cdn.example/creative.png"},destination:{destination_type:"external_url",external_url:"https://advertiser.example/landing"},latest_decision:null}]);
    vi.mocked(reviewAdvertisingAd).mockResolvedValue({review_status:"approved"});
    render(<MemoryRouter><AdminAdvertisingReviewPage/></MemoryRouter>);
    expect(await screen.findByRole("img",{name:"Creative Review me"})).toHaveAttribute("src","https://cdn.example/creative.png");
    expect(screen.getByText("Exact headline")).toBeInTheDocument();
    expect(screen.getByText("Exact description")).toBeInTheDocument();
    expect(screen.getByText("https://advertiser.example/landing")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button",{name:"Approve"}));
    await waitFor(()=>expect(reviewAdvertisingAd).toHaveBeenCalledWith(expect.objectContaining({adId:"11111111-1111-4111-8111-111111111111",action:"approve"})));
  });

  it("submits the visible default rejection reason instead of an implicit invalid other reason",async()=>{
    vi.mocked(searchAdminAdvertisingAds).mockResolvedValue([{id:"11111111-1111-4111-8111-111111111111",name:"Review me",status:"draft",review_status:"pending",submitted_at:"2026-09-23T18:00:00Z",reviewed_at:null,campaign:{name:"Campaign"},ad_set:{name:"Set"},creative:{format:"image",primary_text:"Safe copy"},destination:{destination_type:"external_url"},latest_decision:null}]);
    vi.mocked(reviewAdvertisingAd).mockResolvedValue({review_status:"rejected"});
    render(<MemoryRouter><AdminAdvertisingReviewPage/></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button",{name:"Reject"}));
    await waitFor(()=>expect(reviewAdvertisingAd).toHaveBeenCalledWith(expect.objectContaining({action:"reject",reasonCode:"policy_violation"})));
  });

  it("fails closed for approval when canonical media has no reviewable URL",async()=>{
    vi.mocked(searchAdminAdvertisingAds).mockResolvedValue([{id:"11111111-1111-4111-8111-111111111111",name:"No preview",status:"draft",review_status:"pending",submitted_at:"2026-09-23T18:00:00Z",reviewed_at:null,campaign:{name:"Campaign"},ad_set:{name:"Set"},creative:{format:"image",primary_text:"Copy",media_status:"ready",media_mime_type:"image/png",preview_url:null},destination:{destination_type:"external_url",external_url:"https://advertiser.example"},latest_decision:null}]);
    render(<MemoryRouter><AdminAdvertisingReviewPage/></MemoryRouter>);
    expect(await screen.findByText("Approval unavailable until canonical media preview is available.")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Approve"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Reject"})).toBeEnabled();
  });

  it("renders the advertiser-safe review reason in campaign detail without an internal note",async()=>{
    vi.mocked(getAdminAdvertisingCampaignDetail).mockResolvedValue({authority:"ads_v2",campaign:{name:"Campaign",status:"draft"},business:{display_name:"Business"},ad_account:{name:"Ads"},ad_sets:[],destinations:[],ads:[{id:"11111111-1111-4111-8111-111111111111",name:"Ad",status:"draft",review_status:"rejected",creative:{format:"image"},latest_review:{reason_code:"misleading"}}],finance:null,analytics:{impressions:0,clicks:0,conversions:0},readiness:{campaign_activation_implemented:true,activation_enabled:false,automatic_transitions_enabled:false}});
    render(<MemoryRouter initialEntries={["/advertising/campaigns/11111111-1111-4111-8111-111111111111"]}><AdminAdvertisingCampaignDetailPage/></MemoryRouter>);
    expect(await screen.findByText("rejected · misleading")).toBeInTheDocument();
    expect(screen.queryByText(/internal moderator note/i)).not.toBeInTheDocument();
    expect(screen.getByText("No finance draft.")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows launch blockers separately from unavailable targeting capabilities",async()=>{
    render(<MemoryRouter><AdminAdvertisingHealthPage/></MemoryRouter>);
    expect(await screen.findByText("age authority unavailable")).toBeInTheDocument();
    expect(screen.getByText("geo matching disabled")).toBeInTheDocument();
    expect(screen.getByText("nelyon-ads-targeting-v2")).toBeInTheDocument();
    expect(screen.getByText("daypart targeting enabled")).toBeInTheDocument();
    expect(screen.getByText("frequency targeting enabled")).toBeInTheDocument();
    expect(screen.getAllByText("BLOCKER").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NOT ENABLED").length).toBeGreaterThan(0);
  });

  it("gates every Advertising navigation destination with its independent canonical capability",()=>{
    const advertising=adminLinks.filter((link)=>link.group==="advertising");
    expect(advertising.map((link)=>[link.to,link.capability])).toEqual([
      ["/advertising","advertising.ads.read"],
      ["/advertising/campaigns","advertising.ads.read"],
      ["/advertising/review","content.items.read"],
      ["/advertising/analytics","advertising.ads.read"],
      ["/advertising/health","advertising.ads.read"],
      ["/advertising/finance-health","finance.reconciliation.read"],
    ]);
  });
});
