import { describe, expect, it } from "vitest";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import {
  dmChannelIdOf,
  MESSAGE_CHECKING_BLOCK_LIST,
  messageRowDescription,
  messageRowState,
  otherRealMemberId,
} from "./start-dm";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";

describe("otherRealMemberId", () => {
  it("is the member's id on another member's profile", () => {
    expect(otherRealMemberId(MEMBER, VIEWER)).toBe(MEMBER);
  });

  it("is null on the viewer's own profile, since the API would create a DM with yourself", () => {
    expect(otherRealMemberId(VIEWER, VIEWER)).toBeNull();
  });

  it("is null until the viewer is known, so an unresolved viewer never reads as someone else", () => {
    expect(otherRealMemberId(VIEWER, null)).toBeNull();
  });

  it("is null before the member's profile loads", () => {
    expect(otherRealMemberId(null, VIEWER)).toBeNull();
  });

  it("is null for the system actor", () => {
    expect(otherRealMemberId(SYSTEM_SENDER_ID, VIEWER)).toBeNull();
  });
});

describe("messageRowState", () => {
  const list = (
    status: "ready" | "loading" | "unavailable",
    ids: string[] = [],
    isPaused = false,
    isRetrying = false,
  ) => ({ status, ids: new Set(ids), isPaused, isRetrying });

  it("is ready for another member once the block list is ready", () => {
    expect(
      messageRowState({ memberId: MEMBER, blockList: list("ready") }),
    ).toEqual({ kind: "ready" });
  });

  it("is hidden when there is no other member", () => {
    expect(
      messageRowState({ memberId: null, blockList: list("ready") }),
    ).toEqual({ kind: "hidden" });
  });

  it.each(["ready", "loading", "unavailable"] as const)(
    "is hidden for a member the viewer blocked, with the list %s",
    (status) => {
      expect(
        messageRowState({ memberId: MEMBER, blockList: list(status, [MEMBER]) }),
      ).toEqual({ kind: "hidden" });
    },
  );

  // The ids are a floor: a block from an earlier session or another device is
  // missing from them until the list is read, so an empty set proves nothing
  // and the row waits rather than starting a DM.
  it("waits while the block list loads", () => {
    expect(
      messageRowState({ memberId: MEMBER, blockList: list("loading") }),
    ).toEqual({ kind: "checking" });
  });

  it("waits for the network while the read is paused offline", () => {
    expect(
      messageRowState({
        memberId: MEMBER,
        blockList: list("unavailable", [], true),
      }),
    ).toEqual({ kind: "waitingForNetwork" });
  });

  it("offers a retry when the read failed", () => {
    expect(
      messageRowState({ memberId: MEMBER, blockList: list("unavailable") }),
    ).toEqual({ kind: "retry" });
  });

  // A failed list with cached data keeps its `unavailable` status while it
  // re-reads, so the in-flight read, not the status, says it is checking.
  it("checks, not offers a retry, while a re-read of a failed list is in flight", () => {
    expect(
      messageRowState({
        memberId: MEMBER,
        blockList: list("unavailable", [], false, true),
      }),
    ).toEqual({ kind: "checking" });
  });
});

describe("messageRowDescription", () => {
  it("says nothing when the row is ready", () => {
    expect(messageRowDescription({ kind: "ready" })).toBeNull();
  });

  it("says why the row is waiting", () => {
    expect(messageRowDescription({ kind: "checking" })).toBe(
      MESSAGE_CHECKING_BLOCK_LIST,
    );
    expect(messageRowDescription({ kind: "waitingForNetwork" })).toBe(
      "Couldn't check your block list first. Retries when you're back online.",
    );
    expect(messageRowDescription({ kind: "retry" })).toBe(
      "Couldn't check your block list first. Tap to try again.",
    );
  });
});

describe("dmChannelIdOf", () => {
  it("reads the channel id from the DM response", () => {
    expect(dmChannelIdOf({ id: "chan-1", type: "DM" })).toBe("chan-1");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a body with no id", { type: "DM" }],
    ["an empty id", { id: "" }],
    ["a non-string id", { id: 42 }],
  ])("returns null for %s, so the caller reports a failure", (_, body) => {
    expect(dmChannelIdOf(body)).toBeNull();
  });
});
