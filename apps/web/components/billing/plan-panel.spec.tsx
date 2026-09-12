import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The plan panel, which absorbed `subscription-checkout-card.tsx`.
 *
 * Every case below except the last block is carried over from that file's
 * spec, because the behaviour it pinned is the part of the merge most able to
 * regress silently: the #929 recovery split, the #860 activation poll and its
 * budget, and the fail-open on an unresolved status. The labels moved and the
 * cards became one panel; the guarantees did not move.
 *
 * What is new is that the panel is **never empty**. The old card returned
 * `null` for an active chapter and for an unresolved one, because it was a
 * warning that appeared only when something was wrong. `4d` makes this the
 * place plan status lives, so the panel always renders and states what it
 * knows — including "Unknown", in §5's Hairline kind, when it knows nothing.
 */

const {
  canBranch,
  mockCurrentChapter,
  mockBillingStatus,
  mockPermissions,
  mockCheckoutMutate,
  mockPortalMutate,
  mockSearchParams,
} = vi.hoisted(() => ({
  canBranch: { value: "granted" },
  mockCurrentChapter: vi.fn(),
  mockBillingStatus: vi.fn(),
  mockPermissions: vi.fn(),
  mockCheckoutMutate: vi.fn(),
  mockPortalMutate: vi.fn(),
  mockSearchParams: vi.fn(),
}));

// Only the chapter payload is stubbed, in the shape `GET /v1/chapters/current`
// really returns. An earlier revision mocked a `{ status }` field that no
// endpoint emits, so the tests passed against a card that could never work.
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useBillingStatus: () => mockBillingStatus(),
  useMyPermissions: () => ({ data: { permissions: mockPermissions() } }),
  useCurrentUser: () => ({ data: { email: "treasurer@example.edu" } }),
  useCreateCheckout: () => ({
    mutateAsync: mockCheckoutMutate,
    isPending: false,
  }),
  useCreatePortal: () => ({ mutateAsync: mockPortalMutate, isPending: false }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams(),
}));

