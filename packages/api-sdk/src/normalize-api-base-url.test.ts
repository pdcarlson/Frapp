import { describe, expect, it } from "vitest";
import { normalizeOpenApiBaseUrl } from "./normalize-api-base-url";

describe("normalizeOpenApiBaseUrl", () => {
  it("strips a trailing /v1 segment", () => {
    expect(normalizeOpenApiBaseUrl("https://api-staging.frapp.live/v1")).toBe(
      "https://api-staging.frapp.live",
    );
  });

  it("strips trailing slashes then /v1", () => {
    expect(normalizeOpenApiBaseUrl("https://api.example.com/v1///")).toBe(
      "https://api.example.com",
    );
  });

  it("is case-insensitive for the /v1 suffix", () => {
    expect(normalizeOpenApiBaseUrl("http://localhost:3001/V1")).toBe(
      "http://localhost:3001",
    );
  });

  it("leaves host-only URLs unchanged", () => {
    expect(normalizeOpenApiBaseUrl("https://api.frapp.live")).toBe(
      "https://api.frapp.live",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeOpenApiBaseUrl("  https://x.test/v1  ")).toBe(
      "https://x.test",
    );
  });
});
