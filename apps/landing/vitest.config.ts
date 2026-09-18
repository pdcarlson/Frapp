import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.spec.{ts,tsx}"],
    /*
     * `tests/visual/` is the Playwright fold suite and runs under
     * `npm run test:fold`, not vitest — its specs import `@playwright/test`,
     * which throws `did not expect test.describe() to be called here` outside a
     * Playwright runner. So this entry is load-bearing: drop it and
     * `npm run test -w apps/landing` dies on collection.
     *
     * **Nothing catches that for you.** `vitest-collection.spec.ts` reports
     * files matching NEITHER array, and `tests/visual/fold.spec.ts` matches
     * `include` — so that guard returns clean with or without this line, and a
     * second Playwright spec added under some other directory would slip past
     * it the same way. The guard covers silently-skipped suites, not
     * wrongly-collected ones. Same shape as `apps/web/vitest.config.ts`.
     */
    exclude: ["**/node_modules/**", "**/.next/**", "**/tests/visual/**"],
  },
});
