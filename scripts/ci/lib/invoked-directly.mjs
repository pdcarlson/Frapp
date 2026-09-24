// Whether a script module is the process entry point: the one guard every
// script under scripts/ uses before running its CLI, so tests can import its
// helpers without executing it.
//
// invoked-directly.test.mjs locks the tree to this helper: no file under
// scripts/ may read argv[1] or compare import.meta.url itself. It is a text
// search, so it catches the spellings people write, not every alias.

import { realpathSync } from "node:fs";
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
 * Why a failed realpath means false, with no looser fallback. On a real
 * `node path/to/script.mjs` run, Node rewrites `process.argv[1]` to the
 * absolute path of the file it just loaded, so realpath on both sides
 * succeeds. It throws only when argv[1] names something other than the
 * entry, as in `node -e 'import("./x.mjs")' x.mjs`. There the module is not
 * the entry, and running its CLI would be the false positive: a live
 * branch-protection write from `configure-branch-protection.mjs`, or a
 * production deploy. The `endsWith("<name>.mjs")` guards this replaced were
 * loose to avoid the false negatives above; realpath removes those without
 * the looseness.
 *
 * @param {string} importMetaUrl the caller's `import.meta.url`
 * @param {string | null | undefined} [entry] the entry path, `process.argv[1]` by default
 * @returns {boolean}
 */
export function isInvokedDirectly(importMetaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