/*
  The permission component has its own tests (`can-fallback.spec.tsx`). This
  stub reproduces its **four** branches rather than two, because which node
  this panel hands to which slot is itself under test: `deniedFallback` is
  "proved denied", `fallback` is "idle, nothing cached", `offlineFallback` is
  "paused, cannot check", and omitting either of the last two means the
  component gets `<Can>`'s own default. `undefined` here stands for "the panel
  passed nothing", which is what the default-rendering cases assert.
*/
vi.mock("@/components/shared/can", () => ({
  Can: ({
    children,
    fallback,
    deniedFallback,
    offlineFallback,
  }: {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    deniedFallback?: React.ReactNode;
    offlineFallback?: React.ReactNode;
  }) => {
    if (canBranch.value === "granted") return <>{children}</>;
    if (canBranch.value === "denied") return <>{deniedFallback}</>;
    if (canBranch.value === "loading") {
      return fallback === undefined ? (
        <span data-testid="can-default-loading" />
      ) : (
        <>{fallback}</>
      );
    }
    return offlineFallback === undefined ? (
      <span data-testid="can-default-offline" />
    ) : (
      <>{offlineFallback}</>
    );
  },
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { PlanPanel } = await import("./plan-panel");

function setChapter(
  subscription_status: string | undefined,
  extra: { isPending?: boolean; isError?: boolean; pastDueSince?: string } = {},
) {
  mockCurrentChapter.mockReturnValue({
    data: subscription_status
      ? {
          subscription_status,
          past_due_since: extra.pastDueSince ?? null,
        }
      : undefined,
    isPending: extra.isPending ?? false,
    isError: extra.isError ?? false,
  });
}

function setParam(value: string | null) {
  mockSearchParams.mockReturnValue({ get: () => value });
}

function renderPanel(props: { invoicesHref?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PlanPanel {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setParam(null);
  canBranch.value = "granted";
  mockPermissions.mockReturnValue(["billing:view", "billing:manage"]);
  mockBillingStatus.mockReturnValue({ data: undefined, isError: false });
});

describe("the panel states plan status, always (4d)", () => {
  it("names the plan and its status on an active chapter", () => {
    setChapter("active");
    renderPanel();

    expect(
      screen.getByRole("heading", { name: "Pro" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    // No recovery to offer; the portal is the secondary action.
    expect(
      screen.getByRole("button", { name: /manage in stripe/i }),
    ).toBeInTheDocument();
  });

  it("gives a lapsed chapter a different chip tone than an unstarted one (#1201)", () => {
    // `incomplete` never started; `past_due`/`canceled` are a working
    // subscription that regressed, which is §5's danger. `4d` note 4 calls
    // this "swaps the chip to destructive", and `subscriptionStatusKind` is
    // the one mapping that decides it.
    setChapter("incomplete");
    const incomplete = renderPanel();
    expect(screen.getByText("Incomplete").className).toContain("bg-warning");
    incomplete.unmount();

    setChapter("past_due");
    const pastDue = renderPanel();
    expect(screen.getByText("Past due").className).toContain("bg-destructive");
    pastDue.unmount();

    setChapter("canceled");
    const canceled = renderPanel();
    expect(screen.getByText("Canceled").className).toContain("bg-destructive");
    canceled.unmount();
  });

  it("says Unknown, quietly, rather than asserting a lock it cannot prove", () => {
    // Fail open: an unresolved status is most likely a paying chapter behind a
    // slow or failed fetch. Claiming it is unsubscribed — and offering a button
    // that 400s with "already has an active subscription" — is worse. The chip
    // takes the Hairline kind, which §5 reserves for metadata that must not
    // read as a status.
    for (const extra of [{ isPending: true }, { isError: true }]) {
      setChapter(undefined, extra);
      const view = renderPanel();
      expect(screen.getByText("Unknown").className).toContain("border-border");
      expect(
        screen.queryByRole("button", { name: /checkout|stripe|payment/i }),
      ).not.toBeInTheDocument();
      view.unmount();
    }

    setChapter("trialing"); // a status this client does not model
    renderPanel();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /checkout|stripe|payment/i }),
    ).not.toBeInTheDocument();
  });

  it("falls back to the billing payload when the chapter record has not resolved", () => {
    // Two caches over one fact, resolving independently. A paying chapter must
    // not be told "Unknown" beside its own live Stripe ids.
    setChapter(undefined, { isPending: true });
    mockBillingStatus.mockReturnValue({
      data: { subscription_status: "active", stripe_customer_id: "cus_9" },
      isError: false,
    });
    renderPanel();

    expect(screen.getByText("Active")).toBeInTheDocument();
    // Display-only: no gate reads it, so no action is offered off the back of
    // a status the chapter record has not confirmed.
    expect(
      screen.queryByRole("button", { name: /manage in stripe/i }),
    ).not.toBeInTheDocument();
  });
});

describe("the meta line carries only facts that exist", () => {
  it("omits price, seats, renewal, card and next charge entirely", () => {
    // `4d` draws all five. None has a source in the contract, and a row
    // reading "Next charge —" claims we know there is one.
    setChapter("active");
    renderPanel();

    for (const invented of [
      /per member/i,
      /renews/i,
      /next charge/i,
      /visa|mastercard|····/i,
      /\d+ members/i,
    ]) {
      expect(screen.queryByText(invented)).not.toBeInTheDocument();
    }
  });

  it("shows the Stripe ids only when the caller can read them", () => {
    setChapter("active");
    const withoutIds = renderPanel();
    expect(screen.queryByText(/customer/i)).not.toBeInTheDocument();
    withoutIds.unmount();

    mockBillingStatus.mockReturnValue({
      data: { stripe_customer_id: "cus_123", subscription_id: "sub_456" },
      isError: false,
    });
    renderPanel();
    expect(screen.getByText("cus_123")).toBeInTheDocument();
    expect(screen.getByText("sub_456")).toBeInTheDocument();
  });

  it("dates the lapse from past_due_since, the only money fact it holds", () => {
    setChapter("past_due", { pastDueSince: "2026-08-14T00:00:00Z" });
    renderPanel();

    expect(screen.getByText(/past due since/i)).toBeInTheDocument();
  });

  it("links to the invoice list on the same page when given an anchor", () => {
    setChapter("active");
    renderPanel({ invoicesHref: "#invoices" });

    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute(
      "href",
      "#invoices",
    );
  });
});

describe("recovery splits by status (#929)", () => {
  it("never offers checkout to a past_due chapter, which would double-subscribe", async () => {
    // A past_due subscription is live and in dunning. A second checkout would
    // bill the chapter twice indefinitely and orphan the first subscription
    // where nothing in the app can surface or cancel it, so recovery is the
    // Portal — which updates the existing subscription in place.
    setChapter("past_due");
    renderPanel();

    expect(
      screen.queryByRole("button", { name: /checkout/i }),
    ).not.toBeInTheDocument();
    const portal = screen.getByRole("button", {
      name: /update payment method/i,
    });

    mockPortalMutate.mockResolvedValue({ url: "https://portal.stripe.com/p" });
    await userEvent.click(portal);
    await waitFor(() => expect(mockPortalMutate).toHaveBeenCalled());
    expect(mockCheckoutMutate).not.toHaveBeenCalled();
  });

  it("offers checkout — not the portal — to a canceled chapter", async () => {
    // The Portal cannot resume a terminated subscription; it only reactivates
    // one still scheduled to cancel at period end, which Stripe reports as
    // `active`. Checkout is the only way back, and it is safe because the
    // server reuses the chapter's stored customer instead of minting a second.
    setChapter("canceled");
    renderPanel();

    const restart = screen.getByRole("button", {
      name: /restart subscription/i,
    });

    mockCheckoutMutate.mockResolvedValue({
      url: "https://checkout.stripe.com/c",
    });
    await userEvent.click(restart);
    await waitFor(() => expect(mockCheckoutMutate).toHaveBeenCalled());
    expect(mockPortalMutate).not.toHaveBeenCalled();
  });

  it("does not send a canceled chapter to the portal in its copy", () => {
    // The old copy pointed at a path that cannot work. Guard the promise, not
    // just the button.
    setChapter("canceled");
    renderPanel();

    expect(screen.queryByText(/billing portal/i)).toBeNull();
  });

  it("offers checkout to a chapter stuck at incomplete", () => {
    setChapter("incomplete");
    renderPanel();

    expect(
      screen.getByRole("button", { name: /complete checkout/i }),
    ).toBeInTheDocument();
  });

  it("sends the caller's email and a round-trippable return pair", async () => {
    setChapter("incomplete");
    mockCheckoutMutate.mockResolvedValue({
      url: "https://checkout.stripe.com/s",
    });
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { origin: "https://app.frapp.test", assign },
      writable: true,
    });

    renderPanel();
    await userEvent.click(
      screen.getByRole("button", { name: /complete checkout/i }),
    );

    await waitFor(() => expect(mockCheckoutMutate).toHaveBeenCalledTimes(1));
    expect(mockCheckoutMutate).toHaveBeenCalledWith({
      customer_email: "treasurer@example.edu",
      success_url: "https://app.frapp.test/billing?checkout=success",
      cancel_url: "https://app.frapp.test/billing?checkout=cancelled",
    });
    // Blocking, and the hand-off is the whole of it: the panel never flips its
    // own chip to Active on the way out.
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/s"),
    );
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("keeps rendering from cached status when a background refetch fails", () => {
    // v5 reports isError while retaining data; blanking the control there would
    // remove the only thing that unlocks the chapter (§5 rule 3).
    mockCurrentChapter.mockReturnValue({
      data: { subscription_status: "incomplete", past_due_since: null },
      isPending: false,
      isError: true,
    });
    renderPanel();

    expect(
      screen.getByRole("button", { name: /complete checkout/i }),
    ).toBeInTheDocument();
  });
});

describe("the webhook wait (#860)", () => {
  it("waits for the webhook instead of claiming success on redirect", () => {
    setChapter("incomplete");
    setParam("success");
    renderPanel();

    expect(screen.getByText(/payment received/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /complete checkout/i }),
    ).not.toBeInTheDocument();
    // The chip still reports what the chapter record says, not what the
    // redirect implies.
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
  });

  it("confirms the payment once the webhook has landed", () => {
    setChapter("active");
    setParam("success");
    renderPanel();

    expect(screen.getByText(/payment cleared/i)).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows the activating state to a canceled chapter that just paid", () => {
    // A canceled chapter recovers through checkout and returns to
    // ?checkout=success with its status still `canceled`, because the webhook
    // has not landed. If the poll does not cover that status, this chapter
    // falls through to the recovery row and is told to start a subscription
    // seconds after starting one — an invitation to pay twice.
    setChapter("canceled");
    setParam("success");
    renderPanel();

    expect(
      screen.getByText(/payment received, activating your chapter/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /restart subscription/i }),
    ).not.toBeInTheDocument();
  });

  it("uses no em dash in the activating copy", () => {
    // The greenfield's own lock: product copy on this surface does not use em
    // dashes. This string carried one ("Payment received — activating…") and
    // is rewritten here rather than left for a later sweep.
    setChapter("incomplete");
    setParam("success");
    const { container } = renderPanel();

    expect(container.textContent).not.toContain("—");
  });

  it("does not let a stale ?checkout=success hide a lapsed chapter's way out", () => {
    // A bookmarked success URL revisited months later, after the chapter has
    // lapsed, must not replace the recovery control with a spinner —
    // §5 rule 3, never gate a user out of the screen that ungates them.
    setChapter("past_due");
    setParam("success");
    renderPanel();

    expect(
      screen.getByRole("button", { name: /update payment method/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/activating your chapter/i),
    ).not.toBeInTheDocument();
  });

  it("polls after a portal return so a fixed payment is not left showing past_due", () => {
    setChapter("past_due");
    setParam("returned");
    renderPanel();

    expect(screen.getByText(/checking stripe/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /update payment method/i }),
    ).not.toBeInTheDocument();
  });

  it("never offers checkout after the activation poll times out", async () => {
    // This chapter has already paid — the webhook is just late. Falling
    // through to the normal recovery row here would hand it a live checkout
    // button, and a second checkout mints a second live subscription.
    vi.useFakeTimers();
    try {
      setChapter("incomplete");
      setParam("success");
      renderPanel();

      // Burn the whole 10 x 3s budget. Each tick has to be flushed separately:
      // a tick only schedules the next one after React commits the new attempt.
      for (let i = 0; i < 11; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3_000);
        });
      }

      expect(screen.getByText(/hasn't confirmed yet/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /complete checkout/i }),
      ).not.toBeInTheDocument();
      // But it must still offer a way forward, both for the paid case and for
      // someone who landed here on a stale bookmark.
      expect(
        screen.getByRole("button", { name: /check again/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /haven't paid yet/i }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a cancelled return as neutral, not as a failure", () => {
    setChapter("incomplete");
    setParam("cancelled");
    renderPanel();

    expect(screen.getByText(/no charge was made/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /complete checkout/i }),
    ).toBeInTheDocument();
  });
});

describe("members without billing rights (4b)", () => {
  it("says Ask an officer instead of quoting a permission key at them", () => {
    // `4b`: "Members without billing rights see 'Ask an officer'." The copy it
    // replaces read "A chapter officer with `billing:manage` can complete
    // checkout and unlock these features" — a permission key shown to the one
    // person who cannot act on it.
    canBranch.value = "denied";
    setChapter("incomplete");
    renderPanel();

    expect(
      screen.getByText(/ask an officer to complete checkout/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /complete checkout/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/billing:manage/)).not.toBeInTheDocument();
  });

  it("invents no errand on a healthy chapter", () => {
    // `4b` writes "Ask an officer" for a *locked* row. On `active` nothing is
    // blocked, so an officer holding billing:view but not billing:manage gets
    // the plan and its status and no standing instruction to chase anyone.
    canBranch.value = "denied";
    setChapter("active");
    renderPanel();

    expect(screen.queryByText(/ask an officer/i)).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /manage in stripe/i }),
    ).not.toBeInTheDocument();
  });

  it("names the action that actually applies to the chapter's status", () => {
    canBranch.value = "denied";

    setChapter("past_due");
    const pastDue = renderPanel();
    expect(
      screen.getByText(/ask an officer to update the payment method/i),
    ).toBeInTheDocument();
    pastDue.unmount();

    setChapter("canceled");
    const canceled = renderPanel();
    expect(
      screen.getByText(/ask an officer to restart the subscription/i),
    ).toBeInTheDocument();
    canceled.unmount();
  });

  it("still shows a member the plan and its status", () => {
    // The status is not officer-only: the whole point of putting it on this
    // page is that anyone who can reach the route can see where the chapter
    // stands.
    canBranch.value = "denied";
    setChapter("past_due");
    renderPanel();

    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(screen.getByText("Past due")).toBeInTheDocument();
  });
});

