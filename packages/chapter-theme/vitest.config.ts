import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `node`, not jsdom, on purpose: this package must stay callable from the
    // NestJS API, and a suite that quietly provided a DOM would hide exactly the
    // regression the tsconfig `lib` override and the ESLint rule guard against.
    environment: "node",
    globals: true,
  },
});
