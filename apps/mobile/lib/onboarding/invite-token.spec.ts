import { afterEach, describe, expect, it, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearRememberedInviteThen,
  consumeRememberedInviteToken,
  extractInviteToken,
  extractInviteTokenFromQuery,
  hydrateRememberedInvite,
  JOIN_THEN_MS,
  peekRememberedInviteThen,
  peekRememberedInviteToken,
  REMEMBER_INVITE_MS,
  rememberInviteToken,
  resetRememberedInviteForTests,
  takeInviteTokenFromLink,
} from "./invite-token";

afterEach(() => {
  consumeRememberedInviteToken();
  resetRememberedInviteForTests();
  vi.mocked(AsyncStorage.getItem).mockResolvedValue(null);
});

describe("extractInviteToken", () => {
  it("re-exports the shared parser so a pasted join URL still works here", () => {
    expect(
      extractInviteToken("https://app.frapp.live/join?token=invite-abc"),
    ).toBe("invite-abc");
  });

  it("re-exports query seeding so ?invite= and ?code= fill the field", () => {
    const params = new URLSearchParams("invite=from-invite");
    expect(extractInviteTokenFromQuery((key) => params.get(key))).toBe(
      "from-invite",
    );
    expect(
      extractInviteTokenFromQuery((key) =>
        new URLSearchParams("code=from-code").get(key),
      ),
    ).toBe("from-code");
  });
});

describe("rememberInviteToken", () => {
  it("keeps the last non-empty token until consumed", () => {
    rememberInviteToken("first");
    rememberInviteToken(null);
    expect(consumeRememberedInviteToken()).toBe("first");
    expect(consumeRememberedInviteToken()).toBeNull();
  });
});

describe("the remembered invite, across a sign-in and a relaunch (#5625)", () => {
  const KEY = "frapp.mobile.pending-invite";

  it("keeps it on the phone, and forgets it there once taken", async () => {
    rememberInviteToken("tok-1", "join");
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      KEY,
      expect.stringContaining('"token":"tok-1"'),
    );
    consumeRememberedInviteToken();
    await Promise.resolve();
    expect(AsyncStorage.removeItem).toHaveBeenLastCalledWith(KEY);
  });

  it("reads one a past run left, with its mark", async () => {
    const now = Date.now();
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(
      JSON.stringify({ token: "tok-2", then: "join", at: now - 60_000 }),
    );
    await hydrateRememberedInvite(now);
    expect(peekRememberedInviteToken()).toBe("tok-2");
    expect(peekRememberedInviteThen(now)).toBe("join");
  });

  it("drops one older than an invite lives", async () => {
    const now = Date.now();
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(
      JSON.stringify({
        token: "tok-3",
        then: null,
        at: now - REMEMBER_INVITE_MS - 1,
      }),
    );
    await hydrateRememberedInvite(now);
    expect(peekRememberedInviteToken()).toBeNull();
  });

  it("lets an invite remembered in this run win over the stored one", async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(
      JSON.stringify({ token: "stale", then: null, at: Date.now() }),
    );
    rememberInviteToken("fresh");
    await hydrateRememberedInvite();
    expect(peekRememberedInviteToken()).toBe("fresh");
  });

  it("lets the card's mark lapse, and clears it once acted on", () => {
    rememberInviteToken("tok-4", "join");
    expect(peekRememberedInviteThen()).toBe("join");
    expect(peekRememberedInviteThen(Date.now() + JOIN_THEN_MS + 1)).toBeNull();
    clearRememberedInviteThen();
    expect(peekRememberedInviteThen()).toBeNull();
    // The invite itself stays until it is joined or declined.
    expect(peekRememberedInviteToken()).toBe("tok-4");
  });
});

describe("takeInviteTokenFromLink", () => {
  it("reads an opened link once, so a redeemed invite doesn't come back (#3350)", () => {
    const url = "frapp://join?token=launch-token";
    expect(takeInviteTokenFromLink(url)).toBe("launch-token");
    // `Linking.useURL()` still answers with the launch URL on the next visit.
    expect(takeInviteTokenFromLink(url)).toBeNull();
    // A different link is a new invite.
    expect(takeInviteTokenFromLink("frapp://join?token=second")).toBe("second");
  });

  it("ignores no link, and doesn't spend a link without a token", () => {
    expect(takeInviteTokenFromLink(null)).toBeNull();
    expect(takeInviteTokenFromLink("frapp://chat")).toBeNull();
    expect(takeInviteTokenFromLink("frapp://join?token=after")).toBe("after");
  });
});
