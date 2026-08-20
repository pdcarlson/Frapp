/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/theme"],
  experimental: {
    // Next 16 defaults this to true and then looks for `typescript/bin/tsc`.
    // The `typescript` package here is `@typescript/typescript6` (compiler API
    // + `tsc6` only) so Nest, typescript-eslint, and ts-jest keep working;
    // native `tsc` lives on `@typescript/native`. API mode uses that compiler
    // API. See docs/internal/ci-cd/AGENT_INFRA.md § TypeScript 7.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
