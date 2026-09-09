// Locks already-Signet ops-nudge copy and retires Frapp payment fixtures.
//
// WHY THIS EXISTS. The nudge catalog already says Signet. Production
// PaymentSheet / Expo Go pay copy is already Signet (merchant leftover).
// Two mobile specs still fixture Frapp, and the catalog spec bans trial
// language but not Frapp. A leftover sweep that matches the fixtures, or
// that puts Frapp back in the catalog, would ship the wrong brand.
//
// SCOPE. Nudge headlines/descriptions and the two payment fixtures.
// Leave app.json name / scheme / bundle id / Settings path on the
// store-name leftover. Leave production stripe.ts / dues.tsx on the
// merchant leftover. Do not run eas init.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NUDGES = "packages/validation/src/ops-nudges.ts";
const STRIPE_SPEC = "apps/mobile/lib/payments/stripe.spec.ts";
const BALANCE_SPEC = "apps/mobile/components/dues/balance-card.spec.tsx";

export const DUES_HEADLINE = "Collect dues in Signet";
export const EVENTS_HEADLINE = "Run your calendar in Signet";

export function nudgeCopyProblems(source) {
  const problems = [];
  if (!new RegExp(`headline:\\s*"${DUES_HEADLINE}"`).test(source)) {
    problems.push(`dues headline must be ${DUES_HEADLINE}`);
  }
  if (!new RegExp(`headline:\\s*"${EVENTS_HEADLINE}"`).test(source)) {
    problems.push(`events headline must be ${EVENTS_HEADLINE}`);
  }
  if (/headline:\s*"[^"]*\bFrapp\b/.test(source)) {
    problems.push("nudge headline must not name Frapp");
  }
  if (/description:\s*"[^"]*\bFrapp\b/.test(source)) {
    problems.push("nudge description must not name Frapp");
  }
  return problems;
}

export function paymentFixtureProblems({ stripeSpec, balanceSpec }) {
  const problems = [];
  if (/merchantDisplayName:\s*"Frapp"/.test(stripeSpec)) {
    problems.push(`${STRIPE_SPEC} must not pass merchantDisplayName Frapp`);
  }
  if (!/merchantDisplayName:\s*"Signet"/.test(stripeSpec)) {
    problems.push(`${STRIPE_SPEC} must pass merchantDisplayName Signet`);
  }
  if (/installed Frapp build/.test(balanceSpec)) {
    problems.push(`${BALANCE_SPEC} must not fixture installed Frapp build`);
  }
  if (!/installed Signet build/.test(balanceSpec)) {
    problems.push(`${BALANCE_SPEC} must fixture installed Signet build`);
  }
  return problems;
}

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

test("live ops-nudge catalog stays Signet", () => {
  assert.deepEqual(nudgeCopyProblems(readRepo(NUDGES)), []);
});

test("putting Frapp in a nudge headline fails", () => {
  const source = readRepo(NUDGES).replace(
    DUES_HEADLINE,
    "Collect dues in Frapp",
  );
  const problems = nudgeCopyProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("Frapp")),
    problems.join("; "),
  );
});

test("renaming a Signet headline fails", () => {
  const source = readRepo(NUDGES).replace(
    EVENTS_HEADLINE,
    "Run your calendar in the app",
  );
  const problems = nudgeCopyProblems(source);
  assert.ok(
    problems.some((problem) => problem.includes("events headline")),
    problems.join("; "),
  );
});

test("live payment fixtures stay Signet", () => {
  assert.deepEqual(
    paymentFixtureProblems({
      stripeSpec: readRepo(STRIPE_SPEC),
      balanceSpec: readRepo(BALANCE_SPEC),
    }),
    [],
  );
});

test("restoring a Frapp PaymentSheet fixture fails", () => {
  const stripeSpec = readRepo(STRIPE_SPEC).replaceAll(
    'merchantDisplayName: "Signet"',
    'merchantDisplayName: "Frapp"',
  );
  const problems = paymentFixtureProblems({
    stripeSpec,
    balanceSpec: readRepo(BALANCE_SPEC),
  });
  assert.ok(
    problems.some((problem) => problem.includes("merchantDisplayName Frapp")),
    problems.join("; "),
  );
});

test("restoring a Frapp disabled-reason fixture fails", () => {
  const balanceSpec = readRepo(BALANCE_SPEC).replace(
    "installed Signet build",
    "installed Frapp build",
  );
  const problems = paymentFixtureProblems({
    stripeSpec: readRepo(STRIPE_SPEC),
    balanceSpec,
  });
  assert.ok(
    problems.some((problem) => problem.includes("installed Frapp build")),
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
