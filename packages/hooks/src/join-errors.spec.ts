import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETED_MESSAGE,
  JOIN_TERMS_REQUIRED_COPY,
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  TERMS_PROMPT_COPY,
} from "@repo/validation";
import * as joinErrors from "./join-errors";
import { joinErrorCopy, redeemChapterId } from "./join-errors";

/**
 * Web `/join` and mobile s02 both render these, and `writing.md` § 7's "Join
 * chapter" table is where the strings are written down. `/join` once rendered
 * every failure as one string, `getErrorMessage(error, "Something went wrong.
 * Please try again.")`, which `writing.md` § 1 bans by name, on a screen whose
 * two most likely failures need opposite next actions.
 */
describe("joinErrorCopy", () => {
  it("tells a member with a spent invite what to ask for", () => {
    // `spec/behavior/onboarding.md`: missing, already-used and expired tokens
    // are all 410, and the API's own messages differ between them. A member
    // cannot act on that distinction, so the copy names the recovery.
    for (const message of [
      "Invite not found",
      "Invite already used",
      "Invite expired",
    ]) {
      expect(joinErrorCopy({ statusCode: 410, message })).toBe(
        "This invite has expired or already been used. Ask an officer for a new one.",
      );
    }
  });

  it("doesn't blame the invite when the account itself was deleted", () => {
    // Also a 410, from the Terms check, for a session that outlived its
    // account. A new invite wouldn't help.
    expect(
      joinErrorCopy({ statusCode: 410, message: ACCOUNT_DELETED_MESSAGE }),
    ).toBe(TERMS_PROMPT_COPY.deleted);
  });

  it("tells a member who is already in that they are already in", () => {
    expect(
      joinErrorCopy({
        statusCode: 409,
        message: "Already a member of this chapter",
      }),
    ).toBe(
      "You're already a member of this chapter. Open it from your chapter list.",
    );
  });

  it("passes anything else through with the server's own words", () => {
    expect(
      joinErrorCopy({ statusCode: 500, message: "Internal server error" }),
    ).toBe("Internal server error");
  });

  it("falls back without the banned generic when there is no message", () => {
    expect(joinErrorCopy({})).toBe(
      "Couldn't join that chapter. Check the invite and try again.",
    );
    expect(joinErrorCopy(undefined)).toBe(
      "Couldn't join that chapter. Check the invite and try again.",
    );
    expect(joinErrorCopy({})).not.toMatch(/something went wrong/i);
  });

  it("reads `status` as well as `statusCode`", () => {
    // `statusOf` accepts both shapes; a fetch-layer error carries `status`.
    expect(joinErrorCopy({ status: 410 })).toMatch(
      /expired or already been used/,
    );
  });
});

describe("the Terms refusal (#2302)", () => {
  it("asks for the checkbox when the server refused for want of it", () => {
    // As served: `AllExceptionsFilter` sends no `code` (#1020).
    const refusal = {
      statusCode: 403,
      error: "FORBIDDEN",
      message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
    };
    expect(joinErrorCopy(refusal)).toBe(JOIN_TERMS_REQUIRED_COPY);
  });

  it("does not read the subscription lock, also a 403, as a Terms refusal", () => {
    const locked = {
      statusCode: 403,
      message: "This chapter isn't accepting new members right now.",
    };
    expect(joinErrorCopy(locked)).toBe(locked.message);
  });
});

describe("redeemChapterId", () => {
  it("returns the chapter only when it can name one", () => {
    expect(redeemChapterId({ chapterId: "c-1", memberId: "m-1" })).toBe("c-1");
    // An empty string would select a chapter that does not exist.
    expect(redeemChapterId({ chapterId: "" })).toBeNull();
    expect(redeemChapterId({ chapterId: 7 })).toBeNull();
    expect(redeemChapterId({ chapter_id: "c-1" })).toBeNull();
    expect(redeemChapterId({})).toBeNull();
    expect(redeemChapterId(null)).toBeNull();
    expect(redeemChapterId("c-1")).toBeNull();
  });
});

describe("this module is error copy, not a status vocabulary", () => {
  it("exports no badge-kind mapper", () => {
    // Written down so the absence reads as a decision: 410 and 409 are never
    // persisted, badged or coloured, so there is no kind to be wrong about.
    expect(Object.keys(joinErrors).sort()).toEqual([
      "joinErrorCopy",
      "redeemChapterId",
    ]);
  });
});
