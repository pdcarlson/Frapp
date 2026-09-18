import { describe, it, expect } from "vitest";

/**
 * Moved here from `apps/web/lib/subscription.test.ts` with the Wave 1 item 9
 * re-home, travelling with the implementation when it became the third shared
 * client gate in `@repo/validation`. Unchanged otherwise — an unmodified suite
 * passing against the moved code is the no-regression proof for the move.
 */
import {
  SUBSCRIPTION_GRACE_PERIOD_MS,
  isWithinSubscriptionGrace,
  subscriptionRefusalFromServerMessage,
  subscriptionWriteState,
} from "./subscription";

// A fixed "now" so grace-window cases are deterministic.
const NOW = Date.parse("2026-08-15T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString();

describe("isWithinSubscriptionGrace", () => {
  it("fails open when the lapse timestamp is missing or unparseable", () => {
    // Matches the guard: an unknown lapse start must never hard-lock early.
    expect(isWithinSubscriptionGrace(null, NOW)).toBe(true);
    expect(isWithinSubscriptionGrace(undefined, NOW)).toBe(true);
    expect(isWithinSubscriptionGrace("not-a-date", NOW)).toBe(true);
  });

  it("treats the exact boundary as still inside the window", () => {
    const boundary = new Date(NOW - SUBSCRIPTION_GRACE_PERIOD_MS).toISOString();
    expect(isWithinSubscriptionGrace(boundary, NOW)).toBe(true);
    expect(isWithinSubscriptionGrace(hoursAgo(72.5), NOW)).toBe(false);
  });
});

describe("subscriptionWriteState", () => {
  it("allows every write class while active", () => {
    for (const writeClass of ["paid", "free-tier", "grace-blocked"] as const) {
      expect(subscriptionWriteState({ status: "active", writeClass })).toEqual({
        allowed: true,
      });
    }
  });

  it("locks canceled chapters read-only, with no self-serve recovery", () => {
    const state = subscriptionWriteState({ status: "canceled" });
    expect(state).toMatchObject({
      allowed: false,
      code: "chapter.subscription.canceled",
      recoverable: false,
    });
  });

  it("blocks paid writes on an incomplete chapter but leaves free-tier alone", () => {
    // The #858 repro: POST /v1/invoices is paid-ops, so its trigger must gate.
    expect(subscriptionWriteState({ status: "incomplete" })).toMatchObject({
      allowed: false,
      code: "chapter.subscription.required",
      recoverable: true,
    });
    expect(
      subscriptionWriteState({ status: "incomplete", writeClass: "free-tier" }),
    ).toEqual({ allowed: true });
  });

  it("canceled outranks the free-tier carve-out", () => {
    // The guard checks canceled before reading @FreeTier, so a free-tier route
    // on a canceled chapter is still blocked.
    expect(
      subscriptionWriteState({ status: "canceled", writeClass: "free-tier" }),
    ).toMatchObject({ code: "chapter.subscription.canceled" });
  });

  describe("past_due", () => {
    it("blocks paid writes immediately, grace or not", () => {
      expect(
        subscriptionWriteState({
          status: "past_due",
          pastDueSince: hoursAgo(1),
        }),
      ).toMatchObject({ code: "chapter.subscription.write_locked" });
    });

    it("keeps free-tier writes alive inside grace and stops them after", () => {
      expect(
        subscriptionWriteState({
          status: "past_due",
          pastDueSince: hoursAgo(1),
          writeClass: "free-tier",
          now: NOW,
        }),
      ).toEqual({ allowed: true });

      expect(
        subscriptionWriteState({
          status: "past_due",
          pastDueSince: hoursAgo(80),
          writeClass: "free-tier",
          now: NOW,
        }),
      ).toMatchObject({ code: "chapter.subscription.write_locked" });
    });

    it("names invites specifically inside grace, then falls back to write_locked", () => {
      expect(
        subscriptionWriteState({
          status: "past_due",
          pastDueSince: hoursAgo(1),
          writeClass: "grace-blocked",
          now: NOW,
        }),
      ).toMatchObject({ code: "chapter.subscription.invite_blocked" });

      // Past grace, invites are not special — everything is locked.
      expect(
        subscriptionWriteState({
          status: "past_due",
          pastDueSince: hoursAgo(80),
          writeClass: "grace-blocked",
          now: NOW,
        }),
      ).toMatchObject({ code: "chapter.subscription.write_locked" });
    });
  });
});

describe("subscriptionRefusalFromServerMessage", () => {
  /**
   * The messages this matches are the only thing that survives the wire.
   * `AllExceptionsFilter` serialises `{statusCode, error, message, requestId}`
   * and drops the `code` the guard throws (#1020), so a client branching on
   * `codeOf` gets `null` for every real response. #2297 is the bug that
   * caused: three mobile write surfaces read a permanent subscription refusal
   * as an ordinary save failure and invited a retry that cannot win.
   */
  it("recognises all four refusals the guard can throw", () => {
    const messages = [
      "Chapter subscription is canceled; this chapter is read-only.",
      "Chapter subscription is past due; write actions are blocked until payment is resolved.",
      "Chapter subscription is past due; new invites are blocked until payment is resolved.",
      "Chapter subscription is not active; complete checkout to use this feature.",
    ];
    const codes = messages.map(
      (m) => subscriptionRefusalFromServerMessage(m)?.code,
    );
    expect(codes).toEqual([
      "chapter.subscription.canceled",
      "chapter.subscription.write_locked",
      "chapter.subscription.invite_blocked",
      "chapter.subscription.required",
    ]);
  });

  it("carries the recoverable flag, so canceled can be told from the rest", () => {
    // `canceled` is the one state a member cannot have resolved by payment, so
    // copy keyed off this must not promise that paying fixes it.
    expect(
      subscriptionRefusalFromServerMessage(
        "Chapter subscription is canceled; this chapter is read-only.",
      )?.recoverable,
    ).toBe(false);
    expect(
      subscriptionRefusalFromServerMessage(
        "Chapter subscription is not active; complete checkout to use this feature.",
      )?.recoverable,
    ).toBe(true);
  });

  it("does not match on a prefix, which would claim a BillingService 400", () => {
    // `billing.service.ts` throws "Chapter subscription is past due, not
    // cancelled. Update the payment method…" as a 400 on the checkout path. A
    // `startsWith("Chapter subscription")` test would call that a guard
    // refusal and strip the retry from a recoverable failure.
    expect(
      subscriptionRefusalFromServerMessage(
        "Chapter subscription is past due, not cancelled. Update the payment method from the billing portal.",
      ),
    ).toBeNull();
    expect(
      subscriptionRefusalFromServerMessage("Chapter subscription"),
    ).toBeNull();
  });

  it("returns null for the other refusals that share these routes", () => {
    // These arrive as 403 on the very same write routes. Treating them as a
    // permanent gate is the regression that got a previous attempt reverted:
    // each recovers on its own and must keep its retry control.
    for (const message of [
      "No roles assigned",
      "No valid roles found",
      "Chapter context is required",
      "Your chapter isn't tracking study hours right now.",
    ]) {
      expect(subscriptionRefusalFromServerMessage(message)).toBeNull();
    }
  });

  it("is null-safe, because serverMessageOf returns null for an absent message", () => {
    expect(subscriptionRefusalFromServerMessage(null)).toBeNull();
    expect(subscriptionRefusalFromServerMessage(undefined)).toBeNull();
    expect(subscriptionRefusalFromServerMessage("")).toBeNull();
  });
});
