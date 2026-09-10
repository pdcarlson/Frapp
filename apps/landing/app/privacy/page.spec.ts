import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("landing privacy copy", () => {
  it("names Sentry and PostHog, and does not claim production replay", () => {
    const source = readFileSync(
      join(process.cwd(), "app/privacy/page.tsx"),
      "utf8",
    );
    expect(source).toContain("Sentry");
    expect(source).toContain("PostHog");
    expect(source).toContain("anonymous");
    expect(source).toContain("Session replay is not recorded in production");
    expect(source).not.toMatch(/session replay is enabled/i);
  });
});
