import { describe, expect, it } from "vitest";
import { payIntentErrorCopy } from "./pay-errors";

/**
 * The four statuses are enumerated in `spec/behavior/billing.md` § Member
 * payment flow. This spec is what makes that a contract rather than a comment.
 */
describe("payIntentErrorCopy", () => {
  it("relays the server's reason for a no-longer-open invoice", () => {
    expect(
      payIntentErrorCopy({ statusCode: 400, message: "Invoice is not open" }),
    ).toBe("Invoice is not open");
  });

  it("does not relay an ownership refusal verbatim", () => {
    // The server's 403 is written for an API caller; a member needs to know it
    // is not their invoice, not that a guard rejected them.
    expect(payIntentErrorCopy({ statusCode: 403, message: "Forbidden" })).toBe(
      "You can only pay your own invoices.",
    );
  });

  it("distinguishes the two 409s using the server's own message", () => {
    // "already completed" and "attempt already in progress" need different
    // things from the member, and only the server knows which one happened.
    expect(
      payIntentErrorCopy({
        statusCode: 409,
        message: "Payment already completed, confirmation pending",
      }),
    ).toContain("confirmation pending");
    expect(payIntentErrorCopy({ statusCode: 409 })).toContain(
      "already being processed",
    );
  });

  it("tells a member to retry a provider outage rather than blaming them", () => {
    expect(payIntentErrorCopy({ statusCode: 503 })).toContain("try again");
  });

  it("reads the status from either shape, and joins a message array", () => {
    expect(payIntentErrorCopy({ status: 404 })).toContain("could not be found");
    expect(payIntentErrorCopy({ message: ["a", "b"] })).toBe("a, b");
  });

  it("falls back to actionable copy for an unrecognised failure", () => {
    expect(payIntentErrorCopy(null)).toBe(
      "Could not start payment. Please try again.",
    );
  });
});
