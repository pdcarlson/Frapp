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

/**
 * The store-commitment guard, and a test of the guard itself.
 *
 * The first version of these patterns was far too narrow to do the job its
 * name claimed: `purchase`, `paying`, a schemeless `frapp.live/subscribe` and
 * a price written without a `$` all sailed through, as did "give it another
 * go" past the retry check. A guard that cannot fail on the wording it exists
 * to catch is worse than none, because it reads like coverage. So the banned
 * patterns are asserted against known-bad candidates below before they are
 * applied to the shipped copy.
 */
const PURCHASE_PATH = new RegExp(
  [
    // Buying, in any inflection.
    String.raw`\b(?:purchas\w*|buy|buying|bought|renew\w*|pay|pays|paying|payment\w*|billing|checkout|check out|subscribe|subscribing|upgrade\w*)\b`,
    // Money, symbol or spelled. "forty-nine dollars a month" has neither a
    // digit nor a symbol and passed the first version of this guard.
    String.raw`\$|€|£|\b(?:usd|dollars?|cents?|price\w*|pricing|cost\w*|free trial|trial period)\b`,
    String.raw`\d+\s*(?:\/|per|a|an)?\s*(?:month|year|mo|yr)\b`,
    // The VENUE is the breach, not just the transaction: the store answers say
    // subscriptions are "not offered, LINKED OR MENTIONED in the app".
    String.raw`\b(?:web dashboard|web app|website|dashboard online|on the web)\b`,
    // Links, with or without a scheme.
    String.raw`https?:\/\/|\b[a-z0-9-]+\.(?:live|com|app|io|net|org|co)\b`,
  ].join("|"),
  "i",
);

// Deliberately NOT banned: `plan`, `card`, `paid`. Each is an ordinary state
// word here ("you can't plan study time", "this card is read-only", "dues
// can't be paid") and banning them blocks correct copy without catching a
// purchase path, which is what the patterns above are for.

const INVITES_RETRY =
  /\b(?:try (?:again|that again|it again|once more)|tries again|retry|retrying|again later|another (?:go|crack|attempt)|once more|re-?try|have another)\b/i;

describe("the copy guard itself", () => {
  it("rejects the wordings that would breach the store declaration", () => {
    // Every one of these passed the first version of this guard.
    for (const bad of [
      "An officer can purchase a seat pack from the Frapp web app.",
      "An officer can renew it by paying with a card in the web dashboard.",
      "An officer can fix this at frapp.live/subscription.",
      "An officer can sort this out — it costs 49 a month.",
      "An officer can complete checkout on the dashboard.",
      "Ask an officer to subscribe.",
      "An officer can upgrade the chapter's plan.",
      "See https://frapp.live/billing to fix this.",
      // These four passed the SECOND version of this guard too, and are why
      // it is asserted rather than eyeballed: naming the venue is itself the
      // breach, and money need not carry a digit or a symbol.
      "An officer can sort this out from the Frapp web dashboard.",
      "An officer can fix it on the website.",
      "An officer can sort this out — it's forty-nine dollars a month.",
      "An officer can sort this out; 49 USD monthly.",
    ]) {
      expect(bad).toMatch(PURCHASE_PATH);
    }
  });

  it("rejects retry invitations, including the ones that avoid the word", () => {
    for (const bad of [
      "That didn't save — try again.",
      "Give it another go.",
      "Retry in a moment.",
      "Check your connection and try again later.",
      "Try that again in a moment.",
      "Have another crack at it.",
    ]) {
      expect(bad).toMatch(INVITES_RETRY);
    }
  });

  it("does not fire on the vocabulary the shipped copy legitimately needs", () => {
    // "subscription" and "active" describe the state and must stay allowed;
    // otherwise the guard would forbid naming the thing that is wrong.
    expect("Your chapter's subscription isn't active.").not.toMatch(
      PURCHASE_PATH,
    );
    expect("An officer can sort this out for the chapter.").not.toMatch(
      PURCHASE_PATH,
    );
    expect("Your session is still running.").not.toMatch(INVITES_RETRY);
    // The words the guard must NOT claim, or it blocks correct copy.
    for (const fine of [
      "so you can't plan new study time",
      "so this card is read-only",
      "so dues can't be paid right now",
    ]) {
      expect(fine).not.toMatch(PURCHASE_PATH);
    }
  });
});

describe("SUBSCRIPTION_REFUSAL_COPY", () => {
  const all = Object.values(SUBSCRIPTION_REFUSAL_COPY);

  it("names no price, plan, purchase path or link on any surface", () => {
    // `apps/mobile/store/README.md` § Identity (Price) and § Review notes are
    // the submitted App Store
    // Connect answers: no in-app purchases, and subscriptions "are not
    // offered, linked or mentioned in the app". Copy that names checkout here
    // trades this Guideline 2.1 finding for a 3.1.1 one.
    for (const copy of all) {
      expect(copy).not.toMatch(PURCHASE_PATH);
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
      expect(copy).not.toMatch(INVITES_RETRY);
    }
  });

  it("names the blocked action per surface rather than sharing one string", () => {
    expect(SUBSCRIPTION_REFUSAL_COPY.task).toMatch(/task/i);
    expect(SUBSCRIPTION_REFUSAL_COPY.checkIn).toMatch(/check-in/i);
    expect(SUBSCRIPTION_REFUSAL_COPY.study).toMatch(/study/i);
    // The in-session variant has to hold a narrow line, and it has been wrong
    // in both directions. It must not claim the time was lost (the session is
    // still live server-side and quick resolution credits it in full), and it
    // must not promise the time is safe (`stop` is paid-ops too, so the member
    // cannot bank it, and a session stale past HEARTBEAT_STALE_MINUTES is
    // closed EXPIRED awarding nothing).
    expect(SUBSCRIPTION_REFUSAL_COPY.studySession).not.toMatch(
      /can't be recorded|wasn't saved|nothing was saved/i,
    );
    expect(SUBSCRIPTION_REFUSAL_COPY.studySession).not.toMatch(
      /is safe|are safe|won't be lost|will be credited\b/i,
    );
    expect(SUBSCRIPTION_REFUSAL_COPY.studySession).toMatch(
      /may not be credited/i,
    );
    expect(new Set(all).size).toBe(all.length);
  });
});
