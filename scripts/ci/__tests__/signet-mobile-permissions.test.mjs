// Locks mobile OS permission dialogs and Expo Go pay/push copy on Signet.
//
// WHY THIS EXISTS. The three app.json permission strings, the Expo Go
// pay/push sentences, and the PaymentSheet merchant default are already
// Signet. A leftover sweep can put Frapp back in the OS dialog without a
// product-copy test noticing. #1952.
//
// SCOPE. Permission strings, stripeUnavailableReason, pushUnavailableReason,
// and dues merchantDisplayName default. Leave app.json name / scheme /
// bundle id / Settings → Frapp on 1829. Do not run eas init.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const APP_JSON = "apps/mobile/app.json";
const STRIPE = "apps/mobile/lib/payments/stripe.ts";
const PUSH = "apps/mobile/lib/notifications/push.ts";
const DUES = "apps/mobile/app/(tabs)/dues.tsx";

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function literal(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PERMISSIONS = [
  "Signet uses the camera to scan the check-in code at chapter events.",
  "Signet uses your photo library so you can choose a profile photo or attach an image.",
  "Signet confirms you are inside a chapter study zone while you track study hours, and that you are at the event when you scan a check-in code.",
];

test("OS permission strings say Signet, not Frapp", () => {
  const source = readRepo(APP_JSON);
  for (const sentence of PERMISSIONS) {
    assert.match(source, new RegExp(literal(sentence)), sentence);
  }
  assert.doesNotMatch(
    source,
    /"(camera|photos|locationWhenInUse)Permission":\s*"[^"]*\bFrapp\b/,
    `${APP_JSON} permission strings must not name Frapp`,
  );
});

test("Expo Go pay and push sentences say Signet, not Frapp", () => {
  const stripe = readRepo(STRIPE);
  assert.match(stripe, /installed Signet build/);
  assert.match(stripe, /Signet mobile app/);
  assert.doesNotMatch(stripe, /installed Frapp build/);
  assert.doesNotMatch(stripe, /\bFrapp\b/, `${STRIPE} must not name Frapp`);

  const push = readRepo(PUSH);
  assert.match(push, /installed Signet build/);
  assert.doesNotMatch(push, /installed Frapp build/);
});

test("PaymentSheet merchant default is Signet", () => {
  const source = readRepo(DUES);
  assert.match(source, /merchantDisplayName:\s*chapterName \?\? "Signet"/);
  assert.doesNotMatch(source, /merchantDisplayName:\s*chapterName \?\? "Frapp"/);
});
