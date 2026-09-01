import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

// #707: the page used to compute its Overdue count/filter from a literal
// `invoice.status === "OVERDUE"` comparison — but the invoice status enum is
// DRAFT | OPEN | PAID | VOID, so that comparison was always false. Overdue is
// server-derived (grace-aware) via GET /v1/invoices/overdue, mirroring
// invoice-admin-card.tsx's overdueIds pattern.

const OPEN_INVOICE = {
  id: "inv-open",
  title: "Fall dues",
  amount: 5000,
  status: "OPEN" as const,
  due_date: "2026-12-01",
  user_id: "u-1",
};

const OPEN_OVERDUE_INVOICE = {
  id: "inv-overdue",
  title: "Spring dues",
  amount: 7500,
  status: "OPEN" as const,
  due_date: "2026-01-01",
  user_id: "u-2",
};

const PAID_INVOICE = {
  id: "inv-paid",
  title: "Winter dues",
  amount: 3000,
  status: "PAID" as const,
  due_date: "2026-02-01",
  user_id: "u-3",
};

const useOverdueInvoices = vi.fn();

vi.mock("@repo/hooks", () => ({
  useBillingStatus: () => ({ data: {}, isLoading: false, isError: false }),
  useCurrentUser: () => ({ data: { id: "u-1" }, isLoading: false }),
  useInvoices: () => ({
    data: [OPEN_INVOICE, OPEN_OVERDUE_INVOICE, PAID_INVOICE],
    isLoading: false,
    isError: false,
  }),
  useOverdueInvoices: () => useOverdueInvoices(),
}));

vi.mock("@/lib/hooks/use-subscription-write-state", () => ({
  useChapterSubscription: () => ({
    status: "active",
    pastDueSince: null,
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false, isDegraded: false }),
}));

vi.mock("@/lib/stripe", () => ({ isStripeConfigured: () => true }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Out of scope for this suite (own hook chains, own test files) — stubbed so
// this page's own overdue derivation can be tested in isolation.
vi.mock("@/components/billing/subscription-checkout-card", () => ({
  SubscriptionCheckoutCard: () => null,
}));
vi.mock("@/components/billing/invoice-admin-card", () => ({
  InvoiceAdminCard: () => null,
}));
vi.mock("@/components/billing/pay-invoice-dialog", () => ({
  PayInvoiceDialog: () => null,
}));

const { default: BillingPage } = await import("./page");

describe("billing page overdue derivation", () => {
  beforeEach(() => {
    useOverdueInvoices.mockReturnValue({
      data: [OPEN_OVERDUE_INVOICE],
      isError: false,
    });
  });

  it("counts Overdue from useOverdueInvoices, not a literal invoice.status comparison", () => {
    render(<BillingPage />);

    // No invoice's status is ever "OVERDUE" (the enum is DRAFT|OPEN|PAID|VOID),
    // so a count that reached 1 here can only have come from the overdue query.
    expect(screen.getByText("Overdue: 1")).toBeInTheDocument();
    expect(screen.getByText("Open: 2")).toBeInTheDocument();
    expect(screen.getByText("Paid: 1")).toBeInTheDocument();
  });

  it("the Overdue status filter returns exactly the server-reported overdue invoices", async () => {
    render(<BillingPage />);

    await userEvent.selectOptions(
      screen.getByLabelText("Invoice status filter"),
      "overdue",
    );

    expect(screen.getByText("Spring dues")).toBeInTheDocument();
    expect(screen.queryByText("Fall dues")).not.toBeInTheDocument();
    expect(screen.queryByText("Winter dues")).not.toBeInTheDocument();
  });

  it("shows overdue status as unavailable rather than a confidently-wrong zero when the overdue query errors", () => {
    // GET /invoices/overdue requires billing:view, which most members do not
    // hold — this page is not admin-only, so this 403 is the common case for
    // ordinary members, not a rare transient failure. A silent "0" here would
    // reintroduce #707's exact bug for them.
    useOverdueInvoices.mockReturnValue({ data: undefined, isError: true });

    render(<BillingPage />);

    expect(screen.getByText("Overdue: —")).toBeInTheDocument();
    expect(screen.queryByText(/^Overdue: \d/)).not.toBeInTheDocument();
    const overdueOption = screen.getByRole("option", { name: "Overdue" });
    expect(overdueOption).toBeDisabled();
    // The rest of the table is unaffected by the overdue query's own failure.
    expect(screen.getByText("Fall dues")).toBeInTheDocument();
  });

  it("selects the Overdue count and filter as usual once the overdue query succeeds", () => {
    render(<BillingPage />);

    const overdueOption = screen.getByRole("option", { name: "Overdue" });
    expect(overdueOption).toBeEnabled();
  });
});
