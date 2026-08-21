import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `node`, not jsdom, for the same reason as `@repo/chapter-theme`: this
    // package is consumed by React Native, and a suite that quietly provided a
    // DOM would hide exactly the regression the ESLint `no-restricted-globals`
    // rule guards against.
    environment: "node",
    globals: true,
  },
});
