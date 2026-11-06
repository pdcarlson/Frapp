import { describe, expect, it } from "vitest";
import { blockConfirmBody, isMemberNotFound } from "./block-copy";

describe("isMemberNotFound", () => {
  it("is the API's non-member answer and nothing else", () => {
    expect(
      isMemberNotFound({ statusCode: 404, message: "Member not found" }),
    ).toBe(true);
    // A 404 from a route this build expects but the server does not serve.
    expect(isMemberNotFound({ statusCode: 404, message: "Cannot POST" })).toBe(
      false,
    );
    expect(isMemberNotFound({ statusCode: 404 })).toBe(false);
    expect(
      isMemberNotFound({ statusCode: 400, message: "Member not found" }),
    ).toBe(false);
  });
});

describe("blockConfirmBody", () => {
  it("says a block is this chapter's, and promises the directory only when it is true", () => {
    expect(blockConfirmBody(true, "in Settings")).toMatch(
      /this chapter's chat/,
    );
    expect(blockConfirmBody(true, "in Settings")).toMatch(
      /stay in the directory/,
    );
    expect(blockConfirmBody(false, "in Settings")).not.toMatch(/directory/);
  });

  it("names the client's own blocked-members list", () => {
    expect(blockConfirmBody(true, "in Settings")).toMatch(
      /unblock them anytime in Settings\.$/,
    );
    expect(blockConfirmBody(true, "from your profile")).toMatch(
      /unblock them anytime from your profile\.$/,
    );
  });
});
