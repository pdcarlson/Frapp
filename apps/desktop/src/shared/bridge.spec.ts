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
  it("passes Supabase Auth's authorize page through", () => {
    const url = "https://abcdefgh.supabase.co/auth/v1/authorize?provider=google&redirect_to=x";
    expect(parseExternalUrl(url)).toBe(url);
  });

  it("refuses any other page, scheme, or anything that isn't a URL", () => {
    for (const value of [
      "https://accounts.google.com/o/oauth2/v2/auth?x=1",
      "https://phish.example/auth/v1/authorize",
      "https://supabase.co.evil.example/auth/v1/authorize",
      "https://abcdefgh.supabase.co/auth/v1/token",
      "https://user:pass@abcdefgh.supabase.co/auth/v1/authorize",
      "https://abcdefgh.supabase.co:8443/auth/v1/authorize",
      "http://abcdefgh.supabase.co/auth/v1/authorize",
      "http://example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "frapp-desktop://auth/callback",
      "nope",
      `https://abcdefgh.supabase.co/auth/v1/authorize?${"a".repeat(9000)}`,
      42,
      null,
    ]) {
      expect(parseExternalUrl(value)).toBeNull();
    }
  });
});

describe("the preload", () => {
  it("sends each method on the channel the main process listens on for it", () => {
    // The sandboxed preload can't import `IPC`, so it spells the names out.
    const preload = readFileSync(join(__dirname, "../preload/index.ts"), "utf8");
    for (const method of Object.keys(IPC) as (keyof typeof IPC)[]) {
      const sent = new RegExp(`^\\s*${method}: \\([^)]*\\) => ipcRenderer\\.send\\("([^"]+)"`, "m").exec(preload);
      expect(sent?.[1], method).toBe(IPC[method]);
    }
  });
});
