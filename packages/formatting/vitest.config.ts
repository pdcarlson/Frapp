import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // West-of-Greenwich so bare-date tests can catch a fold into
    // `new Date("YYYY-MM-DD")` (UTC midnight → previous local day).
    env: { TZ: "America/Los_Angeles" },
  },
});
