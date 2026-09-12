import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

/**
 * The merged invoice surface.
 *
 * This file is the union of two that are deleted with it —
 * `app/(dashboard)/billing/page.spec.tsx`, which covered the member-facing
 * table, and `components/billing/invoice-admin-card.spec.tsx`, which covered
 * the officer one. The invariants they pinned are the reason the merge is
 * allowed to be a merge rather than a rewrite, so each is carried over with
 * the issue number it came from:
 *
 * - **#336/#1200** — no decoy Create trigger, and no Send reminder control.
 * - **#707/#1196** — Overdue derives from `GET /v1/invoices/overdue`, never
 *   from an `invoice.status === "OVERDUE"` comparison the enum cannot satisfy.
 * - **#1621** — the overdue read feeds two claims at two thresholds, and
 *   conflating them is a defect in each direction.
 * - **#858/#1753** — every paid-ops write on the surface is subscription
 *   gated, the trigger and not the submit, and the dialog closes if the
 *   verdict flips under it.
 * - **CSV export** — exports exactly the selection, and the selection is
 *   dropped whenever the visible population changes.
 */

const overdueQuery: {
  data: unknown;
  isError: boolean;
  isPending: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
} = { data: [], isError: false, isPending: false, fetchStatus: "idle" };

const invoicesQuery: {
  data: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  refetch: () => void;
} = {
  data: [],
  isPending: false,
  isSuccess: true,
  isError: false,
  refetch: vi.fn(),
};

const currentUserQuery: { data: unknown; isPending: boolean } = {
  data: { id: "u-1" },
  isPending: false,
};

const transitionQuery: {
  isPending: boolean;
  variables: { id: string } | undefined;
} = { isPending: false, variables: undefined };

const {
  mockCurrentChapter,
  mockTransitionMutate,
  mockPermissions,
  downloadCsvSpy,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockTransitionMutate: vi.fn().mockResolvedValue({}),
  mockPermissions: vi.fn(),
  downloadCsvSpy: vi.fn(),
}));

const OPEN_INVOICE = {
  id: "inv-open",
  chapter_id: "chap-1",
  user_id: "u-1",
  title: "Fall 2026 dues",
  description: null,
  amount: 12000,
  status: "OPEN" as const,
  due_date: "2026-09-01",
  created_at: "2026-08-03T00:00:00Z",
};

const OVERDUE_INVOICE = {
  ...OPEN_INVOICE,
  id: "inv-overdue",
  user_id: "u-2",
  title: "Spring 2026 dues",
  amount: 7500,
  due_date: "2026-01-01",
  created_at: "2026-08-02T00:00:00Z",
};

const PAID_INVOICE = {
  ...OPEN_INVOICE,
  id: "inv-paid",
  user_id: "u-3",
  title: "Winter 2026 dues",
  amount: 3000,
  status: "PAID" as const,
  created_at: "2026-08-01T00:00:00Z",
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({ data: { permissions: mockPermissions() } }),
  useInvoices: () => invoicesQuery,
  useOverdueInvoices: () => overdueQuery,
  useCurrentUser: () => currentUserQuery,
  useMembers: () => ({ data: [{ user_id: "u-1", display_name: "Rae Okafor" }] }),
  useCreateInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTransitionInvoiceStatus: () => ({
    mutateAsync: mockTransitionMutate,
    isPending: transitionQuery.isPending,
    variables: transitionQuery.variables,
  }),
}));

vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>(
    "@/lib/utils",
  );
  return { ...actual, downloadCsv: downloadCsvSpy };
});

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

// The permission component has its own tests (`can-fallback.spec.tsx`); here
// it must not swallow the Create trigger. The *officer* verdict in this
// component comes from `useMyPermissions` + `can()`, not from `<Can>`, so it
// is driven by `mockPermissions` below and a pass-through stub cannot grant it
// by accident.
vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: () => true,
  getStripe: () => null,
}));

