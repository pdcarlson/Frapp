import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // NOTE: `clearMocks` is deliberately OFF. It looks like the right fix for
    // the shared `expo-router` mock (see vitest.setup.ts), but it is global, and
    // `lib/theme.spec.tsx` asserts on a `Platform.select` call made at *module
    // load* — clearing between tests erases that record and fails the mono
    // fallback test. A spec that asserts on navigation clears its own mocks.
  },
  define: {
    __DEV__: true,
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      // Mirrors the `@/*` → `./*` mapping in tsconfig.json. Without it a spec
      // cannot import any screen or component, because effectively all of them
      // reach `@/lib/theme` for their token factory — which is why no component
      // had a test before #937 C1. `tsc` resolved it and vitest did not, so the
      // gap only ever showed up as an unwritten test.
      "@": path.resolve(__dirname),
      "react-native": "react-native-web",
      react: path.resolve(__dirname, "../../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
    },
  },
});
