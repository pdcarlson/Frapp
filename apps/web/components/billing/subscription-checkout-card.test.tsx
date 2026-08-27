import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockCurrentChapter,
  mockCheckoutMutate,
  mockPortalMutate,
  mockSearchParams,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockCheckoutMutate: vi.fn(),
  mockPortalMutate: vi.fn(),
  mockSearchParams: vi.fn(),
}));

// Only the chapter payload is stubbed, in the shape `GET /v1/chapters/current`
// really returns. An earlier revision mocked a `{ status }` field that no
// endpoint emits, so the tests passed against a card that could never work.
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
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

// The permission gate has its own tests; here it must not swallow the CTA.
vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { SubscriptionCheckoutCard } =
  await import("./subscription-checkout-card");

function setChapter(
  subscription_status: string | undefined,
  extra: { isPending?: boolean; isError?: boolean } = {},
) {
  mockCurrentChapter.mockReturnValue({
    data: subscription_status ? { subscription_status } : undefined,
    isPending: extra.isPending ?? false,
    isError: extra.isError ?? false,
  });
}

function setParam(value: string | null) {
  mockSearchParams.mockReturnValue({ get: () => value });
}

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SubscriptionCheckoutCard />
    </QueryClientProvider>,
  );
}

describe("SubscriptionCheckoutCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setParam(null);
  });

  it("offers checkout to a chapter stuck at incomplete", () => {
    setChapter("incomplete");
    renderCard();

    expect(
      screen.getByRole("button", { name: /complete checkout/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
  });

  it("stays out of the way once the chapter is active", () => {
    setChapter("active");
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("never offers checkout to a past_due chapter, which would double-subscribe", async () => {
    // A past_due subscription is live and in dunning. A second checkout would
    // bill the chapter twice indefinitely and orphan the first subscription
    // where nothing in the app can surface or cancel it, so recovery is the
    // Portal — which updates the existing subscription in place. Since #929
    // POST /v1/billing/checkout refuses this status outright, so this is now a
    // client affordance over a real server boundary rather than the only guard.
    setChapter("past_due");
    renderCard();

    expect(
      screen.queryByRole("button", { name: /complete checkout/i }),
    ).not.toBeInTheDocument();
    const portal = screen.getByRole("button", { name: /manage billing/i });
    expect(portal).toBeInTheDocument();

    mockPortalMutate.mockResolvedValue({ url: "https://portal.stripe.com/p" });
    await userEvent.click(portal);
    await waitFor(() => expect(mockPortalMutate).toHaveBeenCalled());
    expect(mockCheckoutMutate).not.toHaveBeenCalled();
  });

  it("offers checkout — not the portal — to a canceled chapter (#929)", async () => {
    // The Portal cannot resume a terminated subscription; it only reactivates
    // one still scheduled to cancel at period end, which Stripe reports as
    // `active`. Sending a canceled chapter there was a dead end, and the card
    // used to promise exactly that ("Reopen the subscription from the billing
    // portal"). Checkout is the only way back, and it is safe because the
    // server reuses the chapter's stored customer instead of minting a second.
    setChapter("canceled");
    renderCard();

    expect(
      screen.queryByRole("button", { name: /manage billing/i }),
    ).not.toBeInTheDocument();
    const checkout = screen.getByRole("button", {
      name: /complete checkout/i,
    });
    expect(checkout).toBeInTheDocument();

    mockCheckoutMutate.mockResolvedValue({
      url: "https://checkout.stripe.com/c",
    });
    await userEvent.click(checkout);
    await waitFor(() => expect(mockCheckoutMutate).toHaveBeenCalled());
    expect(mockPortalMutate).not.toHaveBeenCalled();
  });

  it("does not send a canceled chapter to the portal in its copy (#929)", () => {
    // The old copy pointed at a path that cannot work. Guard the promise, not
    // just the button.
    setChapter("canceled");
    renderCard();

    expect(screen.queryByText(/from the billing portal/i)).toBeNull();
  });

  it("renders nothing rather than asserting a lock it cannot prove", () => {
    // Fail open: an unresolved status is most likely a paying chapter behind a
    // slow or failed fetch. Claiming it is unsubscribed — and offering a button
    // that 400s with "already has an active subscription" — is worse.
    setChapter(undefined, { isPending: true });
    const { container: pending } = renderCard();
    expect(pending).toBeEmptyDOMElement();

    setChapter(undefined, { isError: true });
    const { container: errored } = renderCard();
    expect(errored).toBeEmptyDOMElement();

    setChapter("trialing"); // a status this client does not model
    const { container: unknown } = renderCard();
    expect(unknown).toBeEmptyDOMElement();
  });

  it("waits for the webhook instead of claiming success on redirect", () => {
    setChapter("incomplete");
    setParam("success");
    renderCard();

    expect(screen.getByText(/payment received/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /complete checkout/i }),
    ).not.toBeInTheDocument();
  });

  it("confirms activation once the webhook has landed", () => {
    setChapter("active");
    setParam("success");
    renderCard();
    expect(screen.getByText(/subscription active/i)).toBeInTheDocument();
  });

  it("does not let a stale ?checkout=success hide a lapsed chapter's way out", () => {
    // A bookmarked success URL revisited months later, after the chapter has
    // lapsed, must not replace the recovery control with a spinner —
    // §5 rule 3, never gate a user out of the screen that ungates them.
    setChapter("past_due");
    setParam("success");
    renderCard();

    expect(
      screen.getByRole("button", { name: /manage billing/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/activating your chapter/i),
    ).not.toBeInTheDocument();
  });

  it("never offers checkout after the activation poll times out", async () => {
    // This chapter has already paid — the webhook is just late. Falling through
    // to the normal locked card here would hand it a live "Complete checkout"
    // button, and a second checkout mints a second live subscription.
    vi.useFakeTimers();
    try {
      setChapter("incomplete");
      setParam("success");
      renderCard();

      // Burn the whole 10 x 3s budget. Each tick has to be flushed separately:
      // a tick only schedules the next one after React commits the new attempt.
      for (let i = 0; i < 11; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3_000);
        });
      }

      expect(screen.getByText(/still waiting on stripe/i)).toBeInTheDocument();
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

  it("polls after a portal return so a fixed payment is not left showing past_due", () => {
    setChapter("past_due");
    setParam("returned");
    renderCard();

    expect(screen.getByText(/checking stripe/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /manage billing/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps rendering from cached status when a background refetch fails", () => {
    // v5 reports isError while retaining data; blanking the card there would
    // remove the only control that unlocks the chapter.
    mockCurrentChapter.mockReturnValue({
      data: { subscription_status: "incomplete" },
      isPending: false,
      isError: true,
    });
    renderCard();

    expect(
      screen.getByRole("button", { name: /complete checkout/i }),
    ).toBeInTheDocument();
  });

  it("treats a cancelled return as neutral, not as a failure", () => {
    setChapter("incomplete");
    setParam("cancelled");
    renderCard();

    expect(screen.getByText(/no charge was made/i)).toBeInTheDocument();
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

    renderCard();
    await userEvent.click(
      screen.getByRole("button", { name: /complete checkout/i }),
    );

    await waitFor(() => expect(mockCheckoutMutate).toHaveBeenCalledTimes(1));
    expect(mockCheckoutMutate).toHaveBeenCalledWith({
      customer_email: "treasurer@example.edu",
      success_url: "https://app.frapp.test/billing?checkout=success",
      cancel_url: "https://app.frapp.test/billing?checkout=cancelled",
    });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/s"),
    );
  });
});
