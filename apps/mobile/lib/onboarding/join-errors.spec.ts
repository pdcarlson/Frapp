import { describe, expect, it } from "vitest";
import {
  isTermsRequiredError,
  JOIN_TERMS_REQUIRED_COPY,
  joinErrorCopy,
  redeemChapterId,
} from "./join-errors";

describe("joinErrorCopy", () => {
  it("names expired or used invites", () => {
    expect(joinErrorCopy({ statusCode: 410, message: "Invite expired" })).toBe(
      "This invite has expired or already been used. Ask an officer for a new one.",
    );
  });

  it("names an already-member conflict", () => {
    expect(joinErrorCopy({ status: 409 })).toContain("already a member");
  });

  it("asks for the Terms checkbox when the server refused for want of it (#2302)", () => {
    const refusal = {
      code: "legal.acceptance_required",
      message:
        "Agree to the Terms of Service and Privacy Policy to join this chapter.",
    };
    expect(isTermsRequiredError(refusal)).toBe(true);
    expect(joinErrorCopy(refusal)).toBe(JOIN_TERMS_REQUIRED_COPY);
  });

  it("does not read another 403 as a Terms refusal", () => {
    const locked = {
      statusCode: 403,
      code: "chapter.subscription.canceled",
      message: "This chapter isn't accepting new members right now.",
    };
    expect(isTermsRequiredError(locked)).toBe(false);
    expect(joinErrorCopy(locked)).toBe(locked.message);
  });

  it("falls back to the server message, then generic copy", () => {
    expect(joinErrorCopy({ statusCode: 500, message: "Upstream down" })).toBe(
      "Upstream down",
    );
    expect(joinErrorCopy({})).toContain("Couldn't join");
  });
});

describe("redeemChapterId", () => {
  it("reads the API's chapterId field", () => {
    expect(redeemChapterId({ chapterId: "ch-1", memberId: "m-1" })).toBe("ch-1");
    expect(redeemChapterId({ chapter_id: "ch-1" })).toBeNull();
    expect(redeemChapterId(null)).toBeNull();
  });
});