// The payment sheet owns Stripe Elements and has its own tests; mounting it
// here would pull the SDK into every case in this file for a dialog that is
// closed in all of them.
vi.mock("@/components/billing/pay-invoice-dialog", () => ({
  PayInvoiceDialog: () => <div data-testid="pay-invoice-dialog" />,
}));

const { InvoiceList } = await import("./invoice-list");

const chapter = chapterSubscription(mockCurrentChapter);

function trigger() {
  return screen.getByRole("button", { name: /create invoice/i });
}

function statusFilter() {
  return screen.getByRole("combobox", { name: "Invoice status filter" });
}

function overdueOption() {
  return screen.getByRole("option", { name: "Overdue" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPermissions.mockReturnValue(["billing:manage", "members:view"]);
  invoicesQuery.data = [OPEN_INVOICE, OVERDUE_INVOICE, PAID_INVOICE];
  invoicesQuery.isPending = false;
  invoicesQuery.isSuccess = true;
  invoicesQuery.isError = false;
  currentUserQuery.data = { id: "u-1" };
  currentUserQuery.isPending = false;
  overdueQuery.data = [];
  overdueQuery.isError = false;
  overdueQuery.isPending = false;
  overdueQuery.fetchStatus = "idle";
  transitionQuery.isPending = false;
  transitionQuery.variables = undefined;
  chapter.active();
});

describe("the invoice surface is one list, not two (#2146)", () => {
  it("offers exactly one Create invoice trigger", () => {
    // #336/#1200: the page header carried a decoy Create Invoice button beside
    // the working one in the officer card. Now there is one list, so a second
    // trigger cannot exist without being visible in this count.
    render(<InvoiceList />);

    expect(
      screen.getAllByRole("button", { name: /create invoice/i }),
    ).toHaveLength(1);
  });

  it("renders each invoice exactly once", () => {
    // The defect the merge fixes: an officer saw every row twice, once in the
    // page's table and once in the admin card beneath it.
    render(<InvoiceList />);

    expect(screen.getAllByText("Fall 2026 dues")).toHaveLength(1);
    expect(screen.getAllByText("Winter 2026 dues")).toHaveLength(1);
  });

  it("never renders a Send reminder control, because no endpoint backs one", () => {
    render(<InvoiceList />);

    expect(
      screen.queryByRole("button", { name: /send reminder/i }),
    ).not.toBeInTheDocument();
  });

  it("carries no page-narration paragraph", () => {
    // `1f` pin 2 and `1t`: the two card descriptions and the card footer that
    // explained the screen to itself are deleted, not restyled.
    render(<InvoiceList />);

    expect(
      screen.queryByText(/track dues collection and overdue balances/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/track chapter dues across every member/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/manual paid \/ void buttons exist/i),
    ).not.toBeInTheDocument();
  });
});

describe("overdue derivation (#707/#1196)", () => {
  it("counts Overdue from the server list, not from a status comparison", () => {
    // `financial_invoices.status` is DRAFT | OPEN | PAID | VOID, so
    // `status === "OVERDUE"` is always false. Overdue is grace-aware and only
    // the server knows it.
    overdueQuery.data = [OVERDUE_INVOICE];
    render(<InvoiceList />);

    expect(screen.getByText(/2 open/)).toBeInTheDocument();
    expect(screen.getByText(/1 overdue/)).toBeInTheDocument();
    expect(screen.getByText(/1 paid/)).toBeInTheDocument();
  });

  it("filters to exactly the server-reported overdue invoices", async () => {
    overdueQuery.data = [OVERDUE_INVOICE];
    render(<InvoiceList />);

    await userEvent.selectOptions(statusFilter(), "overdue");

    expect(screen.getByText("Spring 2026 dues")).toBeInTheDocument();
    expect(screen.queryByText("Fall 2026 dues")).not.toBeInTheDocument();
    expect(screen.queryByText("Winter 2026 dues")).not.toBeInTheDocument();
  });

  it("reports overdue as unknown rather than zero when the read errors", () => {
    overdueQuery.data = undefined;
    overdueQuery.isError = true;
    render(<InvoiceList />);

    expect(screen.getByText(/— overdue/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+ overdue/)).not.toBeInTheDocument();
    expect(overdueOption()).toBeDisabled();
  });

  it("reports overdue as unknown while the read has not answered", () => {
    // Reachable online on every cold load: `overdueQuery` is not in the page's
    // loading gate, so without this the count asserted zero for the duration
    // of the request.
    overdueQuery.data = undefined;
    overdueQuery.isPending = true;
    overdueQuery.fetchStatus = "fetching";
    render(<InvoiceList />);

    expect(screen.getByText(/— overdue/)).toBeInTheDocument();
    expect(overdueOption()).toBeDisabled();
  });

  it("restores the count and the filter once the read answers", () => {
    render(<InvoiceList />);

    expect(screen.getByText(/0 overdue/)).toBeInTheDocument();
    expect(overdueOption()).toBeEnabled();
  });
});

/**
 * #1621 — the overdue read feeds two claims with different thresholds.
 *
 * Degrading the count and the filter only has to mean "we do not know". The
 * destructive summary says the read *failed*, past tense, in `--destructive` —
 * and this endpoint applies the chapter's grace policy, so it is routinely the
 * slowest read on the page. Gating the summary on the weaker flag flashes a
 * red failure notice on ordinary cold loads.
 */
describe("overdue availability, the two thresholds (#1621)", () => {
  const FAILURE_COPY = /couldn't load the overdue list/i;

  it("does not claim failure while the read is still in flight", () => {
    overdueQuery.data = undefined;
    overdueQuery.isPending = true;
    overdueQuery.fetchStatus = "fetching";
    render(<InvoiceList />);

    expect(screen.queryByText(FAILURE_COPY)).not.toBeInTheDocument();
  });

  it("claims failure when the read errors, even mid-retry", () => {
    // `isPending: false` is the realistic shape for an errored query, which is
    // what makes this pin the `isError` disjunct specifically.
    overdueQuery.data = undefined;
    overdueQuery.isError = true;
    overdueQuery.fetchStatus = "fetching";
    render(<InvoiceList />);

    expect(screen.getByText(FAILURE_COPY)).toBeInTheDocument();
  });

  it("claims failure when the read is paused holding nothing", () => {
    overdueQuery.data = undefined;
    overdueQuery.isPending = true;
    overdueQuery.fetchStatus = "paused";
    render(<InvoiceList />);

    expect(screen.getByText(FAILURE_COPY)).toBeInTheDocument();
  });

  it("does not claim failure while a cached read refetches offline", () => {
    // A background refetch paused offline still has data in hand, so the query
    // is "success" and `isPending` is false. Without that half of the guard the
    // surface paints a red "couldn't load" over an overdue list it is holding
    // and rendering correctly one element below.
    overdueQuery.data = [OVERDUE_INVOICE];
    overdueQuery.isPending = false;
    overdueQuery.fetchStatus = "paused";
    render(<InvoiceList />);

    expect(screen.queryByText(FAILURE_COPY)).not.toBeInTheDocument();
    expect(screen.getByText(/1 invoice past due/i)).toBeInTheDocument();
    expect(overdueOption()).toBeEnabled();
  });

  it("does not claim failure for a read that was never started", () => {
    // `useOverdueInvoices` is `enabled: !!chapterId`, so a disabled read is
    // `isPending` with nothing in flight: not a failure, but still "we do not
    // know", so the filter must still degrade.
    overdueQuery.data = undefined;
    overdueQuery.isPending = true;
    overdueQuery.fetchStatus = "idle";
    render(<InvoiceList />);

    expect(screen.queryByText(FAILURE_COPY)).not.toBeInTheDocument();
    expect(overdueOption()).toBeDisabled();
  });
});

describe("bulk selection and CSV export", () => {
  it("exports exactly the selected rows", async () => {
    render(<InvoiceList />);

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select Fall 2026 dues" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /export csv/i }),
    );

    expect(downloadCsvSpy).toHaveBeenCalledTimes(1);
    const [rows, prefix] = downloadCsvSpy.mock.calls[0]!;
    expect(prefix).toBe("invoices");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Title: "Fall 2026 dues" });
  });

  it("drops the selection when the filter changes, so a stale count cannot export the wrong rows", async () => {
    render(<InvoiceList />);

    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select Fall 2026 dues" }),
    );
    expect(screen.getByText(/1 invoice selected/i)).toBeInTheDocument();

    await userEvent.selectOptions(statusFilter(), "paid");

    expect(screen.queryByText(/invoice.*selected/i)).not.toBeInTheDocument();
  });
});

