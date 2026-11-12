import { describe, expect, it } from "vitest";
import {
  inviteTokenOf,
  onboardedChapterId,
  webAppHost,
  webAppOrigin,
  webJoinUrl,
} from "./invite-link";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("webAppOrigin", () => {
  it("strips a trailing slash from EXPO_PUBLIC_APP_URL", () => {
    expect(webAppOrigin("https://app.staging.frapp.live/")).toBe(
      "https://app.staging.frapp.live",
    );
  });

  it("defaults to production when the env is unset or blank", () => {
    expect(webAppOrigin("")).toBe("https://app.frapp.live");
    expect(webAppOrigin("  ")).toBe("https://app.frapp.live");
  });

  // babel-preset-expo inlines only a static `process.env.EXPO_PUBLIC_*`
  // member read; through an alias the value is undefined on device, which
  // vitest on Node can't show (lib/secure-store.web.ts).
  it("reads the build's value with the static form a build inlines", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./invite-link.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("= process.env.EXPO_PUBLIC_APP_URL");
  });
});

describe("webAppHost", () => {
  it("drops the scheme", () => {
    expect(webAppHost("https://app.frapp.live")).toBe("app.frapp.live");
    expect(webAppHost("http://localhost:3000")).toBe("localhost:3000");
  });
});

describe("webJoinUrl", () => {
  it("encodes the token on /join", () => {
    expect(webJoinUrl("a b", "https://app.frapp.live")).toBe(
      "https://app.frapp.live/join?token=a%20b",
    );
  });

  it("refuses a public http: origin before attaching the token", () => {
    expect(() => webJoinUrl("secret-invite", "http://app.frapp.live")).toThrow(
      /must use https:/,
    );
  });

  it("allows loopback http:", () => {
    expect(webJoinUrl("local-token", "http://localhost:3000")).toBe(
      "http://localhost:3000/join?token=local-token",
    );
  });
});

describe("inviteTokenOf / onboardedChapterId", () => {
  it("reads the API fields the web wizard reads", () => {
    expect(inviteTokenOf({ token: "inv-1", role: "Member" })).toBe("inv-1");
    expect(inviteTokenOf({ invite_token: "inv-1" })).toBeNull();
    expect(onboardedChapterId({ id: "ch-1" })).toBe("ch-1");
    expect(onboardedChapterId({ chapter_id: "ch-1" })).toBeNull();
  });
});
