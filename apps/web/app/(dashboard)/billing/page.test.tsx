import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// #336: the invoice table's bulk bar used to toast "not available yet" for
// both actions, and the header carried a decoy "Create Invoice" button beside
// InvoiceAdminCard's real, working one. Export CSV now genuinely exports;
// Send reminder and the header button are gone (no manual-remind endpoint
// exists, and the working Create Invoice dialog lives one card down).

const { downloadBlobSpy } = vi.hoisted(() => ({ downloadBlobSpy: vi.fn() }));
vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
  return { ...actual, downloadBlob: downloadBlobSpy };
});

const billingStatusQuery = {
  data: { subscription_status: "active", stripe_customer_id: null, subscription_id: null },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const invoicesQuery: { data: unknown; isLoading: boolean; isError: boolean; refetch: () => void } = {
  data: [],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const currentUserQuery = {
  data: { id: "user-1" },
  isLoading: false,
  isError: false,
};

vi.mock("@repo/hooks", () => ({
  useBillingStatus: () => billingStatusQuery,
  useInvoices: () => invoicesQuery,
  useCurrentUser: () => currentUserQuery,
  useCurrentChapter: () => ({
    data: { subscription_status: "active", past_due_since: null },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

const networkState = { isOffline: false };
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => networkState,
}));

vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: () => false,
}));

// These children own their own gates and queries; stubbing them isolates
// BillingPage's own table, decoy-button removal, and bulk-export wiring.
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

beforeEach(() => {
  vi.clearAllMocks();
  invoicesQuery.data = INVOICES;
  invoicesQuery.isLoading = false;
  invoicesQuery.isError = false;
  networkState.isOffline = false;
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

  it("exports the selected invoice as a downloaded CSV", async () => {
    render(<BillingPage />);
    selectFirstInvoice();
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    expect(downloadBlobSpy).toHaveBeenCalledTimes(1);
    const [blob, filename] = downloadBlobSpy.mock.calls[0] as [Blob, string];
    expect(filename).toMatch(/^frapp-invoices-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const csv = await blob.text();
    // Only the selected row — the unselected paid invoice is not exported.
    expect(csv).toContain("Fall dues");
    expect(csv).not.toContain("Spring dues");
  });
});
