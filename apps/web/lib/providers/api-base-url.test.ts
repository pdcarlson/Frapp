import { describe, it, expect } from "vitest";
import { normalizeApiBaseUrl } from "@repo/api-sdk";

/**
 * `normalizeApiBaseUrl` lives in `@repo/api-sdk`, but its tests live here.
 *
 * `packages/api-sdk` has no test runner and no CI job. CI does run the
 * `@repo/validation`, `packages/hooks` and `packages/chat-core` suites — the
 * latter two added by #819 — but not this package, so a suite placed beside the code would
 * never execute, which is the defect #762 / #766 / #775 exist to fix. The web
 * suite does run, and web is the consumer whose every request this governs.
 * Once `packages/api-sdk` has a `test` task wired into CI (#775), these belong
 * back beside the function they cover.
 *
 * What it guards: `openapi.json` declares no `servers` entry and carries the
 * version in the path, so the SDK concatenates baseUrl + path. A baseUrl
 * ending in `/v1` produces `/v1/v1/...` and 404s everything (#785). The value
 * arrives from Vercel/EAS deploy config the repo cannot validate at build
 * time, so the normalization is the last line of defense.
 */
describe("normalizeApiBaseUrl", () => {
  it("strips the doubled /v1 suffix that 404s every request", () => {
    expect(normalizeApiBaseUrl("http://localhost:3001/v1")).toBe(
      "http://localhost:3001",
    );
    expect(normalizeApiBaseUrl("https://api.frapp.live/v1")).toBe(
      "https://api.frapp.live",
    );
  });

  it("leaves a correctly configured bare origin untouched", () => {
    expect(normalizeApiBaseUrl("http://localhost:3001")).toBe(
      "http://localhost:3001",
    );
    expect(normalizeApiBaseUrl("https://api-staging.frapp.live")).toBe(
      "https://api-staging.frapp.live",
    );
  });

  it("drops trailing slashes, which would otherwise double the separator", () => {
    expect(normalizeApiBaseUrl("http://localhost:3001/")).toBe(
      "http://localhost:3001",
    );
    expect(normalizeApiBaseUrl("http://localhost:3001/v1/")).toBe(
      "http://localhost:3001",
    );
    expect(normalizeApiBaseUrl("http://localhost:3001//")).toBe(
      "http://localhost:3001",
    );
  });

  it("tolerates whitespace from a pasted environment value", () => {
    expect(normalizeApiBaseUrl("  https://api.frapp.live/v1  ")).toBe(
      "https://api.frapp.live",
    );
  });

  it("keeps a path prefix while removing only the version segment", () => {
    // An API mounted under a prefix still works: the generated `/v1` path
    // segment puts back exactly what was stripped.
    expect(normalizeApiBaseUrl("https://host.example/api/v1")).toBe(
      "https://host.example/api",
    );
  });

  it("does not strip a path that merely contains v1", () => {
    expect(normalizeApiBaseUrl("https://host.example/v1beta")).toBe(
      "https://host.example/v1beta",
    );
    expect(normalizeApiBaseUrl("https://v1.example.com")).toBe(
      "https://v1.example.com",
    );
  });
});
