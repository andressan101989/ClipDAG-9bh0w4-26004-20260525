import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState, LoadingState, StaleDataNotice } from "../components/PageState";

describe("Admin Ads resilient states", () => {
  it("announces initial loading and exposes a labelled retry for initial errors", () => {
    const retry = vi.fn();
    const { rerender } = render(<LoadingState label="Loading review queue…" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    rerender(<ErrorState message="We couldn't load the review queue. Try again." onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't load");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps stale data context as a non-destructive status with retry", () => {
    const retry = vi.fn();
    render(<StaleDataNotice message="Showing saved data because refresh failed." onRetry={retry} />);
    expect(screen.getByRole("status")).toHaveTextContent("Showing saved data");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("traps focus, closes with Escape, and returns focus to the decision trigger", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    const { rerender } = render(<><button type="button">Reject</button><ConfirmDialog open={false} title="Reject?" consequence="Decision." actionLabel="Reject ad" onCancel={cancel} onConfirm={vi.fn()} /></>);
    const trigger = screen.getByRole("button", { name: "Reject" }); trigger.focus();
    rerender(<><button type="button">Reject</button><ConfirmDialog open title="Reject?" consequence="Decision." actionLabel="Reject ad" onCancel={cancel} onConfirm={vi.fn()} /></>);
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Reject ad" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    rerender(<><button type="button">Reject</button><ConfirmDialog open={false} title="Reject?" consequence="Decision." actionLabel="Reject ad" onCancel={cancel} onConfirm={vi.fn()} /></>);
    expect(trigger).toHaveFocus();
  });
});
