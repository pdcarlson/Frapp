import { describe, expect, it } from "vitest";
import { normalizeApiBaseUrl } from "./normalize-api-base-url";

describe("normalizeApiBaseUrl", () => {
  it("strips a single /v1 suffix (paths already include /v1)", () => {
    expect(normalizeApiBaseUrl("https://api-staging.frapp.live/v1")).toBe(
      "https://api-staging.frapp.live",
    );
  });

  it("dedupes /v1/v1 to origin", () => {
    expect(normalizeApiBaseUrl("https://api-staging.frapp.live/v1/v1")).toBe(
      "https://api-staging.frapp.live",
    );
  });

  it("dedupes longer /v1 runs", () => {
    expect(normalizeApiBaseUrl("https://api-staging.frapp.live/v1/v1/v1")).toBe(
      "https://api-staging.frapp.live",
    );
  });

  it("keeps origin when there is no path", () => {
    expect(normalizeApiBaseUrl("https://api-staging.frapp.live")).toBe(
      "https://api-staging.frapp.live",
    );
  });

  it("normalizes localhost with port and /v1", () => {
    expect(normalizeApiBaseUrl("http://127.0.0.1:3001/v1")).toBe(
      "http://127.0.0.1:3001",
    );
  });

  it("trims whitespace and trailing slashes on /v1", () => {
    expect(normalizeApiBaseUrl("  https://api.example/v1/  ")).toBe(
      "https://api.example",
    );
  });

  it("preserves a non-version path prefix", () => {
    expect(normalizeApiBaseUrl("https://api.example/prefix")).toBe(
      "https://api.example/prefix",
    );
  });
});
