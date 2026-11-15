"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import {
  type AwaitInvoicePaidResult,
  payIntentErrorCopy,
  paymentFailedCopy,
  useAwaitInvoicePaid,
  usePayInvoice,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getStripe } from "@/lib/stripe";
import { formatCurrency } from "@/lib/currency";

export type PayableInvoice = {
  id: string;
  title: string;
  amount: number;
};

/**
 * How the attempt ended, as the server reports it: PAID, failed (the
 * `payment_intent.payment_failed` webhook recorded it on the invoice, #3460),
 * or still unconfirmed when the poll gave up.
 */
type Outcome = (AwaitInvoicePaidResult & { since: number }) | null;

/**
 * How often an open dialog re-reads an unconfirmed payment once the poll has
 * given up, so a processing payment that fails later still ends "Payment
 * received" in front of the member (#3460).
 */
const PENDING_REREAD_MS = 10_000;

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
    // This try's own moment: a decline from an earlier try in this form is
    // still recorded on the invoice and must not read as this one's outcome.
    const since = Date.now();

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

    if (
      paymentIntent?.status === "succeeded" ||
      paymentIntent?.status === "processing"
    ) {
      // Money moved, or is moving. The invoice row has NOT necessarily
      // settled — the `payment_intent.succeeded` webhook is what writes PAID,
      // and a processing payment can still fail, which its webhook records on
      // the invoice (#3460) — so ask the server rather than assuming.
      try {
        onOutcome({
          ...(await awaitPaid.mutateAsync({ invoiceId: invoice.id, since })),
          since,
        });
      } catch {
        onOutcome({ outcome: "pending", since });
      }
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
        <p role="alert" className="text-sm text-destructive-text">
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
  const reread = useAwaitInvoicePaid({ attempts: 1 });
  const { mutateAsync: rereadOnce } = reread;

  const invoiceId = invoice?.id ?? null;
  const { mutate: createIntent, reset: resetIntent } = payInvoice;

  // Each call is a new payment attempt: the pay endpoint stamps it and clears
  // the last attempt's recorded failure (#3460), so the poll after this one
  // can't read an earlier failure as its own. That is why "Try again" after a
  // failure comes back through here rather than reusing the client secret.
  const startAttempt = useCallback(
    (id: string) => {
      setClientSecret(null);
      setOutcome(null);
      resetIntent();
      createIntent(id, {
        onSuccess: (data) => {
          setClientSecret(
            (data as { client_secret?: string } | undefined)?.client_secret ??
              null,
          );
        },
      });
    },
    [createIntent, resetIntent],
  );

  useEffect(() => {
    if (!open || !invoiceId || !stripePromise) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new PaymentIntent per open/invoice; a leftover secret would charge the previous invoice
    startAttempt(invoiceId);
  }, [open, invoiceId, stripePromise, startAttempt]);

  // While the dialog says "Payment received", keep asking: PAID settles it,
  // and a recorded failure newer than the submit ends it with "didn't go
  // through".
  const pendingSince = outcome?.outcome === "pending" ? outcome.since : null;
  useEffect(() => {
    if (!open || !invoiceId || pendingSince === null) return;
    let stopped = false;
    const timer = setInterval(() => {
      void rereadOnce({ invoiceId, since: pendingSince })
        .then((next) => {
          if (stopped || next.outcome === "pending") return;
          setOutcome({ ...next, since: pendingSince });
        })
        .catch(() => {
          // A failed read says nothing about the payment; the next tick asks again.
        });
    }, PENDING_REREAD_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, invoiceId, pendingSince, rereadOnce]);

  if (!invoice || !stripePromise) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay {invoice.title}</DialogTitle>
          <DialogDescription>
            {formatCurrency(invoice.amount)} due to your chapter.
          </DialogDescription>
        </DialogHeader>

        {outcome?.outcome === "failed" ? (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-destructive-text">
              {paymentFailedCopy(outcome.reason)}
            </p>
            <Button className="w-full" onClick={() => startAttempt(invoice.id)}>
              Try again
            </Button>
          </div>
        ) : outcome ? (
          <div className="space-y-4">
            <p className="text-sm" role="status">
              {outcome.outcome === "paid"
                ? "Payment complete. This invoice is now marked paid."
                : "Payment received. Your chapter's records update as soon as the confirmation lands, usually within a minute."}
            </p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : payInvoice.isError ? (
          <p role="alert" className="text-sm text-destructive-text">
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