describe("who can do what", () => {
  it("offers Pay only on the caller's own OPEN invoice", () => {
    // The list legitimately contains other members' invoices for an officer,
    // so the affordance is gated on ownership and not merely on status.
    render(<InvoiceList />);

    const payButtons = screen.getAllByRole("button", { name: /^pay$/i });
    expect(payButtons).toHaveLength(1);
  });

  it("hides the officer half from a member without billing:manage", () => {
    mockPermissions.mockReturnValue([]);
    render(<InvoiceList />);

    expect(
      screen.queryByRole("button", { name: /mark paid/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^void$/i }),
    ).not.toBeInTheDocument();
    // But the list itself is theirs to read, and Pay is theirs to use.
    expect(screen.getByText("Fall 2026 dues")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pay$/i })).toBeInTheDocument();
  });

  it("does not attribute rows to a member who cannot read the roster", () => {
    // `GET /v1/members` needs `members:view`, and the query is enabled on the
    // officer verdict. A member must not see a name resolved from a roster
    // they never fetched.
    mockPermissions.mockReturnValue([]);
    render(<InvoiceList />);

    expect(screen.queryByText(/Rae Okafor/)).not.toBeInTheDocument();
  });
});

describe("subscription gating (#858/#1753)", () => {
  it("leaves invoicing alone on an active chapter", () => {
    render(<InvoiceList />);

    expect(trigger()).toBeEnabled();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("disables the trigger and names blocker plus recovery when incomplete", async () => {
    chapter.incomplete();
    render(<InvoiceList />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(screen.getByText(/plan panel at the top of this page/i)).
      toBeInTheDocument();
    // §5 rule 4: disabled, not hidden — the surface is still there.
    expect(
      screen.getByRole("heading", { name: /invoices/i }),
    ).toBeInTheDocument();

    // And the dialog must not open onto a doomed action.
    await userEvent.click(trigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ties the disabled trigger to its explanation for screen readers", () => {
    chapter.incomplete();
    render(<InvoiceList />);

    const describedBy = trigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("blocks paid-ops invoicing immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<InvoiceList />);

    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("sends a canceled chapter to the plan panel, not to the portal (#929)", () => {
    // The Portal cannot resume a terminated subscription, so the shared
    // default's "reopen it from the billing portal" names a dead end. The
    // panel above, whose canceled action is a fresh checkout, is the way back.
    chapter.canceled();
    render(<InvoiceList />);

    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(
      screen.getByText(/plan panel at the top of this page/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/billing portal/i)).not.toBeInTheDocument();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    chapter.loading();
    render(<InvoiceList />);

    expect(trigger()).toBeDisabled();
    // No blocked explanation yet — nothing has established a reason.
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
    // But a disabled control with no explanation is its own dead end.
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
    const describedBy = trigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /checking this chapter/i,
    );
  });

  it("gates the other paid-ops writes, not just Create", () => {
    // Every row, not the first one: gating only Create would leave the
    // surface claiming writes are blocked while still offering three of them,
    // and gating only row one would be the same bug scoped smaller.
    chapter.incomplete();
    render(<InvoiceList />);

    const markPaid = screen.getAllByRole("button", { name: /mark paid/i });
    const voids = screen.getAllByRole("button", { name: /^void$/i });
    expect(markPaid).toHaveLength(2);
    expect(voids).toHaveLength(2);
    for (const button of [...markPaid, ...voids]) {
      expect(button).toBeDisabled();
    }
  });

  it("leaves the row actions alone on an active chapter", () => {
    render(<InvoiceList />);

    for (const button of [
      ...screen.getAllByRole("button", { name: /mark paid/i }),
      ...screen.getAllByRole("button", { name: /^void$/i }),
    ]) {
      expect(button).toBeEnabled();
    }
  });

  it("closes an already-open dialog when the subscription lapses under it", async () => {
    const { rerender } = render(<InvoiceList />);
    await userEvent.click(trigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    chapter.pastDue();
    rerender(<InvoiceList />);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("scopes the in-flight guard per row, so one transition does not freeze the rest", async () => {
    // A single mutation object backs every row: an unscoped `isPending` would
    // disable all of them, and no guard at all lets a double click fire two
    // POSTs where the second is a PAID->PAID the API rejects.
    const { rerender } = render(<InvoiceList />);

    await userEvent.click(
      screen.getAllByRole("button", { name: /mark paid/i })[0]!,
    );
    expect(mockTransitionMutate).toHaveBeenCalledTimes(1);

    transitionQuery.isPending = true;
    transitionQuery.variables = { id: "inv-open" };
    rerender(<InvoiceList />);

    const [first, second] = screen.getAllByRole("button", {
      name: /mark paid/i,
    });
    expect(first).toBeDisabled();
    expect(second).toBeEnabled();
  });

  it("fails open when the chapter record cannot be read", () => {
    // A failed chapter fetch must not lock a paying chapter out of its own
    // billing screen; the server guard is still the enforcement.
    chapter.unreadable();
    render(<InvoiceList />);

    expect(trigger()).toBeEnabled();
  });
});

describe("nothing is asserted from a read that has not answered", () => {
  it("shows no counts at all while the invoice read is in flight", () => {
    // `openCount` and `paidCount` derive from `invoices`, which is `[]` until
    // the read lands — so an unconditional count line reads "0 open · 0 paid"
    // above the spinner, telling a treasurer mid-load that nothing is
    // outstanding. The page this list replaces could not reach that state
    // because it gated its whole body on a page-level `isLoading`.
    invoicesQuery.data = undefined;
    invoicesQuery.isPending = true;
    invoicesQuery.isSuccess = false;
    render(<InvoiceList />);

    expect(screen.queryByText(/\d+ open/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ paid/)).not.toBeInTheDocument();
    // The list itself says what is happening.
    expect(screen.getByText(/loading billing overview/i)).toBeInTheDocument();
  });

  it("shows no counts when the invoice read failed", () => {
    invoicesQuery.data = undefined;
    invoicesQuery.isPending = false;
    invoicesQuery.isSuccess = false;
    invoicesQuery.isError = true;
    render(<InvoiceList />);

    expect(screen.queryByText(/\d+ open/)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load invoices/i)).toBeInTheDocument();
  });

  it("holds the rows until the caller's identity resolves, so Pay cannot pop in", () => {
    // Pay is gated on `invoice.user_id === currentUserId`. Rendering rows
    // first shows a member their own OPEN invoice with no way to pay it and
    // nothing saying why, then pops the button in.
    currentUserQuery.data = undefined;
    currentUserQuery.isPending = true;
    render(<InvoiceList />);

    expect(screen.queryByText("Fall 2026 dues")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^pay$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/loading billing overview/i)).toBeInTheDocument();
  });
});
