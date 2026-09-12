import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

/**
 * The route body: what it puts on the screen, and what it refuses to.
 *
 * The three blocks below are the whole of this lane's acceptance for the page
 * itself — the chrome that was deleted, the one banner `4d` allows, and the
 * offline path `#1621` established. The children have their own files; they
 * are stubbed here so a failure lands on the page rather than on whichever of
 * them happened to change.
 */

const invoicesQuery: {
  isPending: boolean;
  isError: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
  data: unknown;
  refetch: () => void;
} = {
  isPending: false,
  isError: false,
  fetchStatus: "idle",
  data: [],
  refetch: vi.fn(),
};

const currentUserQuery: {
  isPending: boolean;
  isError: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
  data: unknown;
  refetch: () => void;
} = {
  isPending: false,
  isError: false,
  fetchStatus: "idle",
  data: { id: "u-1" },
  refetch: vi.fn(),
};

const { mockCurrentChapter, networkState } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  networkState: { isOffline: false },
}));

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useInvoices: () => invoicesQuery,
  useCurrentUser: () => currentUserQuery,
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => networkState,
}));

// Each child owns its own queries and gates and is covered by its own spec.
vi.mock("@/components/billing/plan-panel", () => ({
  PlanPanel: ({ invoicesHref }: { invoicesHref?: string }) => (
    <div data-testid="plan-panel" data-invoices-href={invoicesHref} />
  ),
}));
vi.mock("@/components/billing/plan-matrix", () => ({
  PlanMatrix: () => <div data-testid="plan-matrix" />,
}));
vi.mock("@/components/billing/invoice-list", () => ({
  InvoiceList: ({ id }: { id?: string }) => (
    <div data-testid="invoice-list" id={id} />
  ),
}));

const { BillingPage } = await import("./billing-page");

const chapter = chapterSubscription(mockCurrentChapter);

beforeEach(() => {
  vi.clearAllMocks();
  networkState.isOffline = false;
  invoicesQuery.isPending = false;
  invoicesQuery.isError = false;
  invoicesQuery.fetchStatus = "idle";
  invoicesQuery.data = [];
  currentUserQuery.fetchStatus = "idle";
  currentUserQuery.data = { id: "u-1" };
  chapter.active();
});

describe("the route is flush on the shell", () => {
  it("names itself once, in the main pane", () => {
    render(<BillingPage />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Billing");
  });

  it("keeps the heading on the offline path too", () => {
    // The shell no longer supplies a title (#2141), so a page that mounts one
    // only on its success path loses it exactly when the member is most lost.
    networkState.isOffline = true;
    invoicesQuery.data = undefined;
    invoicesQuery.isPending = true;
    invoicesQuery.fetchStatus = "paused";
    render(<BillingPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Billing" }),
    ).toBeInTheDocument();
  });

  it("carries none of the narration the cards used to wrap", () => {
    render(<BillingPage />);

    for (const narration of [
      /monitor chapter billing health/i,
      /subscription status/i,
      /showing preview billing data/i,
      /sign in to load live chapter/i,
      // `4d`'s own sub-line, which is false on this route: a member reaches it
      // to pay their own invoice.
      /members never see this page/i,
    ]) {
      expect(screen.queryByText(narration)).not.toBeInTheDocument();
    }
  });

  it("orders the page plan, matrix, invoices, and wires the panel's anchor", () => {
    render(<BillingPage />);

    expect(screen.getByTestId("plan-panel")).toHaveAttribute(
      "data-invoices-href",
      "#invoices",
    );
    expect(screen.getByTestId("invoice-list")).toHaveAttribute("id", "invoices");
  });
});

describe("the lapse banner, this page only (4d note 4)", () => {
  const LAPSE = /past due|read-only/i;

  it("says nothing at all while the subscription is healthy", () => {
    render(<BillingPage />);
    expect(screen.queryByText(LAPSE)).not.toBeInTheDocument();
  });

  it("adds one line when the chapter is past due", () => {
    chapter.pastDue();
    render(<BillingPage />);

    const banner = screen.getByText(/past due/i);
    expect(banner.className).toContain("border-destructive");
  });

  it("adds one line when the chapter is canceled", () => {
    // A generalisation of the note rather than a departure from it: `4d`
    // models two states and the product has four, and the rule it is really
    // stating is "the destructive state gets a banner".
    chapter.canceled();
    render(<BillingPage />);

    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("is not a live region, because it never announces a change", () => {
    // Durable page content that is simply present whenever the chapter is
    // lapsed. Marking it `role="status"` queued a third polite announcement
    // on arrival, for a sentence sitting directly under the heading.
    chapter.pastDue();
    render(<BillingPage />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays quiet for a chapter that never started", () => {
    // `incomplete` takes the warning kind, not destructive: a chapter that
    // never subscribed has not lapsed, and its whole story is the plan
    // panel's checkout button.
    chapter.incomplete();
    render(<BillingPage />);

    expect(screen.queryByText(LAPSE)).not.toBeInTheDocument();
  });

  it("stays quiet when the status is unresolved", () => {
    // A blocked explanation from `null` asserts a reason nothing proved.
    chapter.loading();
    render(<BillingPage />);
    expect(screen.queryByText(LAPSE)).not.toBeInTheDocument();

    chapter.unreadable();
    render(<BillingPage />);
    expect(screen.queryByText(LAPSE)).not.toBeInTheDocument();
  });
});

describe("the offline path (#1621)", () => {
  it("keeps rendering the page when the reads are cached", () => {
    networkState.isOffline = true;
    render(<BillingPage />);

    expect(screen.getByTestId("invoice-list")).toBeInTheDocument();
    expect(
      screen.queryByText(/unavailable offline/i),
    ).not.toBeInTheDocument();
  });

  it("shows the offline screen when the invoice read is uncached", () => {
    networkState.isOffline = true;
    invoicesQuery.data = undefined;
    invoicesQuery.isPending = true;
    invoicesQuery.fetchStatus = "paused";
    render(<BillingPage />);

    expect(screen.getByText(/unavailable offline/i)).toBeInTheDocument();
  });

  it("shows the offline screen when the caller's identity is uncached", () => {
    // Pay is gated on `invoice.user_id === currentUserId`, so without it a
    // member sees their own OPEN invoice with no way to pay it.
    networkState.isOffline = true;
    currentUserQuery.data = undefined;
    currentUserQuery.isPending = true;
    currentUserQuery.fetchStatus = "paused";
    render(<BillingPage />);

    expect(screen.getByText(/unavailable offline/i)).toBeInTheDocument();
  });

  it("does not gate the page on the permission-scoped billing read", () => {
    // `BillingController` is class-level `@RequirePermissions(billing:view)`,
    // which most members do not hold. Conjoining it would fire the offline
    // screen for exactly the members who came here to pay an invoice — so it
    // is not among this page's queries at all.
    networkState.isOffline = true;
    render(<BillingPage />);

    expect(screen.getByTestId("invoice-list")).toBeInTheDocument();
  });
});
