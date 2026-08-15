import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockBillingStatus, mockCheckoutMutate, mockRefetch, mockSearchParams } =
  vi.hoisted(() => ({
    mockBillingStatus: vi.fn(),
    mockCheckoutMutate: vi.fn(),
    mockRefetch: vi.fn(),
    mockSearchParams: vi.fn(),
  }));

vi.mock("@repo/hooks", () => ({
  useBillingStatus: () => mockBillingStatus(),
  useCurrentUser: () => ({ data: { email: "treasurer@example.edu" } }),
  useCreateCheckout: () => ({
    mutateAsync: mockCheckoutMutate,
    isPending: false,
  }),
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

function setStatus(status: string | undefined) {
  mockBillingStatus.mockReturnValue({
    data: status ? { status } : undefined,
    refetch: mockRefetch,
  });
}

function setParam(value: string | null) {
  mockSearchParams.mockReturnValue({ get: () => value });
}

describe("SubscriptionCheckoutCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setParam(null);
  });

  it("offers checkout to a chapter stuck at incomplete", () => {
    setStatus("incomplete");
    render(<SubscriptionCheckoutCard />);

    expect(
      screen.getByRole("button", { name: /complete checkout/i }),
    ).toBeInTheDocument();
    // The API's own message, so client and server say the same thing.
    expect(
      screen.getByText(/subscription is not active/i),
    ).toBeInTheDocument();
  });

  it("stays out of the way once the chapter is active", () => {
    setStatus("active");
    const { container } = render(<SubscriptionCheckoutCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the blocker for past_due and canceled rather than reusing one string", () => {
    setStatus("past_due");
    const { unmount } = render(<SubscriptionCheckoutCard />);
    expect(screen.getByText(/payment is past due/i)).toBeInTheDocument();
    unmount();

    setStatus("canceled");
    render(<SubscriptionCheckoutCard />);
    expect(screen.getByText(/subscription canceled/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /restart subscription/i }),
    ).toBeInTheDocument();
  });

  it("waits for the webhook instead of claiming success on redirect", () => {
    // The whole point of #860 item 4: Stripe redirects back before the
    // subscription flips, so the card must not assert `active`.
    setStatus("incomplete");
    setParam("success");
    render(<SubscriptionCheckoutCard />);

    expect(screen.getByText(/payment received/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /complete checkout/i }),
    ).not.toBeInTheDocument();
  });

  it("confirms activation once the webhook has landed", () => {
    setStatus("active");
    setParam("success");
    render(<SubscriptionCheckoutCard />);
    expect(screen.getByText(/subscription active/i)).toBeInTheDocument();
  });

  it("treats a cancelled return as neutral, not as a failure", () => {
    setStatus("incomplete");
    setParam("cancelled");
    render(<SubscriptionCheckoutCard />);

    expect(screen.getByText(/no charge was made/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /complete checkout/i }),
    ).toBeInTheDocument();
  });

  it("sends the caller's email and a round-trippable return pair", async () => {
    setStatus("incomplete");
    mockCheckoutMutate.mockResolvedValue({ url: "https://checkout.stripe.com/s" });
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { origin: "https://app.frapp.test", assign },
      writable: true,
    });

    render(<SubscriptionCheckoutCard />);
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
