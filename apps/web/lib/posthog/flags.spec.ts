import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("isProductFlagEnabled", () => {
  it("is documented as not an authorization input and does not import can()", () => {
    const source = readFileSync(join(process.cwd(), "lib/posthog/flags.ts"), "utf8");
    expect(source).toContain("Never an authorization input");
    expect(source).not.toMatch(/\bcan\(/);
    expect(source).not.toMatch(/from "@repo\/validation"/);
  });
});
