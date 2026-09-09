// Locks invite-email From display name, subject, and body on Signet.
//
// WHY THIS EXISTS. Product copy is already Signet (#1911). The API specs
// pin the strings when they run, but a leftover sweep can change
// DEFAULT_FROM_ADDRESS or the subject without a scripts/ci ratchet
// noticing. #1949.
//
// SCOPE. Source lock only. Do not send mail. Do not change the From
// host (`mail.frapp.live` stays). Do not rename RESEND_FROM_EMAIL.
// Case-sensitive leftover check: comments still name `frapp.live`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const MODULE = "apps/api/src/modules/email/email.module.ts";
const PROVIDER = "apps/api/src/infrastructure/email/resend-email.provider.ts";

const FROM = "Signet <invites@mail.frapp.live>";
const SUBJECT = "You're invited to join a chapter on Signet";
const BODY = "invited to join a chapter on Signet as";

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function literal(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("DEFAULT_FROM_ADDRESS display name is Signet", () => {
  const source = readRepo(MODULE);
  assert.match(
    source,
    new RegExp(`const DEFAULT_FROM_ADDRESS = '${literal(FROM)}'`),
  );
  assert.doesNotMatch(source, /\bFrapp\b/, `${MODULE} must not name Frapp`);
});

test("invite subject and body say Signet, not Frapp", () => {
  const source = readRepo(PROVIDER);
  assert.match(source, new RegExp(literal(SUBJECT)));
  assert.match(source, new RegExp(literal(BODY)));
  assert.match(source, /inviteEmailHtml/);
  assert.match(source, /inviteEmailText/);
  assert.doesNotMatch(source, /\bFrapp\b/, `${PROVIDER} must not name Frapp`);
});
