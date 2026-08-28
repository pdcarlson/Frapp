/**
 * Copy for a failed `POST /v1/invoices/:id/payment-intent`.
 *
 * Ported from `apps/web/components/billing/pay-invoice-dialog.tsx`, whose own
 * docblock explains why it is a named, tested function rather than an inline
 * ternary: "this mapping is the part most likely to silently regress if the
 * API's error shape changes". The four statuses are enumerated in
 * `spec/behavior/billing.md` § Member payment flow, so this is a contract, not
 * a guess.
 *
 * The two 409s are deliberately left to the server's own message: it is the only
 * party that knows whether the payment already completed or another attempt is
 * still in flight, and those need different things from the member.
 *
 * One behavioural difference from the web copy, and it is a fix rather than
 * drift: `serverMessageOf` treats an empty `message` as absent, so this falls
 * back to actionable copy where web renders a blank line. Consolidating the two
 * into `@repo/hooks` beside `usePayInvoice` is filed separately — doing it here
 * would change web's behaviour inside a mobile slice.
 */
import { serverMessageOf, statusOf } from "@repo/api-sdk";

export function payIntentErrorCopy(error: unknown): string {
  const status = statusOf(error);
  const serverMessage = serverMessageOf(error);

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
