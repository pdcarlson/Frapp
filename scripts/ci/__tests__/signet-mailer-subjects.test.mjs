// Locks Auth inbox titles against a Frapp leftover.
//
// WHY THIS EXISTS. checkAuthMagicLink already pins Magic Link to
// `Sign in to Signet`. Sibling mailer_subjects_* (invite, recovery,
// confirmation, …) are still hosted defaults. A leftover sweep can put
// Frapp in those inbox titles without the exact Magic Link compare
// noticing. #1948.
//
// SCOPE. leftoverFrappMailerSubjectKeys + the checkAuthMagicLink call.
// Do not assert TokenHash on siblings (1926, blocked). Do not PATCH Auth.
// Do not lowercase-compare the Magic Link subject here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONFORMANCE = "scripts/ci/staging-conformance.mjs";

test("checkAuthMagicLink fails Frapp in any mailer_subjects_* key", () => {
  const source = readFileSync(join(REPO_ROOT, CONFORMANCE), "utf8");
  assert.match(source, /export function leftoverFrappMailerSubjectKeys/);
  assert.match(source, /key\.startsWith\("mailer_subjects_"\)/);
  assert.match(source, /\/Frapp\/i/);
  assert.match(source, /leftoverFrappMailerSubjectKeys\(data\)/);
  assert.match(source, /mailer_subjects contain Frapp/);
});
