import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationConfirm } from "../components/OperationConfirm";
import {
  resolveDispute,
  validateDisputeOperationReceipt,
} from "../lib/adminApi";
import { supabase } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

const id = (suffix: string) =>
  `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const at = "2026-08-14T12:00:00.000Z";

const intermediateReceipt = () => ({
  kind: "intermediate_review",
  finalDecision: null,
  reviewAction: {
    id: id("1"),
    dispute_id: id("2"),
    order_id: id("3"),
    action: "manual_review_requested",
    reason_code: "needs_review",
    metadata: { review_type: "held" },
    created_at: at,
  },
  dispute: { status: "under_review", resolved_at: null },
  moneyMoved: false,
  requiresHumanFollowUp: true,
});

const finalReceipt = () => ({
  kind: "final_resolution",
  finalDecision: {
    id: id("4"),
    dispute_id: id("2"),
    order_id: id("3"),
    outcome: "refund_buyer",
    reason_code: "support_refund",
    financial_result: {
      money_moved: true,
      refund_amount: "10.00000000",
      financial_transaction_id: id("5"),
      seller_allocation: "refunded",
      creator_allocation: "refunded",
      platform_allocation: "refunded",
    },
    decided_at: at,
  },
  dispute: { status: "resolved", resolved_at: at },
  order: { status: "refunded" },
  payment: { status: "refunded", gross_amount: "10.00000000" },
  allocation: {
    status: "refunded",
    gross_amount: "10.00000000",
    seller_net_amount: "8.00000000",
    creator_commission_amount: "1.00000000",
    platform_fee_amount: "1.00000000",
  },
});

const releaseReceipt = (alreadyReleased: boolean) => ({
  ...finalReceipt(),
  finalDecision: {
    ...finalReceipt().finalDecision,
    outcome: "release_seller",
    financial_result: {
      money_moved: true,
      settlement: alreadyReleased
        ? {
            settlement: { id: id("6"), status: "completed", released_at: at },
            money_moved: false,
            already_released: true,
          }
        : {
            settlement: { id: id("6"), status: "released", released_at: at },
            allocation: { status: "released", gross_amount: "10.00000000" },
            money_moved: true,
            actor_role: "admin",
          },
    },
  },
});

const reversalReceipt = () => ({
  ...finalReceipt(),
  finalDecision: {
    ...finalReceipt().finalDecision,
    financial_result: {
      money_moved: true,
      reversal_id: id("7"),
      buyer_refund_transaction_id: id("8"),
      gross_refund_amount: "10.00000000",
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("B8B-C1 dispute operation receipt validation", () => {
  it("accepts the canonical intermediate and final receipt families", () => {
    expect(validateDisputeOperationReceipt(intermediateReceipt())).toEqual(
      intermediateReceipt(),
    );
    expect(validateDisputeOperationReceipt(finalReceipt())).toEqual(
      finalReceipt(),
    );
    expect(validateDisputeOperationReceipt(reversalReceipt())).toEqual(
      reversalReceipt(),
    );
  });

  it("accepts fresh and post-settlement already-released seller receipts", () => {
    expect(validateDisputeOperationReceipt(releaseReceipt(false))).toEqual(
      releaseReceipt(false),
    );
    expect(validateDisputeOperationReceipt(releaseReceipt(true))).toEqual(
      releaseReceipt(true),
    );
  });

  it("rejects malformed post-settlement already-released receipts", () => {
    const malformedUuid = releaseReceipt(true);
    malformedUuid.finalDecision.financial_result.settlement.settlement.id = "bad";
    expect(() => validateDisputeOperationReceipt(malformedUuid)).toThrow(
      /Respuesta inv.lida/,
    );

    const malformedTimestamp = releaseReceipt(true);
    malformedTimestamp.finalDecision.financial_result.settlement.settlement.released_at = "bad";
    expect(() => validateDisputeOperationReceipt(malformedTimestamp)).toThrow(
      /Respuesta inv.lida/,
    );

    const movedAgain = releaseReceipt(true);
    movedAgain.finalDecision.financial_result.settlement.money_moved = true;
    expect(() => validateDisputeOperationReceipt(movedAgain)).toThrow(
      /Respuesta inv.lida/,
    );
  });

  it("keeps fresh release allocation and actor role mandatory", () => {
    const missingAllocation = releaseReceipt(false);
    delete missingAllocation.finalDecision.financial_result.settlement.allocation;
    expect(() => validateDisputeOperationReceipt(missingAllocation)).toThrow(
      /Respuesta inv.lida/,
    );

    const missingActor = releaseReceipt(false);
    delete missingActor.finalDecision.financial_result.settlement.actor_role;
    expect(() => validateDisputeOperationReceipt(missingActor)).toThrow(
      /Respuesta inv.lida/,
    );
  });

  it("rejects malformed intermediate review data", () => {
    expect(() =>
      validateDisputeOperationReceipt({
        ...intermediateReceipt(),
        reviewAction: {
          ...intermediateReceipt().reviewAction,
          metadata: [],
        },
      }),
    ).toThrow(/Respuesta inv.lida/);
  });

  it("rejects malformed final UUID, money, timestamp, and allocation", () => {
    const malformedUuid = finalReceipt();
    malformedUuid.finalDecision.id = "not-a-uuid";
    expect(() => validateDisputeOperationReceipt(malformedUuid)).toThrow(
      /Respuesta inv.lida/,
    );

    const malformedMoney = finalReceipt();
    malformedMoney.payment.gross_amount = "NaN";
    expect(() => validateDisputeOperationReceipt(malformedMoney)).toThrow(
      /Respuesta inv.lida/,
    );

    const malformedTimestamp = finalReceipt();
    malformedTimestamp.finalDecision.decided_at = "not-a-date";
    expect(() => validateDisputeOperationReceipt(malformedTimestamp)).toThrow(
      /Respuesta inv.lida/,
    );

    const malformedAllocation = finalReceipt();
    malformedAllocation.allocation.creator_commission_amount = {} as never;
    expect(() => validateDisputeOperationReceipt(malformedAllocation)).toThrow(
      /Respuesta inv.lida/,
    );
  });

  it("resolveDispute rejects malformed RPC data instead of returning it", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { kind: "final_resolution", finalDecision: { id: "bad" } },
      error: null,
    } as never);
    await expect(
      resolveDispute({
        id: id("2"),
        outcome: "refund_buyer",
        reason: "support_refund",
        idempotencyKey: id("9"),
      }),
    ).rejects.toThrow(/Respuesta inv.lida/);
  });
});

describe("B8B-C1 safe operation UX", () => {
  it("shows malformed receipt as an error and preserves retry idempotency", async () => {
    const keys: string[] = [];
    let attempt = 0;
    const onRun = vi.fn(async (_action: string, _reason: string, key: string) => {
      keys.push(key);
      attempt += 1;
      validateDisputeOperationReceipt(
        attempt === 1
          ? { kind: "final_resolution", finalDecision: { id: "bad" } }
          : finalReceipt(),
      );
    });
    render(
      <OperationConfirm
        title="Resolver"
        maxReasonLength={100}
        actions={[
          {
            value: "refund_buyer",
            label: "Reembolsar",
            reasonRequired: true,
          },
        ]}
        onRun={onRun}
      />,
    );
    await userEvent.type(screen.getByLabelText("Motivo"), "support_refund");
    await userEvent.click(
      screen.getByRole("button", { name: /Revisar operaci/ }),
    );
    expect(onRun).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reembolsar" }));
    expect(await screen.findByText(/Respuesta inv.lida/)).toBeInTheDocument();
    expect(screen.queryByText(/confirmada por el servidor/i)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Revisar operaci/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Reembolsar" }));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(2));
    expect(keys[1]).toBe(keys[0]);
    expect(
      await screen.findByText(/confirmada por el servidor/i),
    ).toBeInTheDocument();
  });

  it("enforces the exact domain reason maximum before submission", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <OperationConfirm
        title="Disputa"
        maxReasonLength={100}
        actions={[{ value: "reject_claim", label: "Rechazar", reasonRequired: true }]}
        onRun={onRun}
      />,
    );
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "d".repeat(101) },
    });
    await userEvent.click(
      screen.getByRole("button", { name: /Revisar operaci/ }),
    );
    expect(screen.getByText(/100 caracteres/)).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();

    unmount();
    render(
      <OperationConfirm
        title="Producto"
        maxReasonLength={500}
        actions={[{ value: "suspend", label: "Suspender", reasonRequired: true }]}
        onRun={onRun}
      />,
    );
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "p".repeat(500) },
    });
    await userEvent.click(
      screen.getByRole("button", { name: /Revisar operaci/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Suspender" }));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Motivo")).toHaveAttribute("maxlength", "500");
  });

  it("opens an accessible dialog without mutation and cancel restores safety", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(
      <OperationConfirm
        title="Producto"
        maxReasonLength={500}
        actions={[{ value: "suspend", label: "Suspender", reasonRequired: true, danger: true }]}
        onRun={onRun}
      />,
    );
    await userEvent.type(screen.getByLabelText("Motivo"), "incumplimiento");
    const trigger = screen.getByRole("button", { name: /Revisar operaci/ });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Producto" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(onRun).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("confirms exactly once and disables repeat submission while pending", async () => {
    let resolveRun!: () => void;
    const onRun = vi.fn(
      () => new Promise<void>((resolve) => { resolveRun = resolve; }),
    );
    render(
      <OperationConfirm
        title="Disputa"
        maxReasonLength={100}
        actions={[{ value: "reject_claim", label: "Rechazar reclamo", reasonRequired: true, danger: true }]}
        onRun={onRun}
      />,
    );
    await userEvent.type(screen.getByLabelText("Motivo"), "sin evidencia");
    await userEvent.click(screen.getByRole("button", { name: /Revisar operaci/ }));
    const confirm = screen.getByRole("button", { name: "Rechazar reclamo" });
    await userEvent.click(confirm);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    fireEvent.click(confirm);
    expect(onRun).toHaveBeenCalledTimes(1);
    resolveRun();
    expect(await screen.findByText(/confirmada por el servidor/i)).toBeInTheDocument();
  });
});
