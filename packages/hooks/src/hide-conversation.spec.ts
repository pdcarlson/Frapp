import { describe, expect, it } from "vitest";
import {
  canHideConversation,
  HIDE_CONVERSATION_CONFIRM_BODY,
  hideConversationConfirmTitle,
  otherMemberId,
} from "./hide-conversation";

// #2303. Every client test mocks `canHideConversation`, so this is the one
// place its rule is pinned. It matters more than it looks: the Hide control
// calls `POST /v1/channels/{id}/leave`, which on a Group DM removes the member
// for good. Offered there, the control would do exactly what its confirmation
// promises it won't.
describe("canHideConversation", () => {
  it("offers Hide on a 1:1 DM only", () => {
    expect(canHideConversation({ type: "DM" })).toBe(true);
    for (const type of ["GROUP_DM", "PUBLIC", "PRIVATE", "ROLE_GATED"]) {
      expect(canHideConversation({ type })).toBe(false);
    }
  });
});

describe("hide confirmation copy", () => {
  it("names the member and promises nothing is deleted", () => {
    expect(hideConversationConfirmTitle("Alice Chen")).toBe(
      "Hide your conversation with Alice Chen?",
    );
    expect(HIDE_CONVERSATION_CONFIRM_BODY).toMatch(/nothing in it is deleted/);
  });
});

describe("otherMemberId", () => {
  it("is the one participant who is not the viewer", () => {
    expect(otherMemberId({ member_ids: ["me", "them"] }, "me")).toBe("them");
  });

  it("is null when it cannot be told apart", () => {
    expect(otherMemberId({ member_ids: ["me", "them"] }, null)).toBeNull();
    expect(otherMemberId({ member_ids: ["me"] }, "me")).toBeNull();
    expect(otherMemberId({ member_ids: null }, "me")).toBeNull();
    expect(otherMemberId({ member_ids: ["a", "b"] }, "me")).toBeNull();
  });
});
