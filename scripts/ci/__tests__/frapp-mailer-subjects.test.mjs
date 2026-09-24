// Locks Auth inbox titles and the Magic Link body against a Signet leftover.
//
// WHY THIS EXISTS. checkAuthMagicLink pins Magic Link to `Sign in to Frapp`
// (ADR-25 step 3). Sibling mailer_subjects_* (invite, recovery,
// confirmation, …) are set by hand in the console. When the product was
// renamed, a subject the owner missed would keep saying Signet without the
// exact Magic Link compare noticing, and so would the Magic Link body's
// heading, which no subject compare reads. A later edit can drop either
// leftover check, or move the subject check above the empty-host skip so
// production fails while SMTP is still off.
//
// Until step 3 this lock was signet-mailer-subjects and the leftover was
// Frapp; ADR-25 inverted it.
//
// SCOPE. leftoverSignetMailerSubjectKeys, the checkAuthMagicLink call,
// skip-before-leftover order, and the body's Signet check. Do not assert
// TokenHash on siblings (1926, blocked). Do not PATCH Auth. Do not
// lowercase-compare the Magic Link subject here. SMTP sender name is
// frapp-smtp-sender-name's.

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
  if (!/export function leftoverSignetMailerSubjectKeys/.test(source)) {
    problems.push("leftoverSignetMailerSubjectKeys must be exported");
  }
  if (!/key\.startsWith\("mailer_subjects_"\)/.test(source)) {
    problems.push("must scan mailer_subjects_* keys");
  }
  if (!/\/Signet\/i\.test\(value\)/.test(source)) {
    problems.push("must match /Signet/i");
  }
  if (!/const leftoverSubjects = leftoverSignetMailerSubjectKeys\(data\)/.test(source)) {
    problems.push("checkAuthMagicLink must call leftoverSignetMailerSubjectKeys");
  }
  if (!/mailer_subjects contain Signet/.test(source)) {
    problems.push("fail detail must name leftover keys, not subject text");
  }
  if (!/if \(\/\\bSignet\\b\/i\.test\(content\.replace\(/.test(source)) {
    problems.push("checkAuthMagicLink must fail a Magic Link body that says Signet");
  }
  const skipAt = source.indexOf('!host && whenSmtpUnset === "skip"');
  const leftoverAt = source.indexOf(
    "const leftoverSubjects = leftoverSignetMailerSubjectKeys(data)",
  );
  if (skipAt === -1 || leftoverAt === -1 || leftoverAt < skipAt) {
    problems.push("leftover subject check must stay after the empty-host skip");
  }
  return problems;
}

test("checkAuthMagicLink fails Signet in any mailer_subjects_* key or the body", () => {
  assert.deepEqual(mailerSubjectLockProblems(readRepo(CONFORMANCE)), []);
});

test("moving the leftover check above the empty-host skip fails", () => {
  const assignment = "const leftoverSubjects = leftoverSignetMailerSubjectKeys(data)";
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

test("dropping leftoverSignetMailerSubjectKeys from checkAuthMagicLink fails", () => {
  const source = readRepo(CONFORMANCE).replace(
    "const leftoverSubjects = leftoverSignetMailerSubjectKeys(data)",
    "const leftoverSubjects = []",
  );
  const problems = mailerSubjectLockProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("must call leftoverSignetMailerSubjectKeys")),
    problems.join("; "),
  );
});

test("dropping the /Signet/i leftover match fails", () => {
  const source = readRepo(CONFORMANCE).replace("/Signet/i.test(value)", "/Frapp/i.test(value)");
  const problems = mailerSubjectLockProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("must match /Signet/i")),
    problems.join("; "),
  );
});

test("dropping the Magic Link body's Signet check fails", () => {
  const source = readRepo(CONFORMANCE).replace("if (/\\bSignet\\b/i.test(content.replace(", "if (false && (");
  const problems = mailerSubjectLockProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("body that says Signet")),
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
