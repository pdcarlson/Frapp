import { describe, expect, it } from "vitest";
import { inviteShareContent, usedInviteTokens } from "./use-invite-shares";

describe("inviteShareContent", () => {
  const url = "https://app.frapp.live/join?token=tok123";

  it("gives iOS the link as its own item, so Messages draws a preview card", () => {
    expect(inviteShareContent(url, "FIJI", "ios")).toEqual({
      message: "Join FIJI on Frapp",
      url,
    });
  });

  it("puts the link in the one string Android shares", () => {
    expect(inviteShareContent(url, "FIJI", "android")).toEqual({
      message: `Join FIJI on Frapp\n${url}`,
    });
  });
});

describe("usedInviteTokens", () => {
  it("collects the tokens that have been redeemed", () => {
    const used = usedInviteTokens([
      { token: "a", used_at: "2026-11-06T20:00:00Z" },
      { token: "b", used_at: null },
      { token: "c" },
    ]);
    expect([...used]).toEqual(["a"]);
  });

  it("reads anything that isn't a list as none used", () => {
    expect(usedInviteTokens(undefined).size).toBe(0);
    expect(usedInviteTokens({ token: "a", used_at: "x" }).size).toBe(0);
    expect(usedInviteTokens([null, 4, "a"]).size).toBe(0);
  });
});
