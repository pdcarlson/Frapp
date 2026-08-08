"use client";

import { useEffect, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useAwaitInvoicePaid, usePayInvoice } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getStripe } from "@/lib/stripe";

export type PayableInvoice = {
  id: string;
  title: string;
  amount: number;
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/**
 * Map a `POST /v1/invoices/:id/payment-intent` failure to member-facing copy.
 *
 * Every branch here is a response the endpoint really returns, so none of them
 * are hypothetical. Where the server's own wording is precise and safe to show
 * — the two distinct 409s ("already completed, confirmation processing" vs
 * "an attempt is already in flight, retry") and the 400's current-status text —
 * we prefer it over a generic string, because the difference is exactly what
 * tells a member whether to wait or to stop.
 *
 * Exported for unit testing: this mapping is the part most likely to silently
 * regress if the API's error shape changes.
 */
export function payIntentErrorCopy(error: unknown): string {
  const candidate = (error ?? {}) as {
    statusCode?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const status =
    typeof candidate.statusCode === "number"
      ? candidate.statusCode
      : typeof candidate.status === "number"
        ? candidate.status
        : undefined;
  const serverMessage =
    typeof candidate.message === "string"
      ? candidate.message
      : Array.isArray(candidate.message)
        ? candidate.message.join(", ")
        : null;

  switch (status) {
    case 400:
      return serverMessage ?? "This invoice is no longer open for payment.";
    case 403:
      return "You can only pay your own invoices.";
    case 404:
      return "This invoice could not be found.";
    case 409:
      return (
        serverMessage ?? "A payment for this invoice is already being processed."
      );
    case 503:
      return "The payment provider is unavailable right now. Please try again.";
    default:
      return serverMessage ?? "Could not start payment. Please try again.";
  }
}

type Outcome = { settled: boolean } | null;

/**
 * The confirm step. Lives inside <Elements> because `useStripe`/`useElements`
 * only resolve within that provider.
 */
function PayInvoiceForm({
  invoice,
  onOutcome,
}: {
  invoice: PayableInvoice;
  onOutcome: (outcome: NonNullable<Outcome>) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const awaitPaid = useAwaitInvoicePaid();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    // `redirect: "if_required"` keeps 3-D Secure in a Stripe-owned modal
    // instead of navigating away, so the member stays on the billing page and
    // we keep control of the post-payment refresh.
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed. Please try again.");
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      // Money moved. The invoice row has NOT necessarily settled — the
      // `payment_intent.succeeded` webhook is what writes PAID — so ask the
      // server rather than assuming.
      try {
        onOutcome({ settled: await awaitPaid.mutateAsync(invoice.id) });
      } catch {
        onOutcome({ settled: false });
      }
      return;
    }

    if (paymentIntent?.status === "processing") {
      onOutcome({ settled: false });
      return;
    }

    setError(
      "This payment needs additional authentication that could not be completed. Please try again.",
    );
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={!stripe || submitting}>
        {submitting ? "Processing…" : `Pay ${formatCurrency(invoice.amount)}`}
      </Button>
    </form>
  );
}

/**
 * Member-facing payment sheet for one of the caller's own OPEN invoices.
 *
 * Renders nothing at all when Stripe is unconfigured — the caller is expected
 * to hide the trigger too, but a dialog that cannot possibly work should not be
 * openable by any route.
 */
export function PayInvoiceDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: PayableInvoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const stripePromise = getStripe();
  const payInvoice = usePayInvoice();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const invoiceId = invoice?.id ?? null;
  const { mutate: createIntent, reset: resetIntent } = payInvoice;

  useEffect(() => {
    if (!open || !invoiceId || !stripePromise) return;
    setClientSecret(null);
    setOutcome(null);
    resetIntent();
    createIntent(invoiceId, {
      onSuccess: (data) => {
        setClientSecret(
          (data as { client_secret?: string } | undefined)?.client_secret ??
            null,
        );
      },
    });
  }, [open, invoiceId, stripePromise, createIntent, resetIntent]);

  if (!invoice || !stripePromise) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay {invoice.title}</DialogTitle>
          <DialogDescription>
            {formatCurrency(invoice.amount)} due to your chapter.
          </DialogDescription>
        </DialogHeader>

        {outcome ? (
          <div className="space-y-4">
            <p className="text-sm" role="status">
              {outcome.settled
                ? "Payment complete — this invoice is now marked paid."
                : "Payment received. Your chapter's records update as soon as the confirmation lands, usually within a minute."}
            </p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : payInvoice.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {payIntentErrorCopy(payInvoice.error)}
          </p>
        ) : clientSecret ? (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <PayInvoiceForm invoice={invoice} onOutcome={setOutcome} />
          </Elements>
        ) : (
          <p className="text-sm text-muted-foreground">Preparing payment…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
