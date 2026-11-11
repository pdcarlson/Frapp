import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

// `@repo/validation`'s beta list, emptied so this spec pins the ordinary
// module rule with dues as its example. A test that wants dues beta-off, as
// it is for the beta, sets `betaOff.keys`.
const betaOff = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@repo/validation/beta-off-modules", () => ({
  get BETA_OFF_MODULES() {
    return betaOff.keys;
  },
  isBetaOffModule: (key: string) => betaOff.keys.includes(key),
}));
afterEach(() => {
  betaOff.keys = [];
});

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

const billingStatusQuery: {
  isPending: boolean;
  isSuccess: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
  data: unknown;
} = {
  isPending: false,
  isSuccess: true,
  fetchStatus: "idle",
  data: { stripe_customer_id: "cus_1" },
};

const { mockCurrentChapter, networkState, invoiceReadOptions } = vi.hoisted(
  () => ({
    invoiceReadOptions: [] as ({ enabled?: boolean } | undefined)[],
    mockCurrentChapter: vi.fn(),
    networkState: { isOffline: false },
  }),
);

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useInvoices: (_userId?: string, options?: { enabled?: boolean }) => {
    invoiceReadOptions.push(options);
    return invoicesQuery;
  },
  useCurrentUser: () => currentUserQuery,
  useBillingStatus: () => billingStatusQuery,
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

const { PlanAndBilling: BillingPage } = await import("./plan-and-billing");

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
  billingStatusQuery.isPending = false;
  billingStatusQuery.isSuccess = true;
  billingStatusQuery.fetchStatus = "idle";
  billingStatusQuery.data = { stripe_customer_id: "cus_1" };
  chapter.active();
});

describe("the route is flush on the shell", () => {
  it("leaves the route's h1 to the top bar, on every path", () => {
    // The title lives in the top bar (`top-bar.tsx`), which the shell renders
    // around every path, offline included. A page h1 would be a second one.
    render(<BillingPage />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("draws no h1 on the offline path either", () => {
    networkState.isOffline = true;
    invoicesQuery.data = undefined;
    invoicesQuery.isPending = true;
    invoicesQuery.fetchStatus = "paused";
    render(<BillingPage />);

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
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
    expect(screen.getByTestId("invoice-list")).toHaveAttribute(
      "id",
      "invoices",
    );
  });
});

describe("while dues is beta-off", () => {
  it("drops the invoice list and the panel's link to it", () => {
    betaOff.keys = ["dues"];
    render(<BillingPage />);

    expect(invoiceReadOptions.at(-1)).toEqual({ enabled: false });
    expect(screen.queryByTestId("invoice-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-panel")).not.toHaveAttribute(
      "data-invoices-href",
    );
  });

  it("does not hold the page offline on an invoice read it never makes", () => {
    betaOff.keys = ["dues"];
    networkState.isOffline = true;
    invoicesQuery.data = undefined;
    invoicesQuery.isPending = true;
    invoicesQuery.fetchStatus = "paused";
    render(<BillingPage />);

    expect(screen.queryByText(/unavailable offline/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-panel")).toBeInTheDocument();
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
    expect(screen.queryByText(/unavailable offline/i)).not.toBeInTheDocument();
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

describe("Cancel or close, which replaced Danger zone (#3827)", () => {
  it("points a Stripe customer at Manage in Stripe", () => {
    render(<BillingPage />);
    expect(screen.getByText(/to cancel, open/i)).toBeInTheDocument();
    expect(screen.getByText(/to close the chapter for good/i)).toBeInTheDocument();
  });

  it("tells a chapter Frapp turned on that there is nothing in Stripe", () => {
    billingStatusQuery.data = { stripe_customer_id: null };
    render(<BillingPage />);
    expect(
      screen.getByText(/nothing to cancel in stripe/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/to cancel, open/i)).toBeNull();
  });

  it("guesses neither while the billing read is in flight", () => {
    billingStatusQuery.isPending = true;
    billingStatusQuery.isSuccess = false;
    billingStatusQuery.fetchStatus = "fetching";
    billingStatusQuery.data = undefined;
    render(<BillingPage />);
    expect(screen.queryByText(/to cancel, open/i)).toBeNull();
    expect(screen.queryByText(/nothing to cancel in stripe/i)).toBeNull();
  });

  it("has nothing to cancel without a subscription", () => {
    chapter.canceled();
    render(<BillingPage />);
    expect(
      screen.getByText(/there is no subscription to cancel/i),
    ).toBeInTheDocument();
  });
});
