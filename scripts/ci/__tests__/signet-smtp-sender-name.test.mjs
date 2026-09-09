// Locks Auth SMTP sender display name on Signet.
//
// WHY THIS EXISTS. checkAuthSmtp already locks host, From address, and
// send cap. The customer-visible display name is a separate Management
// API field (`smtp_sender_name`). Live staging is already `Signet`
// (GET 2026-09-09). A leftover sweep can put `Frapp` back without the
// address check noticing, or drop the skip-until-on sender hint so an
// operator does not know production will require Signet once SMTP is on.
//
// SCOPE. AUTH_SMTP_SENDER_NAME, the trim-only smtp_sender_name compare,
// and the skip-until-on operator hint. Do not PATCH Auth. Do not
// lowercase the compare (live value is `Signet`). Production empty host
// still skips even when sender is Frapp. Mailer subjects stay on leftover
// 1948. Invite From stays on leftover 1949.

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

export function senderLockProblems(source) {
  const problems = [];
  if (!/export const AUTH_SMTP_SENDER_NAME = "Signet"/.test(source)) {
    problems.push("AUTH_SMTP_SENDER_NAME must be Signet");
  }
  if (/AUTH_SMTP_SENDER_NAME = "Frapp"/.test(source)) {
    problems.push("AUTH_SMTP_SENDER_NAME must not be Frapp");
  }
  if (!/senderName !== AUTH_SMTP_SENDER_NAME/.test(source)) {
    problems.push("checkAuthSmtp must compare smtp_sender_name to AUTH_SMTP_SENDER_NAME");
  }
  if (
    !/typeof data\?\.smtp_sender_name === "string" \? data\.smtp_sender_name\.trim\(\)/.test(
      source,
    )
  ) {
    problems.push("compare smtp_sender_name after trim only");
  }
  if (/smtp_sender_name\.trim\(\)\.toLowerCase\(\)/.test(source)) {
    problems.push("do not lowercase the sender; live value is Signet");
  }
  if (!/smtp_sender_name=\$\{AUTH_SMTP_SENDER_NAME\}/.test(source)) {
    problems.push("skip-until-on hint must name the Signet sender");
  }
  return problems;
}

test("AUTH_SMTP_SENDER_NAME is Signet and checkAuthSmtp compares smtp_sender_name", () => {
  assert.deepEqual(senderLockProblems(readRepo(CONFORMANCE)), []);
});

test("pinning AUTH_SMTP_SENDER_NAME to Frapp fails", () => {
  const source = readRepo(CONFORMANCE).replaceAll(
    'AUTH_SMTP_SENDER_NAME = "Signet"',
    'AUTH_SMTP_SENDER_NAME = "Frapp"',
  );
  const problems = senderLockProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("must not be Frapp")),
    problems.join("; "),
  );
});

test("dropping the skip-until-on sender hint fails", () => {
  const source = readRepo(CONFORMANCE).replace(
    "smtp_sender_name=${AUTH_SMTP_SENDER_NAME} and smtp_admin_email=",
    "smtp_admin_email=",
  );
  const problems = senderLockProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("skip-until-on hint")),
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