describe("the three permission branches are three different facts", () => {
  it("leaves the action slot empty while the permission read is idle", () => {
    // `fallback` stays `null`, as the card this panel replaces left it.
    // Passing the denied copy here told a treasurer holding `billing:manage`
    // to ask an officer, for the length of their own permission fetch.
    canBranch.value = "loading";
    setChapter("incomplete");
    renderPanel();

    expect(
      screen.queryByText(/ask an officer/i),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("can-default-loading")).toBeInTheDocument();
  });

  it("takes the gate's own offline state rather than the denied copy", () => {
    // §10's control-slot `PermissionsOffline` — "Offline, can't check your
    // access" with a Retry that re-arms. Offline the denied copy was not
    // briefly wrong but permanently wrong, and carried no way out.
    canBranch.value = "offline";
    setChapter("incomplete");
    renderPanel();

    expect(screen.queryByText(/ask an officer/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("can-default-offline")).toBeInTheDocument();
  });
});

describe("a failed billing:view read is not the same as a 403", () => {
  const FAILURE_COPY = /couldn't load this chapter's stripe details/i;

  it("offers a retry to a caller who holds billing:view", () => {
    setChapter("active");
    mockBillingStatus.mockReturnValue({ data: undefined, isError: true });
    renderPanel();

    expect(screen.getByText(FAILURE_COPY)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("says nothing to a member, for whom the error IS the expected answer", () => {
    // `GET /v1/billing/status` is class-level `@RequirePermissions(billing:view)`.
    // Warning every member about their own routine 403 on every load is what
    // the page-wide "Showing preview billing data" banner this lane deleted
    // actually did.
    mockPermissions.mockReturnValue([]);
    setChapter("active");
    mockBillingStatus.mockReturnValue({ data: undefined, isError: true });
    renderPanel();

    expect(screen.queryByText(FAILURE_COPY)).not.toBeInTheDocument();
  });

  it("says nothing when the read simply succeeded with no ids", () => {
    setChapter("active");
    renderPanel();

    expect(screen.queryByText(FAILURE_COPY)).not.toBeInTheDocument();
  });
});

describe("the Portal button on an active chapter cannot fake a payment", () => {
  it("says nothing when a healthy chapter just visited the Portal and came back", () => {
    // This lane added the Portal button to the `active` branch, and its
    // return_url is /billing?checkout=returned. A treasurer who opens the
    // Portal to download a receipt or change the billing address lands here
    // with nothing paid; a green "Payment cleared" would be inventing one.
    setChapter("active");
    setParam("returned");
    renderPanel();

    expect(screen.queryByText(/payment cleared/i)).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("still confirms the dunning recovery it watched happen", () => {
    // past_due -> Portal -> card fixed -> webhook -> active. The panel renders
    // its awaiting state first, which is what earns the confirmation.
    setChapter("past_due");
    setParam("returned");
    const { rerender } = renderPanel();
    expect(screen.getByText(/checking stripe/i)).toBeInTheDocument();

    setChapter("active");
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PlanPanel />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/payment cleared/i)).toBeInTheDocument();
  });

  it("confirms a checkout return unconditionally, because that URL means they paid", () => {
    // `success_url` is createCheckout's own, so the caller did go through
    // checkout even if the webhook beat them back to the page.
    setChapter("active");
    setParam("success");
    renderPanel();

    expect(screen.getByText(/payment cleared/i)).toBeInTheDocument();
  });
});

describe("PlanMeta identity", () => {
  it("keys entries by name, so the focusable anchor survives ids arriving", () => {
    // Entries are inserted at the front as they resolve, and the poll
    // invalidates ["billing"] every 3s. An index key would replace the DOM
    // node holding focus rather than move it.
    setChapter("active");
    const { rerender } = renderPanel({ invoicesHref: "#invoices" });
    const before = screen.getByRole("link", { name: "Invoices" });
    before.focus();
    expect(document.activeElement).toBe(before);

    mockBillingStatus.mockReturnValue({
      data: { stripe_customer_id: "cus_1", subscription_id: "sub_1" },
      isError: false,
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PlanPanel invoicesHref="#invoices" />
      </QueryClientProvider>,
    );

    expect(screen.getByText("cus_1")).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Invoices" }),
    );
  });
});

describe("the panel names no plan the chapter does not hold", () => {
  it("says Pro only for the two statuses that hold the subscription", () => {
    for (const status of ["active", "past_due"]) {
      setChapter(status);
      const view = renderPanel();
      expect(
        screen.getByRole("heading", { name: "Pro" }),
        status,
      ).toBeInTheDocument();
      view.unmount();
    }
  });

  it("says No subscription for a chapter that has none", () => {
    // The regression this guards: a hardcoded "Pro" put that word above an
    // `Incomplete` chip and a matrix saying every paid module was locked —
    // breaking the lane's own "omit, never placeholder" rule on the one field
    // §10 names as having no source.
    for (const status of ["incomplete", "canceled"]) {
      setChapter(status);
      const view = renderPanel();
      expect(
        screen.getByRole("heading", { name: "No subscription" }),
        status,
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Pro" })).toBeNull();
      view.unmount();
    }
  });

  it("names the section, not a plan, while the status is unestablished", () => {
    setChapter(undefined, { isPending: true });
    renderPanel();

    expect(
      screen.getByRole("heading", { name: "Subscription" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("does not carry the board's page-title tracking on its plan name", () => {
    // `4d:244` puts -0.3px on the 24px page title; `4d:245`'s 22px plan name
    // has no letter-spacing. The title is not rendered on this route at all.
    setChapter("active");
    renderPanel();

    const heading = screen.getByRole("heading", { name: "Pro" });
    expect(heading.className).toContain("text-[22px]");
    expect(heading.className).not.toContain("tracking-");
  });
});

describe("cancelling in the Portal is a completed outcome, not a pending one", () => {
  it("offers the restart action immediately instead of a 30s spinner", () => {
    // The other half of the `active`-branch Portal button. Cancelling is the
    // commonest reason to open the Portal from a healthy chapter, the webhook
    // lands in seconds, and returning is a full page load — so the chapter
    // reads back `canceled` with nothing left in flight.
    setChapter("canceled");
    setParam("returned");
    renderPanel();

    expect(
      screen.queryByText(/checking stripe for your update/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /restart subscription/i }),
    ).toBeInTheDocument();
  });

  it("still waits out a past_due return, where the webhook really is in flight", () => {
    setChapter("past_due");
    setParam("returned");
    renderPanel();

    expect(screen.getByText(/checking stripe/i)).toBeInTheDocument();
  });
});
