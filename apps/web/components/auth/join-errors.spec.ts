import { describe, expect, it } from "vitest";
import * as joinErrors from "./join-errors";
import { joinErrorCopy, redeemChapterId } from "./join-errors";

/**
 * `/join` rendered every failure as one string — `getErrorMessage(error,
 * "Something went wrong. Please try again.")` — in a toast. Two of its
 * failures are routine and need opposite next actions, and `writing.md` §1
 * bans that fallback by name.
 *
 * The strings are shared verbatim with
 * `apps/mobile/lib/onboarding/join-errors.ts`, and `writing.md` §7's "Join
 * chapter" table is where they are written down. Neither app can import the
 * other's module, so this file is what makes a divergence visible: change one
 * surface's copy and the table and this test disagree with the other surface.
 */
describe("joinErrorCopy", () => {
  it("tells a member with a spent invite what to ask for", () => {
    // `spec/behavior/onboarding.md`: missing, already-used and expired tokens
    // are all 410, and the API's own messages differ between them ("Invite not
    // found" / "Invite already used" / "Invite expired"). A member cannot act
    // on that distinction — the action is the same in all three — so the copy
    // names the recovery rather than the cause.
    for (const message of ["Invite not found", "Invite already used", "Invite expired"]) {
      expect(joinErrorCopy({ statusCode: 410, message })).toBe(
        "This invite has expired or already been used. Ask an officer for a new one.",
      );
    }
  });

  it("tells a member who is already in that they are already in", () => {
    // 409, and the opposite instruction: nothing to fix, just go to the chapter.
    expect(
      joinErrorCopy({ statusCode: 409, message: "Already a member of this chapter" }),
    ).toBe("You're already a member of this chapter. Open it from your chapter list.");
  });

  it("passes anything else through with the server's own words", () => {
    expect(joinErrorCopy({ statusCode: 500, message: "Internal server error" })).toBe(
      "Internal server error",
    );
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
    expect(joinErrorCopy({ status: 410 })).toMatch(/expired or already been used/);
  });
});

describe("redeemChapterId", () => {
  it("returns the chapter only when it can name one", () => {
    expect(redeemChapterId({ chapterId: "c-1" })).toBe("c-1");
    // An empty string would select a chapter that does not exist, so it is not
    // a chapter id.
    expect(redeemChapterId({ chapterId: "" })).toBeNull();
    expect(redeemChapterId({ chapterId: 7 })).toBeNull();
    expect(redeemChapterId({})).toBeNull();
    expect(redeemChapterId(null)).toBeNull();
    expect(redeemChapterId("c-1")).toBeNull();
  });
});

describe("this module is error copy, not a status vocabulary", () => {
  it("exports no badge-kind mapper", () => {
    // Written down so the absence reads as a decision. 410 and 409 are never
    // persisted, badged or coloured, so there is no kind to be wrong about and
    // nothing for `components/shared/status-kind.spec.ts` to register — the
    // same call `settings-status.ts` argues for a module tier.
    expect(Object.keys(joinErrors).sort()).toEqual(["joinErrorCopy", "redeemChapterId"]);
  });
});
