import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Importing the root layout runs its module scope (Sentry and PostHog init,
// the splash hold), so this reads the source, as `route-error.spec.tsx` does.
const layout = readFileSync(
  path.resolve(__dirname, "../../app/_layout.tsx"),
  "utf8",
);

describe("the root layout mounts the launch logo (#5449)", () => {
  it("holds the native splash, which only the launch logo hides", () => {
    expect(layout).toMatch(/^void SplashScreen\.preventAutoHideAsync\(\);$/m);
    expect(layout).not.toMatch(/SplashScreen\.hideAsync/);
  });

  it("mounts the cover from the first frame, beside the app rather than inside its font gate", () => {
    expect(layout).toMatch(
      /\{appMounted \? <RootProviders \/> : null\}\s*<LaunchCover appMounted=\{appMounted\} \/>/,
    );
  });
});
