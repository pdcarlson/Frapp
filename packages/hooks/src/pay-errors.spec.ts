import { describe, expect, it } from "vitest";
import { payIntentErrorCopy } from "./pay-errors";

/**
 * Web's pay dialog and mobile s11 both render these. The statuses are
 * enumerated in `spec/behavior/billing.md` § Member payment flow; this spec is
 * what makes that a contract rather than a comment.
 */
describe("payIntentErrorCopy", () => {
  it("keeps the 400's current-status detail, which tells the member why", () => {
    expect(
      payIntentErrorCopy({
        statusCode: 400,
        message: "Only OPEN invoices can be paid (current status: VOID)",
      }),
    ).toBe("Only OPEN invoices can be paid (current status: VOID)");
    expect(payIntentErrorCopy({ statusCode: 400 })).toBe(
      "This invoice is no longer open for payment.",
    );
  });

  it("does not relay an ownership refusal verbatim", () => {
    // The server's 403 is written for an API caller; a member needs to know it
    // is not their invoice, not that a guard rejected them.
    expect(payIntentErrorCopy({ statusCode: 403, message: "Forbidden" })).toBe(
      "You can only pay your own invoices.",
    );
  });

  it("names a missing invoice", () => {
    expect(payIntentErrorCopy({ statusCode: 404 })).toBe(
      "This invoice could not be found.",
    );
  });

  it("prefers the server's wording for the two distinct 409s", () => {
    // "Already completed" and "attempt already in progress" need different
    // things from the member (wait vs retry), and only the server knows which.
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
    expect(payIntentErrorCopy({ statusCode: 409 })).toBe(
      "A payment for this invoice is already being processed.",
    );
  });

  it("tells a member to retry a provider outage rather than blaming them", () => {
    expect(payIntentErrorCopy({ statusCode: 503 })).toBe(
      "The payment provider is unavailable right now. Please try again.",
    );
  });

  it("reads the status from either shape, and joins a message array", () => {
    expect(payIntentErrorCopy({ status: 404 })).toBe(
      "This invoice could not be found.",
    );
    // NestJS validation errors arrive as an array of strings.
    expect(payIntentErrorCopy({ message: ["a", "b"] })).toBe("a, b");
  });

  it("reads an empty server message as absent, never as a blank line", () => {
    // The difference #1068 settled: web's old copy rendered `""` verbatim.
    expect(payIntentErrorCopy({ statusCode: 400, message: "" })).toBe(
      "This invoice is no longer open for payment.",
    );
    expect(payIntentErrorCopy({ statusCode: 409, message: [] })).toBe(
      "A payment for this invoice is already being processed.",
    );
    expect(payIntentErrorCopy({ statusCode: 500, message: "" })).toBe(
      "Could not start payment. Please try again.",
    );
  });

  it("falls back to actionable copy for an unrecognised or malformed failure", () => {
    for (const error of [undefined, null, { statusCode: 418 }]) {
      expect(payIntentErrorCopy(error)).toBe(
        "Could not start payment. Please try again.",
      );
    }
  });
});
