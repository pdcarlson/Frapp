import { describe, expect, it } from "vitest";
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
