import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from
// the wire format to the disabled trigger.
const OPEN_INVOICE = {
  id: "inv-1",
  chapter_id: "chap-1",
  user_id: "u-1",
  title: "Fall 2026 dues",
  description: null,
  amount: 12000,
  status: "OPEN" as const,
  due_date: "2026-09-01",
  paid_at: null,
  stripe_payment_intent_id: null,
  created_at: "2026-08-01T00:00:00Z",
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useInvoices: () => ({
    data: [OPEN_INVOICE],
    isPending: false,
    isError: false,
  }),
  useOverdueInvoices: () => ({ data: [], isError: false }),
  useMembers: () => ({ data: [] }),
  useCreateInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTransitionInvoiceStatus: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { InvoiceAdminCard } = await import("./invoice-admin-card");

function setChapter(
  subscription_status: string,
  past_due_since: string | null = null,
) {
  mockCurrentChapter.mockReturnValue({
    data: { subscription_status, past_due_since },
    isPending: false,
    isError: false,
  });
}

function setChapterLoading() {
  mockCurrentChapter.mockReturnValue({
    data: undefined,
    isPending: true,
    isError: false,
  });
}

function trigger() {
  return screen.getByRole("button", { name: /create invoice/i });
}

describe("InvoiceAdminCard subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves invoicing alone on an active chapter", () => {
    setChapter("active");
    render(<InvoiceAdminCard />);

    expect(trigger()).toBeEnabled();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("disables the trigger and names blocker plus recovery when incomplete", async () => {
    setChapter("incomplete");
    render(<InvoiceAdminCard />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(screen.getByText(/complete checkout/i)).toBeInTheDocument();

    // §5 rule 4: disabled, not hidden — the card itself is still there.
    expect(screen.getByText(/member invoices/i)).toBeInTheDocument();

    // And the dialog must not open onto a doomed action.
    await userEvent.click(trigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ties the disabled trigger to its explanation for screen readers", () => {
    setChapter("incomplete");
    render(<InvoiceAdminCard />);

    const describedBy = trigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("blocks paid-ops invoicing immediately on past_due, grace or not", () => {
    setChapter("past_due", new Date().toISOString());
    render(<InvoiceAdminCard />);

    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("points a canceled chapter at the portal rather than a checkout that would double-subscribe", () => {
    setChapter("canceled");
    render(<InvoiceAdminCard />);

    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByText(/billing portal/i)).toBeInTheDocument();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common
    // path to the very 403 this gate exists to prevent: if the trigger paints
    // enabled for that round trip, a fast click still reaches a doomed form.
    setChapterLoading();
    render(<InvoiceAdminCard />);

    expect(trigger()).toBeDisabled();
    // No blocked explanation yet — nothing has established a reason.
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("gates the other paid-ops writes, not just Create", () => {
    // POST /v1/invoices/:id/status is equally subscription-gated, so leaving
    // these live would have the card claim writes are blocked while offering
    // three of them.
    setChapter("incomplete");
    render(<InvoiceAdminCard />);

    expect(screen.getByRole("button", { name: /mark paid/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^void$/i })).toBeDisabled();
  });

  it("leaves the row actions alone on an active chapter", () => {
    setChapter("active");
    render(<InvoiceAdminCard />);

    expect(screen.getByRole("button", { name: /mark paid/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^void$/i })).toBeEnabled();
  });

  it("closes an already-open dialog when the subscription lapses under it", async () => {
    // Radix fires onOpenChange only on an open/close request, so a background
    // refetch that revokes the write cannot be caught there.
    setChapter("active");
    const { rerender } = render(<InvoiceAdminCard />);
    await userEvent.click(trigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    setChapter("past_due", new Date().toISOString());
    rerender(<InvoiceAdminCard />);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("fails open when the chapter record cannot be read", () => {
    // A failed chapter fetch must not lock a paying chapter out of its own
    // billing screen; the server guard is still the enforcement.
    mockCurrentChapter.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });
    render(<InvoiceAdminCard />);

    expect(trigger()).toBeEnabled();
  });
});
