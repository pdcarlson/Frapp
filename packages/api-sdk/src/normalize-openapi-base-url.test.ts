import { describe, expect, it } from "vitest";
import { normalizeOpenapiBaseUrl } from "./normalize-openapi-base-url";

describe("normalizeOpenapiBaseUrl", () => {
  it("strips a trailing /v1 segment so OpenAPI /v1 paths do not double-prefix", () => {
    expect(normalizeOpenapiBaseUrl("https://api-staging.frapp.live/v1")).toBe(
      "https://api-staging.frapp.live",
    );
    expect(normalizeOpenapiBaseUrl("https://api-staging.frapp.live/v1/")).toBe(
      "https://api-staging.frapp.live",
    );
  });

  it("preserves origins without /v1", () => {
    expect(normalizeOpenapiBaseUrl("https://api-staging.frapp.live")).toBe(
      "https://api-staging.frapp.live",
    );
  });

  it("normalizes local dev URLs", () => {
    expect(normalizeOpenapiBaseUrl("http://localhost:3001/v1")).toBe("http://localhost:3001");
  });
});
