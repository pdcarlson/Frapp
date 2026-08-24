import { describe, expect, it } from "vitest";
import { initialsFor } from "./display-name";

describe("initialsFor", () => {
  it("takes one initial from each of the first two words", () => {
    expect(initialsFor("Marcus Reid")).toBe("MR");
  });

  it("falls back to the first two letters of a single word", () => {
    expect(initialsFor("marcus")).toBe("MA");
  });

  it("survives an empty or whitespace-only name", () => {
    expect(initialsFor("   ")).toBe("?");
  });
});

// `senderLabel` moved to `@repo/hooks` as `resolveAuthorLabel` when
// `chat_messages.sender_id` became nullable — its truncated-id fallback threw
// on an imported archive message, and web had its own copy of the same rule.
// Its cases live in `packages/hooks/src/display-names.spec.ts` now.
