import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BusinessConfirmDialog } from "../components/BusinessConfirmDialog";

describe("Business confirmation dialog accessibility", () => {
  it("focuses the safe action, traps keyboard focus, closes with Escape, and returns focus", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    const { rerender } = render(<><button type="button">Open cancellation</button><BusinessConfirmDialog open={false} title="Cancel Brand?" description="Cannot be resumed." confirmLabel="Confirm cancellation" onCancel={cancel} onConfirm={vi.fn()} danger /></>);
    const trigger = screen.getByRole("button", { name: "Open cancellation" });
    trigger.focus();
    rerender(<><button type="button">Open cancellation</button><BusinessConfirmDialog open title="Cancel Brand?" description="Cannot be resumed." confirmLabel="Confirm cancellation" cancelLabel="Keep campaign" onCancel={cancel} onConfirm={vi.fn()} danger /></>);
    expect(screen.getByRole("button", { name: "Keep campaign" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Confirm cancellation" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
    rerender(<><button type="button">Open cancellation</button><BusinessConfirmDialog open={false} title="Cancel Brand?" description="Cannot be resumed." confirmLabel="Confirm cancellation" onCancel={cancel} onConfirm={vi.fn()} danger /></>);
    expect(trigger).toHaveFocus();
  });

  it("announces pending state and blocks dismiss/duplicate confirmation", () => {
    const cancel = vi.fn(), confirm = vi.fn();
    render(<BusinessConfirmDialog open title="Submit?" description="Exact ad." confirmLabel="Confirm submission" pending pendingLabel="Submitting…" onCancel={cancel} onConfirm={confirm} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button", { name: "Submitting…" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});
