import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Collect only from source. This package no longer builds (#1642), so this
    // keeps a dist/ left in an older checkout from ever being collected.
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
})
