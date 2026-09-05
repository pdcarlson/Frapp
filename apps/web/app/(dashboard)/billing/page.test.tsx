import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// #336: the invoice table's bulk bar used to toast "not available yet" for
// both actions, and the header carried a decoy "Create Invoice" button beside
// InvoiceAdminCard's real, working one. Export CSV now genuinely exports;
// Send reminder and the header button are gone (no manual-remind endpoint
// exists, and the working Create Invoice dialog lives one card down).
//
// #707: the page used to compute its Overdue count/filter from a literal
// `invoice.status === "OVERDUE"` comparison — but the invoice status enum is
// DRAFT | OPEN | PAID | VOID, so that comparison was always false. Overdue is
// server-derived (grace-aware) via GET /v1/invoices/overdue, mirroring
// invoice-admin-card.tsx's overdueIds pattern.

const { downloadCsvSpy } = vi.hoisted(() => ({ downloadCsvSpy: vi.fn() }));
vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
  return { ...actual, downloadCsv: downloadCsvSpy };
});

const INVOICES = [
  {
    id: "inv-1",
    title: "Fall dues",
    amount: 15000,
    status: "OPEN",
    due_date: "2026-09-15",
    user_id: "user-1",
  },
  {
    id: "inv-2",
    title: "Spring dues",
    amount: 15000,
    status: "PAID",
    due_date: "2026-04-15",
    user_id: "user-2",
  },
];

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

const billingStatusQuery = {
  data: { subscription_status: "active", stripe_customer_id: null, subscription_id: null },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const invoicesQuery: { data: unknown; isLoading: boolean; isError: boolean; refetch: () => void } = {
  data: INVOICES,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const currentUserQuery: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = {
  data: { id: "user-1" },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const useOverdueInvoices = vi.fn();

vi.mock("@repo/hooks", () => ({
  useBillingStatus: () => billingStatusQuery,
  useInvoices: () => invoicesQuery,
  useCurrentUser: () => currentUserQuery,
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

const networkState = { isOffline: false };
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => networkState,
}));

vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: () => false,
}));

// These children own their own gates and queries; stubbing them isolates
// BillingPage's own table, decoy-button removal, bulk-export wiring, and
// overdue derivation.
vi.mock("@/components/billing/invoice-admin-card", () => ({
  InvoiceAdminCard: () => <div data-testid="invoice-admin-card" />,
}));
vi.mock("@/components/billing/subscription-checkout-card", () => ({
  SubscriptionCheckoutCard: () => <div data-testid="subscription-checkout-card" />,
}));
vi.mock("@/components/billing/pay-invoice-dialog", () => ({
  PayInvoiceDialog: () => <div data-testid="pay-invoice-dialog" />,
}));

import BillingPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  invoicesQuery.data = INVOICES;
  invoicesQuery.isLoading = false;
  invoicesQuery.isError = false;
  networkState.isOffline = false;
  currentUserQuery.data = { id: "user-1" };
  useOverdueInvoices.mockReturnValue({ data: [], isError: false });
});

describe("BillingPage decoy Create Invoice button (#336/#1200)", () => {
  it("does not render a header Create Invoice trigger — the real one lives in InvoiceAdminCard", () => {
    render(<BillingPage />);

    expect(
      screen.queryByRole("button", { name: /^create invoice$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("invoice-admin-card")).toBeInTheDocument();
  });
});

describe("BillingPage invoice bulk actions", () => {
  function selectFirstInvoice() {
    fireEvent.click(screen.getByRole("checkbox", { name: /select fall dues/i }));
  }

  it("never renders a Send reminder control — no manual-remind endpoint exists", () => {
    render(<BillingPage />);
    selectFirstInvoice();

    expect(
      screen.queryByRole("button", { name: /send reminder/i }),
    ).not.toBeInTheDocument();
  });

  it("exports the selected invoice as a downloaded CSV", () => {
    render(<BillingPage />);
    selectFirstInvoice();
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    expect(downloadCsvSpy).toHaveBeenCalledTimes(1);
    const [rows, prefix] = downloadCsvSpy.mock.calls[0] as [
      Record<string, string>[],
      string,
    ];
    expect(prefix).toBe("invoices");
    // Only the selected row — the unselected paid invoice is not exported.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Title: "Fall dues" });
  });

  it("drops the selection when the status filter changes, so a stale count can't export the wrong rows", () => {
    render(<BillingPage />);
    selectFirstInvoice();
    expect(screen.getByText(/1 invoice selected/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/invoice status filter/i), {
      target: { value: "paid" },
    });

    expect(screen.queryByText(/invoice.*selected/i)).not.toBeInTheDocument();
  });
});

describe("billing page overdue derivation (#707)", () => {
  beforeEach(() => {
    invoicesQuery.data = [OPEN_INVOICE, OPEN_OVERDUE_INVOICE, PAID_INVOICE];
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

/**
 * #1621 — OFFLINE must not discard rows TanStack is still holding.
 *
 * Billing is the subtle member of that set, because two of its four reads are
 * `billing:view`-gated and permanently `undefined` for most members. Which
 * reads the gate names is therefore the whole of the behaviour here, so these
 * cases pin the call site rather than the shared predicate.
 */
describe("BillingPage offline read path (#1621)", () => {
  it("keeps rendering cached invoices when it goes offline", () => {
    networkState.isOffline = true;

    render(<BillingPage />);

    expect(
      screen.queryByText("Billing workspace unavailable offline"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Fall dues")).toBeInTheDocument();
  });

  it("still renders offline when the permission-gated status read is uncached", () => {
    // The case that makes the naive gate wrong for most of the userbase:
    // `BillingController` is class-level `@RequirePermissions(billing:view)`,
    // so a member without it never has `statusQuery.data`. Conjoining it would
    // withhold the page from exactly the members `canPay` exists to serve.
    networkState.isOffline = true;
    billingStatusQuery.data = undefined as never;

    render(<BillingPage />);

    expect(
      screen.queryByText("Billing workspace unavailable offline"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Fall dues")).toBeInTheDocument();

    billingStatusQuery.data = {
      subscription_status: "active",
      stripe_customer_id: null,
      subscription_id: null,
    };
  });

  it("shows the offline card when the invoices read is uncached", () => {
    networkState.isOffline = true;
    invoicesQuery.data = undefined;

    render(<BillingPage />);

    expect(
      screen.getByText("Billing workspace unavailable offline"),
    ).toBeInTheDocument();
  });

  it("shows the offline card when the caller's identity is uncached", () => {
    // Pay is gated on `invoice.user_id === currentUserId`. Rendering without
    // it shows a member their own OPEN invoice with no way to pay it and
    // nothing saying why.
    networkState.isOffline = true;
    currentUserQuery.data = undefined;

    render(<BillingPage />);

    expect(
      screen.getByText("Billing workspace unavailable offline"),
    ).toBeInTheDocument();
  });

  it("reports overdue as unavailable, not zero, when offline with no cached overdue list", () => {
    // A paused query is `isPending`, never `isError`, so the existing
    // `isError` flag alone goes false here and `overdueIds` degrades to an
    // empty set — "nothing is overdue" asserted from a read that never ran.
    networkState.isOffline = true;
    useOverdueInvoices.mockReturnValue({ data: undefined, isError: false });

    render(<BillingPage />);

    expect(screen.getByText("Overdue: —")).toBeInTheDocument();
    expect(screen.queryByText(/^Overdue: \d/)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Overdue" })).toBeDisabled();
  });
});
