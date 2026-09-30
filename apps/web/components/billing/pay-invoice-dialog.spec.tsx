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

// The real `payIntentErrorCopy` passes through, so the dialog renders the
// shared mapping (its cases live in `@repo/hooks`' `pay-errors.spec.ts`).
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePayInvoice: () => payInvoiceMock,
  useAwaitInvoicePaid: () => awaitPaidMock,
}));

import { PayInvoiceDialog } from "./pay-invoice-dialog";

const INVOICE = { id: "inv-1", title: "Fall Dues", amount: 15000 };

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

  it("explains a failure whose server message is empty, rather than a blank line", async () => {
    // Web's own copy of the mapping rendered `""` verbatim until #1068.
    payInvoiceMock.isError = true;
    payInvoiceMock.error = { statusCode: 409, message: "" };

    render(<PayInvoiceDialog invoice={INVOICE} open onOpenChange={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A payment for this invoice is already being processed.",
    );
  });
});
