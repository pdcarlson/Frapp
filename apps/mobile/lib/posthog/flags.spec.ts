import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile isProductFlagEnabled re-export", () => {
  it("keeps the product-only warning and does not import can()", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/posthog/flags.ts"),
      "utf8",
    );
    expect(source).toContain("Never an authorization input");
    expect(source).toContain("@repo/observability");
    expect(source).not.toMatch(/from ["']@repo\/validation["']/);
  });
});

