import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const overdueQuery: {
  data: unknown;
  isError: boolean;
  isFetching: boolean;
} = { data: [], isError: false, isFetching: false };

const { mockCurrentChapter, mockTransitionMutate } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockTransitionMutate: vi.fn().mockResolvedValue({}),
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
  useOverdueInvoices: () => overdueQuery,
  useMembers: () => ({ data: [] }),
  useCreateInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTransitionInvoiceStatus: () => ({
    mutateAsync: mockTransitionMutate,
    isPending: false,
    variables: undefined,
  }),
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

const chapter = chapterSubscription(mockCurrentChapter);

function setChapter(
  subscription_status: string,
  past_due_since: string | null = null,
) {
  chapter.raw(subscription_status, past_due_since);
}

function setChapterLoading() {
  chapter.loading();
}

function trigger() {
  return screen.getByRole("button", { name: /create invoice/i });
}

beforeEach(() => {
  overdueQuery.data = [];
  overdueQuery.isError = false;
  overdueQuery.isFetching = false;
});

/**
 * #1621 — the overdue read feeds two claims with different thresholds, and
 * conflating them is a defect in each direction.
 *
 * Degrading the badges and the OVERDUE filter only has to mean "we do not
 * know". The destructive card says the read *failed*, past tense, in
 * `--destructive` — and `GET /invoices/overdue` applies the chapter's grace
 * policy, so it is routinely the slowest read on the page. Gating the card on
 * the weaker flag flashes a red failure notice on ordinary cold loads.
 */
describe("InvoiceAdminCard overdue availability (#1621)", () => {
  const FAILURE_COPY = "Overdue status unavailable";

  it("does not claim failure while the overdue read is still in flight", () => {
    overdueQuery.data = undefined;
    overdueQuery.isFetching = true;
    chapterSubscription(mockCurrentChapter).active();

    render(<InvoiceAdminCard />);

    expect(screen.queryByText(FAILURE_COPY)).not.toBeInTheDocument();
  });

  it("claims failure when the overdue read errors, even mid-retry", () => {
    // `isFetching: true` is what makes this case pin the `isError` disjunct.
    // With it false the second disjunct already satisfies the flag, and the
    // test whose name is the error path would stay green with `isError`
    // deleted from the expression.
    overdueQuery.data = undefined;
    overdueQuery.isError = true;
    overdueQuery.isFetching = true;
    chapterSubscription(mockCurrentChapter).active();

    render(<InvoiceAdminCard />);

    expect(screen.getByText(FAILURE_COPY)).toBeInTheDocument();
  });

  // The filter is a Radix `Select`, so its items only mount once the dropdown
  // is open — unlike the page header's native `<select>`, which is why
  // `billing/page.test.tsx` can assert the sibling flag without this step.
  async function overdueOption() {
    await userEvent.click(screen.getByRole("combobox", { name: "Filter invoices" }));
    return screen.getByRole("option", { name: "OVERDUE" });
  }

  it("degrades the OVERDUE filter while the read is in flight, without the card", async () => {
    // The weak flag, which the strong one is deliberately *not* allowed to
    // replace. Both halves of the split need pinning or the split is one
    // refactor from collapsing back: here the option must already be disabled
    // (the read has not answered, so "no overdue invoices" would be a fact
    // derived from nothing) while the failure card must stay away.
    overdueQuery.data = undefined;
    overdueQuery.isFetching = true;
    chapterSubscription(mockCurrentChapter).active();

    render(<InvoiceAdminCard />);

    expect(await overdueOption()).toHaveAttribute("data-disabled");
    expect(screen.queryByText(FAILURE_COPY)).not.toBeInTheDocument();
  });

  it("leaves the OVERDUE filter enabled once the read has answered", async () => {
    overdueQuery.data = [];
    overdueQuery.isFetching = false;
    chapterSubscription(mockCurrentChapter).active();

    render(<InvoiceAdminCard />);

    expect(await overdueOption()).not.toHaveAttribute("data-disabled");
  });

  it("claims failure when the read holds nothing and is not in flight", () => {
    // The paused-offline shape: `isPending && !isFetching`.
    overdueQuery.data = undefined;
    overdueQuery.isFetching = false;
    chapterSubscription(mockCurrentChapter).active();

    render(<InvoiceAdminCard />);

    expect(screen.getByText(FAILURE_COPY)).toBeInTheDocument();
  });
});

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
    // But a disabled control with no explanation is its own dead end (§5
    // rule 2), so the pending state says what it is waiting for.
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
    // The id is generated per gate now, so assert the wiring rather than a
    // literal — a `useId` value would make the old assertion a rename canary
    // for nothing.
    const describedBy = trigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /checking this chapter/i,
    );
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

  it("scopes the in-flight guard per row, so one transition does not freeze the rest", async () => {
    // A single mutation object backs every row: an unscoped `isPending` would
    // disable all of them, and no guard at all lets a double click fire two
    // POSTs where the second is a PAID->PAID the API rejects.
    setChapter("active");
    render(<InvoiceAdminCard />);

    expect(screen.getByRole("button", { name: /mark paid/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /mark paid/i }));
    expect(mockTransitionMutate).toHaveBeenCalledTimes(1);
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
