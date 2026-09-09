// Locks invite-email From display name, subject, and body on Signet.
//
// WHY THIS EXISTS. Product copy is already Signet (1911). The API specs
// pin the strings when they run, but a leftover sweep can change
// DEFAULT_FROM_ADDRESS, move the From host to the burned apex, or put
// Frapp back in the subject without a scripts/ci ratchet noticing.
//
// SCOPE. Source lock only. Do not send mail. Do not change the From
// host (`mail.frapp.live` stays). Do not rename RESEND_FROM_EMAIL.
// Do not PATCH Auth. HTML and text helper bodies are checked
// separately so one Signet string cannot hide a leftover in the other.
// Case-sensitive leftover check: comments still name `frapp.live`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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

function walkProductTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkProductTs(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      out.push(path);
    }
  }
  return out;
}

export function inviteHelperSource(source, name) {
  const start = source.search(new RegExp(`function ${name}\\(`));
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

export function inviteCopySites(root = REPO_ROOT) {
  return walkProductTs(join(root, "apps", "api", "src"))
    .filter((path) => {
      const text = readFileSync(path, "utf8");
      return (
        /DEFAULT_FROM_ADDRESS/.test(text) || /You're invited to join a chapter/.test(text)
      );
    })
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .sort();
}

export function inviteFromLockProblems({ moduleSource, providerSource }) {
  const problems = [];
  if (!new RegExp(`const DEFAULT_FROM_ADDRESS = '${literal(FROM)}'`).test(moduleSource)) {
    problems.push("DEFAULT_FROM_ADDRESS must be Signet <invites@mail.frapp.live>");
  }
  if (/const DEFAULT_FROM_ADDRESS = 'Frapp /.test(moduleSource)) {
    problems.push("DEFAULT_FROM_ADDRESS display name must not be Frapp");
  }
  if (/const DEFAULT_FROM_ADDRESS = '[^']*<invites@frapp\.live>'/.test(moduleSource)) {
    problems.push("DEFAULT_FROM_ADDRESS must stay on mail.frapp.live, not the burned apex");
  }
  if (!/RESEND_FROM_EMAIL/.test(moduleSource)) {
    problems.push("must keep RESEND_FROM_EMAIL override name");
  }
  if (/\bFrapp\b/.test(moduleSource)) {
    problems.push("email.module.ts must not name Frapp");
  }
  if (!new RegExp(literal(SUBJECT)).test(providerSource)) {
    problems.push("invite subject must say Signet");
  }
  const html = inviteHelperSource(providerSource, "inviteEmailHtml");
  const text = inviteHelperSource(providerSource, "inviteEmailText");
  if (!html || !new RegExp(literal(BODY)).test(html)) {
    problems.push("inviteEmailHtml body must say Signet");
  }
  if (!text || !new RegExp(literal(BODY)).test(text)) {
    problems.push("inviteEmailText body must say Signet");
  }
  if (!/inviteEmailHtml/.test(providerSource) || !/inviteEmailText/.test(providerSource)) {
    problems.push("must keep inviteEmailHtml and inviteEmailText");
  }
  if (/\bFrapp\b/.test(providerSource)) {
    problems.push("resend-email.provider.ts must not name Frapp");
  }
  return problems;
}

test("invite From, subject, and body stay Signet on mail.frapp.live", () => {
  assert.deepEqual(
    inviteFromLockProblems({
      moduleSource: readRepo(MODULE),
      providerSource: readRepo(PROVIDER),
    }),
    [],
  );
  assert.deepEqual(inviteCopySites(), [PROVIDER, MODULE].sort());
});

test("pinning DEFAULT_FROM_ADDRESS display name to Frapp fails", () => {
  const problems = inviteFromLockProblems({
    moduleSource: readRepo(MODULE).replace(
      "Signet <invites@mail.frapp.live>",
      "Frapp <invites@mail.frapp.live>",
    ),
    providerSource: readRepo(PROVIDER),
  });
  assert.ok(
    problems.some((problem) => problem.includes("must not be Frapp")),
    problems.join("; "),
  );
});

test("moving DEFAULT_FROM_ADDRESS to the burned apex fails", () => {
  const problems = inviteFromLockProblems({
    moduleSource: readRepo(MODULE).replace(
      "Signet <invites@mail.frapp.live>",
      "Signet <invites@frapp.live>",
    ),
    providerSource: readRepo(PROVIDER),
  });
  assert.ok(
    problems.some((problem) => problem.includes("burned apex")),
    problems.join("; "),
  );
});

test("putting Frapp back in the invite subject fails", () => {
  const problems = inviteFromLockProblems({
    moduleSource: readRepo(MODULE),
    providerSource: readRepo(PROVIDER).replace(
      "You're invited to join a chapter on Signet",
      "You're invited to join a chapter on Frapp",
    ),
  });
  assert.ok(
    problems.some((problem) => /subject|must not name Frapp/.test(problem)),
    problems.join("; "),
  );
});

test("stripping Signet from inviteEmailText only fails", () => {
  const problems = inviteFromLockProblems({
    moduleSource: readRepo(MODULE),
    providerSource: readRepo(PROVIDER).replace(
      /function inviteEmailText\([^)]*\): string \{[\s\S]*?\n\}/,
      (block) => block.replace("on Signet as", "as"),
    ),
  });
  assert.ok(
    problems.some((problem) => problem.includes("inviteEmailText")),
    problems.join("; "),
  );
});

test("dropping inviteEmailHtml fails", () => {
  const problems = inviteFromLockProblems({
    moduleSource: readRepo(MODULE),
    providerSource: readRepo(PROVIDER).replaceAll("inviteEmailHtml", "inviteBodyHtml"),
  });
  assert.ok(
    problems.some((problem) => problem.includes("inviteEmailHtml")),
    problems.join("; "),
  );
});

test("renaming RESEND_FROM_EMAIL fails", () => {
  const problems = inviteFromLockProblems({
    moduleSource: readRepo(MODULE).replaceAll("RESEND_FROM_EMAIL", "SIGNET_FROM_EMAIL"),
    providerSource: readRepo(PROVIDER),
  });
  assert.ok(
    problems.some((problem) => problem.includes("RESEND_FROM_EMAIL")),
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
