import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// `stripeLoader` stands in for what `getStripe()` returns: a Promise when a
// publishable key is configured, `null` when it is not. Tests flip it to cover
// the unconfigured environments (local, CI, the production build prerender)
// where the pay affordance must vanish rather than throw.
const { stripeState, payInvoiceMock, awaitPaidMock } = vi.hoisted(() => ({
  stripeState: { loader: null as unknown },
  payInvoiceMock: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isError: false,
    error: null as unknown,
  },
  awaitPaidMock: { mutateAsync: vi.fn() },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => stripeState.loader,
  isStripeConfigured: () => stripeState.loader !== null,
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stripe-elements">{children}</div>
  ),
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: vi.fn() }),
  useElements: () => ({}),
}));

vi.mock("@repo/hooks", () => ({
  usePayInvoice: () => payInvoiceMock,
  useAwaitInvoicePaid: () => awaitPaidMock,
}));

import { PayInvoiceDialog, payIntentErrorCopy } from "./pay-invoice-dialog";

const INVOICE = { id: "inv-1", title: "Fall Dues", amount: 15000 };

describe("payIntentErrorCopy", () => {
  it("maps each real endpoint failure to member-facing copy", () => {
    expect(payIntentErrorCopy({ statusCode: 403 })).toBe(
      "You can only pay your own invoices.",
    );
    expect(payIntentErrorCopy({ statusCode: 404 })).toBe(
      "This invoice could not be found.",
    );
    expect(payIntentErrorCopy({ statusCode: 503 })).toBe(
      "The payment provider is unavailable right now. Please try again.",
    );
  });

  it("prefers the server's wording for the two distinct 409s", () => {
    // These say different things — wait vs retry — so collapsing them into one
    // generic string would lose the only signal that tells them apart.
    expect(
      payIntentErrorCopy({
        statusCode: 409,
        message: "Payment already completed; confirmation is being processed",
      }),
    ).toBe("Payment already completed; confirmation is being processed");
    expect(
      payIntentErrorCopy({
        statusCode: 409,
        message:
          "A payment attempt for this invoice is already in progress. Please retry in a moment.",
      }),
    ).toBe(
      "A payment attempt for this invoice is already in progress. Please retry in a moment.",
    );
  });

  it("keeps the 400's current-status detail, which tells the member why", () => {
    expect(
      payIntentErrorCopy({
        statusCode: 400,
        message: "Only OPEN invoices can be paid (current status: VOID)",
      }),
    ).toBe("Only OPEN invoices can be paid (current status: VOID)");
  });

  it("falls back safely on unrecognized and malformed errors", () => {
    expect(payIntentErrorCopy(undefined)).toBe(
      "Could not start payment. Please try again.",
    );
    expect(payIntentErrorCopy({ statusCode: 418 })).toBe(
      "Could not start payment. Please try again.",
    );
    // NestJS validation errors arrive as an array of strings.
    expect(payIntentErrorCopy({ message: ["a", "b"] })).toBe("a, b");
  });
});

describe("PayInvoiceDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeState.loader = Promise.resolve({});
    payInvoiceMock.isError = false;
    payInvoiceMock.error = null;
    payInvoiceMock.mutate = vi.fn();
  });

  it("renders nothing when Stripe is not configured", () => {
    stripeState.loader = null;

    const { container } = render(
      <PayInvoiceDialog invoice={INVOICE} open onOpenChange={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(payInvoiceMock.mutate).not.toHaveBeenCalled();
  });

  it("requests a payment intent for the opened invoice", async () => {
    render(<PayInvoiceDialog invoice={INVOICE} open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(payInvoiceMock.mutate).toHaveBeenCalledWith(
        "inv-1",
        expect.anything(),
      );
    });
  });

  it("renders the payment sheet once the client secret arrives", async () => {
    payInvoiceMock.mutate = vi.fn(
      (_id: string, options: { onSuccess: (data: unknown) => void }) => {
        options.onSuccess({ client_secret: "pi_1_secret_x" });
      },
    );

    render(<PayInvoiceDialog invoice={INVOICE} open onOpenChange={() => {}} />);

    expect(await screen.findByTestId("payment-element")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pay \$150\.00/ })).toBeInTheDocument();
  });

  it("shows mapped error copy instead of the payment sheet when the intent fails", async () => {
    payInvoiceMock.isError = true;
    payInvoiceMock.error = { statusCode: 403 };

    render(<PayInvoiceDialog invoice={INVOICE} open onOpenChange={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can only pay your own invoices.",
    );
    expect(screen.queryByTestId("payment-element")).not.toBeInTheDocument();
  });
});
