// Whether a script module is the process entry point: the one guard every
// script under scripts/ uses before running its CLI, so tests can import its
// helpers without executing it.
//
// invoked-directly.test.mjs locks the tree to this helper: no other file under
// scripts/ may read `process.argv[1]`, so a hand-rolled guard can't come back.

import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when the module whose `import.meta.url` is passed is the script node
 * was asked to run.
 *
 * Why realpath BOTH sides. The obvious forms compare two strings that aren't
 * always spelled the same:
 *
 * - `` import.meta.url === `file://${process.argv[1]}` `` fails on a path
 *   with a space (`file:///…/my%20repo/x.mjs` vs `/…/my repo/x.mjs`) or any
 *   other character a URL percent-encodes.
 * - `pathToFileURL(process.argv[1]).href` and `fileURLToPath(import.meta.url)`
 *   fix the encoding but not symlinks. Node realpath-resolves the ESM entry's
 *   `import.meta.url` by default but never `process.argv[1]`, and with
 *   `--preserve-symlinks-main` it resolves neither. A checkout reached through
 *   a symlink therefore compares a resolved path with an unresolved one.
 *
 * Either mismatch makes the guard false, and the script silently runs
 * nothing and exits 0. For a gate, that's a required check passing having
 * checked nothing. On the deploy path it's a step that records `success`
 * having done nothing. `run-migration.mjs` is the worst case: the run summary
 * says the migrations applied, and the deploy then ships new code against the
 * old schema.
 *
 * So a false negative is the catastrophic direction, and a false positive
 * (a same-named file importing this one) is harmless by comparison. That is
 * why, if realpath throws, the fallback compares basenames rather than
 * returning false. It errs toward running. The `endsWith("<name>.mjs")`
 * guards this helper replaced took the same side for the same reason; this
 * body keeps it without their looseness when both paths resolve.
 *
 * @param {string} importMetaUrl the caller's `import.meta.url`
 * @param {string | undefined} [entry] the entry path, `process.argv[1]` by default
 * @returns {boolean}
 */
export function isInvokedDirectly(importMetaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  const modulePath = fileURLToPath(importMetaUrl);
  try {
    return realpathSync(entry) === realpathSync(modulePath);
  } catch {
    return basename(entry) === basename(modulePath);
  }
}
