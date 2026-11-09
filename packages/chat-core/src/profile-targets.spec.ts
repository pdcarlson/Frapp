import { describe, expect, it } from "vitest";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import { authorProfileUserId, mentionedUserId } from "./profile-targets";

const CASEY = "11111111-1111-4111-8111-111111111111";
const MORGAN = "22222222-2222-4222-8222-222222222222";
const names: Record<string, string> = {
  [CASEY]: "Casey Jones",
  [MORGAN]: "Morgan",
};
const nameFor = (id: string) => names[id] ?? null;

describe("authorProfileUserId", () => {
  it("names a member author", () => {
    expect(authorProfileUserId({ sender_id: CASEY }, nameFor)).toBe(CASEY);
  });

  it("offers no profile for Frapp's own posts, an imported author, or a member who left", () => {
    expect(
      authorProfileUserId({ sender_id: SYSTEM_SENDER_ID }, nameFor),
    ).toBeNull();
    expect(authorProfileUserId({ sender_id: null }, nameFor)).toBeNull();
    // Left the chapter: the roster no longer names them.
    expect(authorProfileUserId({ sender_id: CASEY }, () => null)).toBeNull();
  });
});

describe("mentionedUserId", () => {
  it("resolves a chip only against the members the message mentioned", () => {
    const mentioned = { mentions: [CASEY] };
    expect(mentionedUserId(mentioned, "@CaseyJones", nameFor)).toBe(CASEY);
    expect(mentionedUserId(mentioned, "CaseyJones", nameFor)).toBe(CASEY);
    // Morgan is a member but this message didn't notify them.
    expect(mentionedUserId(mentioned, "@Morgan", nameFor)).toBeNull();
  });

  it("opens nothing for a role mention", () => {
    // `@Brothers` resolved to its holders; none of them is named Brothers.
    expect(
      mentionedUserId({ mentions: [CASEY, MORGAN] }, "@Brothers", nameFor),
    ).toBeNull();
  });
});
