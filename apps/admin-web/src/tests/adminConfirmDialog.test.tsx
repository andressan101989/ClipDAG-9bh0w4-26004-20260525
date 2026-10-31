import {fireEvent,render,screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it,vi} from "vitest";
import {ConfirmDialog} from "../components/ConfirmDialog";

it("isolates background navigation and restores exact prior attributes and trigger focus",async()=>{
 const prior=document.createElement("aside");prior.setAttribute("inert","");prior.setAttribute("aria-hidden","false");document.body.append(prior);
 const cancel=vi.fn(),confirm=vi.fn();
 const ui=(open:boolean)=><><button>Open confirmation</button><a href="/outside">Outside navigation</a><ConfirmDialog open={open} title="Remove factor?" consequence="Session must refresh." actionLabel="Remove" onCancel={cancel} onConfirm={confirm}/></>;
 try{
  const view=render(ui(false)),trigger=screen.getByRole("button",{name:"Open confirmation"}),navigation=screen.getByRole("link",{name:"Outside navigation"});trigger.focus();view.rerender(ui(true));
  expect(navigation.closest("[inert]")).not.toBeNull();expect(navigation.closest('[aria-hidden="true"]')).not.toBeNull();expect(screen.queryByRole("link",{name:"Outside navigation"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Cancelar"})).toHaveFocus();await userEvent.tab({shift:true});expect(screen.getByRole("button",{name:"Remove"})).toHaveFocus();
  view.rerender(ui(false));expect(navigation.closest("[inert]")).toBeNull();expect(navigation.closest("[aria-hidden]")).toBeNull();expect(prior).toHaveAttribute("inert");expect(prior).toHaveAttribute("aria-hidden","false");expect(trigger).toHaveFocus();
 }finally{prior.remove()}
});

it("retains a valid focus target when pending disables both actions and blocks dismissal",async()=>{
 const cancel=vi.fn(),confirm=vi.fn(),view=render(<ConfirmDialog open title="Pending removal" consequence="Wait for the server." actionLabel="Remove" pending onCancel={cancel} onConfirm={confirm}/>);
 const dialog=screen.getByRole("dialog",{name:"Pending removal"});expect(dialog).toHaveFocus();expect(dialog).toHaveAttribute("tabindex","-1");
 expect(screen.getByRole("button",{name:"Cancelar"})).toBeDisabled();expect(screen.getByRole("button",{name:"Procesando…"})).toBeDisabled();
 await userEvent.tab();expect(dialog).toHaveFocus();await userEvent.tab({shift:true});expect(dialog).toHaveFocus();
 fireEvent.keyDown(document,{key:"Escape"});fireEvent.mouseDown(dialog.parentElement!);expect(cancel).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();
 view.unmount();
});

it("moves focus from a disabled pending action to the dialog then restores enabled focus and background on completion",async()=>{
 const ui=(open:boolean,pending:boolean)=><><button>Decision trigger</button><a href="/outside">Background route</a><ConfirmDialog open={open} pending={pending} title="Review factor" consequence="Server decides." actionLabel="Remove" onCancel={vi.fn()} onConfirm={vi.fn()}/></>;
 const view=render(ui(false,false)),trigger=screen.getByRole("button",{name:"Decision trigger"});trigger.focus();view.rerender(ui(true,false));screen.getByRole("button",{name:"Remove"}).focus();
 view.rerender(ui(true,true));const dialog=screen.getByRole("dialog",{name:"Review factor"});expect(dialog).toHaveFocus();await userEvent.tab();expect(dialog).toHaveFocus();
 view.rerender(ui(true,false));expect(screen.getByRole("button",{name:"Cancelar"})).toHaveFocus();view.rerender(ui(false,false));expect(trigger).toHaveFocus();expect(screen.getByRole("link",{name:"Background route"}).closest("[inert]")).toBeNull();
});
it("announces the current safe command error inside the isolated dialog",()=>{
 render(<><p role="alert">Old background error</p><ConfirmDialog open error="The server rejected this request." title="Decision rejected" consequence="The server remains authoritative." actionLabel="Retry" onCancel={vi.fn()} onConfirm={vi.fn()}/></>);
 const dialog=screen.getByRole("dialog",{name:"Decision rejected"});expect(within(dialog).getByRole("alert")).toHaveTextContent("The server rejected this request.");expect(screen.getAllByRole("alert")).toHaveLength(1);
});
