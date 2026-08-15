import { render, screen, waitFor } from "@testing-library/react";
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

const { SubscriptionCheckoutCard } = await import("./subscription-checkout-card");

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

  it("never offers checkout to a lapsed chapter, which would double-subscribe", async () => {
    // POST /v1/billing/checkout rejects only `active`, and Stripe is handed
    // `customer_email` rather than the stored customer id — so a second
    // checkout on a past_due chapter creates a second live subscription while
    // the first keeps dunning. Lapsed chapters must go to the portal.
    for (const status of ["past_due", "canceled"] as const) {
      setChapter(status);
      const { unmount } = renderCard();

      expect(
        screen.queryByRole("button", { name: /complete checkout/i }),
      ).not.toBeInTheDocument();
      const portal = screen.getByRole("button", { name: /manage billing/i });
      expect(portal).toBeInTheDocument();

      mockPortalMutate.mockResolvedValue({ url: "https://portal.stripe.com/p" });
      await userEvent.click(portal);
      await waitFor(() => expect(mockPortalMutate).toHaveBeenCalled());
      expect(mockCheckoutMutate).not.toHaveBeenCalled();

      unmount();
      vi.clearAllMocks();
    }
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
    expect(screen.queryByText(/activating your chapter/i)).not.toBeInTheDocument();
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
