import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.spec.{ts,tsx}"],
    /*
     * `tests/visual/` is the Playwright fold suite and runs under
     * `npm run test:fold`, not vitest — its specs import `@playwright/test`,
     * which throws outside a Playwright runner. It is EXCLUDED rather than left
     * unmatched on purpose: `vitest-collection.spec.ts` walks every
     * suite-shaped file under this workspace and fails if one is neither
     * included nor deliberately excluded, so silence here would be a failure,
     * not a default.
     */
    exclude: ["**/node_modules/**", "**/.next/**", "**/tests/visual/**"],
  },
});
