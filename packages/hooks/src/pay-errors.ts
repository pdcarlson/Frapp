import { serverMessageOf, statusOf } from "@repo/api-sdk";

/**
 * Copy for a failed `POST /v1/invoices/:id/payment-intent`, shared by web's
 * pay dialog and mobile s11 so the same failure reads the same on both. It was
 * two copies until #1068, and they had already diverged: web rendered an empty
 * server `message` as a blank line, where this falls back to actionable copy.
 *
 * `spec/behavior/billing.md` § Member payment flow enumerates the endpoint's
 * failures (400, 403, 404, 409, 503), so every branch is a response the
 * endpoint really returns. It is a named, tested function rather than an inline ternary
 * because this mapping is the part most likely to regress silently if the
 * API's error shape changes.
 *
 * Where the server's own wording is precise and safe to show, it wins over a
 * generic string. The two 409s ("already completed, confirmation pending" and
 * "an attempt is already in flight") need different things from the member, and
 * only the server knows which happened; the 400's current-status text says why
 * the invoice can't be paid. `serverMessageOf` reads an empty string or array
 * as absent, so the fallback wins instead of a blank line.
 */
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
        serverMessage ??
        "A payment for this invoice is already being processed."
      );
    case 503:
      return "The payment provider is unavailable right now. Please try again.";
    default:
      return serverMessage ?? "Could not start payment. Please try again.";
  }
}
