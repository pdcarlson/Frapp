import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("metro.config.js", () => {
  it("uses getSentryExpoConfig with includeWebReplay false", () => {
    const source = readFileSync(join(process.cwd(), "metro.config.js"), "utf8");
    expect(source).toContain('require("@sentry/react-native/metro")');
    expect(source).toContain("getSentryExpoConfig");
    expect(source).toContain("includeWebReplay: false");
    expect(source).toContain("includeWebFeedback: false");
    expect(source).toContain("annotateReactComponents: false");
  });
});
