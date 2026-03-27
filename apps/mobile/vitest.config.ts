import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  define: {
    __DEV__: true,
  },
  resolve: {
    alias: {
      "react-native": "react-native-web",
    },
  },
});
