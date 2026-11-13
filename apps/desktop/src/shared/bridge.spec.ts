import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IPC, parseBadgeCount, parseExternalUrl } from "./bridge";

describe("parseBadgeCount", () => {
  it("accepts whole counts from zero, capped where the dock stops", () => {
    expect(parseBadgeCount(0)).toBe(0);
    expect(parseBadgeCount(12)).toBe(12);
    expect(parseBadgeCount(1_000_000)).toBe(99_999);
  });

  it("ignores anything else", () => {
    for (const value of [-1, 1.5, Number.NaN, Infinity, "3", null, undefined, {}]) {
      expect(parseBadgeCount(value)).toBeNull();
    }
  });
});

describe("parseExternalUrl", () => {
  it("passes https pages through", () => {
    expect(parseExternalUrl("https://accounts.google.com/o/oauth2/v2/auth?x=1")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    );
  });

  it("refuses every other scheme and anything that isn't a URL", () => {
    for (const value of [
      "http://example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "frapp-desktop://auth/callback",
      "nope",
      `https://example.com/${"a".repeat(9000)}`,
      42,
      null,
    ]) {
      expect(parseExternalUrl(value)).toBeNull();
    }
  });
});

describe("the preload", () => {
  it("sends on the same channels the main process listens on", () => {
    // The sandboxed preload can't import `IPC`, so it spells the names out.
    const preload = readFileSync(join(__dirname, "../preload/index.ts"), "utf8");
    for (const channel of Object.values(IPC)) expect(preload).toContain(`"${channel}"`);
  });
});
