// Locks Auth SMTP sender display name on Signet.
//
// WHY THIS EXISTS. checkAuthSmtp already locks host, From address, and
// send cap. The customer-visible display name is a separate Management
// API field (`smtp_sender_name`). Live staging is already `Signet`
// (GET 2026-09-09). A leftover sweep can put `Frapp` back without the
// address check noticing. #1946.
//
// SCOPE. The AUTH_SMTP_SENDER_NAME constant and the smtp_sender_name
// compare in checkAuthSmtp. Do not PATCH Auth. Do not lowercase the
// compare (live value is `Signet`). Production empty host still skips.
// Calendar / export / system-user leftovers are other issues.

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

test("AUTH_SMTP_SENDER_NAME is Signet and checkAuthSmtp compares smtp_sender_name", () => {
  const source = readRepo(CONFORMANCE);
  assert.match(source, /export const AUTH_SMTP_SENDER_NAME = "Signet"/);
  assert.match(source, /data\?\.smtp_sender_name/);
  assert.match(source, /senderName !== AUTH_SMTP_SENDER_NAME/);
  assert.doesNotMatch(
    source,
    /smtp_sender_name\.trim\(\)\.toLowerCase\(\)/,
    "do not lowercase the sender; live value is Signet",
  );
  assert.doesNotMatch(
    source,
    /AUTH_SMTP_SENDER_NAME = "Frapp"/,
    `${CONFORMANCE} must not pin the leftover sender`,
  );
});
