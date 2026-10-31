import {render,screen,within} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {expect,it,vi} from "vitest";
import {useAdminAuth} from "../auth/AdminAuthProvider";
import {AdminOperationalStatusPage} from "../pages/AdminOperationalStatusPage";
vi.mock("../auth/AdminAuthProvider",()=>({useAdminAuth:vi.fn()}));
it("marks external authorities unavailable without activation controls and links only authorized contextual routes",()=>{
 vi.mocked(useAdminAuth).mockReturnValue({hasCapability:(cap:string)=>cap==="finance.ledger.read"} as never);
 render(<MemoryRouter><AdminOperationalStatusPage/></MemoryRouter>);
 for(const name of ["Stripe","Banuba","Creator Studio","ALGO-6"]){const panel=screen.getByRole("region",{name});expect(within(panel).getByText(/No disponible/)).toBeInTheDocument();expect(within(panel).queryByRole("button")).not.toBeInTheDocument()}
 expect(screen.getByRole("link",{name:/Comisiones y regalos LIVE/})).toHaveAttribute("href","/finance");
 expect(screen.queryByRole("link",{name:/Creator Commerce/})).not.toBeInTheDocument();
 expect(screen.getByRole("link",{name:/Seguridad y MFA/})).toHaveAttribute("href","/system/security");
});
