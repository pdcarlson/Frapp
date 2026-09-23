import { describe, expect, it } from "vitest";
import {
  JOIN_TERMS_REQUIRED_COPY,
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
} from "@repo/validation";
import { joinErrorCopy, redeemChapterId } from "./join-errors";

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
    // As served: no `code` (#1020); detection itself is tested in @repo/hooks.
    const refusal = {
      statusCode: 403,
      message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
    };
    expect(joinErrorCopy(refusal)).toBe(JOIN_TERMS_REQUIRED_COPY);
  });

  it("does not read another 403 as a Terms refusal", () => {
    const locked = {
      statusCode: 403,
      message: "This chapter isn't accepting new members right now.",
    };
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
