import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom, not node: the realtime-manager suite exercises the browser-default
    // adapters against real `window.localStorage` and real online/offline
    // `Event` dispatch — that is the point of it traveling unmodified.
    environment: "jsdom",
    globals: true,
    // Collect only from source (this package emits no dist, but a stray local
    // build must never turn compiled twins into collected suites — see
    // packages/hooks for the incident this guards against).
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
