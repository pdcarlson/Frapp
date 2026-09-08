import { describe, expect, it } from "vitest";
import { buildJoinUrl } from "./invite-link";

describe("buildJoinUrl", () => {
  it("builds a same-origin /join?token= URL", () => {
    expect(buildJoinUrl("https://app.frapp.live", "ABC123")).toBe(
      "https://app.frapp.live/join?token=ABC123",
    );
  });

  it("encodes characters that would break the query", () => {
    expect(buildJoinUrl("https://app.frapp.live", "a b/c")).toBe(
      "https://app.frapp.live/join?token=a%20b%2Fc",
    );
  });
});
