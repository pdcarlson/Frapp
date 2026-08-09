import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Collect only from source. `npm run build` (tsc, outDir: dist) compiles the
    // specs alongside the hooks, so an unscoped run also picks up the CommonJS
    // twins in dist/ — which cannot import Vitest and fail on collection. CI
    // builds the shared packages before running this suite, so leaving this
    // unscoped turns the job red on a clean checkout, not just on a stale local
    // dist/.
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
})
