import { isomorphicConfig } from "@repo/eslint-config/isomorphic";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...isomorphicConfig,
  {
    // Upstream source held under `--max-warnings 0` would fail on style alone,
    // and reformatting it would destroy the byte-for-byte diff that makes the
    // provenance checkable. It is still typechecked and still built.
    ignores: ["src/vendor/**"],
  },
];
