import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "./subscription-refusal";

/**
 * Fixtures are the shape `AllExceptionsFilter` really emits — exactly
 * `{statusCode, error, message, requestId}`, with **no `code`**. Building them
 * any other way is how #2297's first attempt "passed": a fixture carrying
 * `code` proves a branch that can never fire in production.
 */
function wireError(statusCode: number, message: string) {
  return {
    statusCode,
    error: statusCode === 403 ? "Forbidden" : "Bad Request",
    message,
    requestId: "req_test",
  };
}

const REQUIRED = "Chapter subscription is not active; complete checkout to use this feature.";
const CANCELED = "Chapter subscription is canceled; this chapter is read-only.";
const WRITE_LOCKED =
  "Chapter subscription is past due; write actions are blocked until payment is resolved.";

describe("subscriptionRefusalOf", () => {
  it("recognises the refusal a freshly created chapter produces", () => {
    // `subscription_status` defaults to 'incomplete', so this is what every
    // paid-ops write returns for a founder who has not been through checkout.
    const refusal = subscriptionRefusalOf(wireError(403, REQUIRED));
    expect(refusal?.code).toBe("chapter.subscription.required");
  });

  it("recognises the other refusals on the same routes", () => {
    expect(subscriptionRefusalOf(wireError(403, CANCELED))?.code).toBe(
      "chapter.subscription.canceled",
    );
    expect(subscriptionRefusalOf(wireError(403, WRITE_LOCKED))?.code).toBe(
      "chapter.subscription.write_locked",
    );
  });

  it("does not fire on the other 403s these write routes produce", () => {
    // Both write controllers carry a class-level `@RequirePermissions`, and the
    // `chapter.context.*` family survives up to the 3600s JWT lifetime. All of
    // them recover by themselves, so all of them must keep their retry. A
    // previous attempt branched on a bare 403 and deleted the retry from
    // exactly these.
    for (const message of [
      "No roles assigned",
      "No valid roles found",
      "Chapter context does not match the authenticated member",
    ]) {
      expect(subscriptionRefusalOf(wireError(403, message))).toBeNull();
    }
  });

  it("requires the 403, so the BillingService 400 cannot be mistaken for it", () => {
    expect(
      subscriptionRefusalOf(
        wireError(
          400,
          "Chapter subscription is past due, not cancelled. Update the payment method from the billing portal.",
        ),
      ),
    ).toBeNull();
  });

  it("ignores a `code` key, because production never sends one", () => {
    // Guards against a future refactor quietly reintroducing a `codeOf` path:
    // the code alone, without the message, must not be enough.
    expect(
      subscriptionRefusalOf({
        statusCode: 403,
        error: "Forbidden",
        code: "chapter.subscription.required",
        message: "Something else entirely",
        requestId: "req_test",
      }),
    ).toBeNull();
  });

  it("is safe on the shapes a thrown non-API error takes", () => {
    expect(subscriptionRefusalOf(null)).toBeNull();
    expect(subscriptionRefusalOf(undefined)).toBeNull();
    expect(subscriptionRefusalOf(new Error("Network request failed"))).toBeNull();
    expect(subscriptionRefusalOf({})).toBeNull();
  });
});

describe("SUBSCRIPTION_REFUSAL_COPY", () => {
  const all = Object.values(SUBSCRIPTION_REFUSAL_COPY);

  it("names no price, plan, purchase path or link on any surface", () => {
    // `apps/mobile/store/README.md:32`/`:179` are the submitted App Store
    // Connect answers: no in-app purchases, and subscriptions "are not
    // offered, linked or mentioned in the app". Copy that names checkout here
    // trades this Guideline 2.1 finding for a 3.1.1 one.
    for (const copy of all) {
      expect(copy).not.toMatch(
        /checkout|subscribe|upgrade|pay(?:ment)?\b|price|pricing|plan\b|billing|\$|https?:\/\//i,
      );
    }
  });

  it("points at an officer, the only actor a member has", () => {
    for (const copy of all) {
      expect(copy).toMatch(/officer/i);
    }
  });

  it("never invites a retry", () => {
    // The whole finding is that the app blamed the save and said "try again"
    // for a refusal that cannot be retried into success.
    for (const copy of all) {
      expect(copy).not.toMatch(/try again|retry|again later/i);
    }
  });

  it("names the blocked action per surface rather than sharing one string", () => {
    expect(SUBSCRIPTION_REFUSAL_COPY.task).toMatch(/task/i);
    expect(SUBSCRIPTION_REFUSAL_COPY.checkIn).toMatch(/check-in/i);
    expect(SUBSCRIPTION_REFUSAL_COPY.study).toMatch(/study/i);
    expect(new Set(all).size).toBe(all.length);
  });
});
