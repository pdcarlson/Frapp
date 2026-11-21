import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", () => ({ randomUUID: () => "minted" }));

import { inviteVisitId, resetInviteVisitForTests } from "./invite-visit";

describe("inviteVisitId (#5663)", () => {
  beforeEach(resetInviteVisitForTests);

  it("keeps one visit per invite for the app's run", () => {
    expect(inviteVisitId("tok-1", () => "visit-a")).toBe("visit-a");
    expect(inviteVisitId("tok-1", () => "visit-b")).toBe("visit-a");
  });

  it("starts a new visit for another invite", () => {
    inviteVisitId("tok-1", () => "visit-a");
    expect(inviteVisitId("tok-2", () => "visit-b")).toBe("visit-b");
  });

  it("mints with expo-crypto by default, and records nothing without it", () => {
    expect(inviteVisitId("tok-1")).toBe("minted");
    resetInviteVisitForTests();
    expect(
      inviteVisitId("tok-1", () => {
        throw new Error("no native module");
      }),
    ).toBeNull();
  });
});
