import { describe, expect, it } from "vitest";
import {
  discordLinkedState,
  googleCalendarLinkedState,
  loadSignInMethods,
  signInMethodsFrom,
} from "./linked-apps";

const OFF = {
  available: true,
  connected: false,
  status: null,
  google_email: null,
} as const;

describe("googleCalendarLinkedState", () => {
  it("draws no row where the server doesn't offer Google Calendar", () => {
    expect(googleCalendarLinkedState(undefined)).toBeNull();
    expect(googleCalendarLinkedState({ ...OFF, available: false })).toBeNull();
  });

  it("is grey until connected", () => {
    expect(googleCalendarLinkedState(OFF)?.tone).toBe("off");
  });

  it("is a check with the account once connected", () => {
    expect(
      googleCalendarLinkedState({
        ...OFF,
        connected: true,
        status: "active",
        google_email: "a@b.com",
      }),
    ).toEqual({ tone: "connected", detail: "a@b.com" });
  });

  it("is red once Google stopped honoring the sign-in", () => {
    expect(
      googleCalendarLinkedState({
        ...OFF,
        connected: true,
        status: "needs_reconnect",
        google_email: "a@b.com",
      })?.tone,
    ).toBe("expired");
  });
});

describe("discordLinkedState", () => {
  it("names the linked account", () => {
    expect(
      discordLinkedState({ linked: true, discord_username: "paul" }),
    ).toEqual({ tone: "connected", detail: "paul" });
  });

  it("draws no row while linking isn't offered", () => {
    expect(discordLinkedState({ linked: false, available: false })).toBeNull();
    expect(discordLinkedState(undefined)).toBeNull();
  });

  it("is grey while not linked", () => {
    expect(discordLinkedState({ linked: false, available: true })?.tone).toBe(
      "off",
    );
  });
});

describe("signInMethodsFrom", () => {
  it("lists every method, checking the ones on the account", () => {
    const rows = signInMethodsFrom(
      [
        { provider: "google", identity_data: { email: "g@gmail.com" } },
        { provider: "email", identity_data: {} },
      ],
      "me@school.edu",
    );
    expect(rows.map((r) => [r.key, r.tone, r.detail])).toEqual([
      ["email", "connected", "me@school.edu"],
      ["google", "connected", "g@gmail.com"],
      ["apple", "off", "Not set up"],
    ]);
  });
});

describe("loadSignInMethods", () => {
  it("throws on a failed identities read rather than listing nothing", async () => {
    await expect(
      loadSignInMethods({
        getUserIdentities: async () => ({ data: null, error: new Error("x") }),
        getUser: async () => ({ data: { user: null } }),
      }),
    ).rejects.toThrow("x");
  });

  it("labels the email method Email, since a magic-link account has it too", async () => {
    const rows = await loadSignInMethods({
      getUserIdentities: async () => ({
        data: { identities: [{ provider: "email", identity_data: {} }] },
        error: null,
      }),
      getUser: async () => ({ data: { user: { email: "a@b.com" } } }),
    });
    expect(rows[0]).toMatchObject({ label: "Email", detail: "a@b.com" });
  });
});
