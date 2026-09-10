// Locks Auth inbox titles against a Frapp leftover.
//
// WHY THIS EXISTS. checkAuthMagicLink already pins Magic Link to
// `Sign in to Signet`. Sibling mailer_subjects_* (invite, recovery,
// confirmation, …) are still hosted defaults. A leftover sweep can put
// Frapp in those inbox titles without the exact Magic Link compare
// noticing, or move the leftover check above the empty-host skip so
// production fails while SMTP is still off.
//
// SCOPE. leftoverFrappMailerSubjectKeys, the checkAuthMagicLink call,
// and skip-before-leftover order. Do not assert TokenHash on siblings
// (1926, blocked). Do not PATCH Auth. Do not lowercase-compare the
// Magic Link subject here. SMTP sender name stays on leftover 1946.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONFORMANCE = "scripts/ci/staging-conformance.mjs";

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

export function mailerSubjectLockProblems(source) {
  const problems = [];
  if (!/export function leftoverFrappMailerSubjectKeys/.test(source)) {
    problems.push("leftoverFrappMailerSubjectKeys must be exported");
  }
  if (!/key\.startsWith\("mailer_subjects_"\)/.test(source)) {
    problems.push("must scan mailer_subjects_* keys");
  }
  if (!/\/Frapp\/i/.test(source)) {
    problems.push("must match /Frapp/i");
  }
  if (!/const leftoverSubjects = leftoverFrappMailerSubjectKeys\(data\)/.test(source)) {
    problems.push("checkAuthMagicLink must call leftoverFrappMailerSubjectKeys");
  }
  if (!/mailer_subjects contain Frapp/.test(source)) {
    problems.push("fail detail must name leftover keys, not subject text");
  }
  const skipAt = source.indexOf('!host && whenSmtpUnset === "skip"');
  const leftoverAt = source.indexOf(
    "const leftoverSubjects = leftoverFrappMailerSubjectKeys(data)",
  );
  if (skipAt === -1 || leftoverAt === -1 || leftoverAt < skipAt) {
    problems.push("leftover subject check must stay after the empty-host skip");
  }
  return problems;
}

test("checkAuthMagicLink fails Frapp in any mailer_subjects_* key", () => {
  assert.deepEqual(mailerSubjectLockProblems(readRepo(CONFORMANCE)), []);
});

test("moving the leftover check above the empty-host skip fails", () => {
  const assignment = "const leftoverSubjects = leftoverFrappMailerSubjectKeys(data)";
  const source = readRepo(CONFORMANCE)
    .replace(assignment, "/* leftover moved above skip */")
    .replace(
      'if (!host && whenSmtpUnset === "skip")',
      `${assignment};\n  if (!host && whenSmtpUnset === "skip")`,
    );
  const problems = mailerSubjectLockProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("empty-host skip")),
    problems.join("; "),
  );
});

test("dropping leftoverFrappMailerSubjectKeys from checkAuthMagicLink fails", () => {
  const source = readRepo(CONFORMANCE).replace(
    "const leftoverSubjects = leftoverFrappMailerSubjectKeys(data)",
    "const leftoverSubjects = []",
  );
  const problems = mailerSubjectLockProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("must call leftoverFrappMailerSubjectKeys")),
    problems.join("; "),
  );
});

test("dropping the /Frapp/i leftover match fails", () => {
  const source = readRepo(CONFORMANCE).replace("/Frapp/i", "/Signet/i");
  const problems = mailerSubjectLockProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("must match /Frapp/i")),
    problems.join("; "),
  );
});

test("refuses a GitHub closer next to an issue number", () => {
  const lock = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(
    lock,
    /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i,
  );
});
