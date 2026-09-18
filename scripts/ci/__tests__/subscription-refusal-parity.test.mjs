// Locks the subscription-refusal chain: the guard's messages, the shared
// mirror's copy of them, and the three mobile write surfaces that branch on
// them.
//
// WHY THIS EXISTS (#2297). A freshly created chapter is `subscription_status
// 'incomplete'` — chapter creation has no billing gate — so a founder reaches
// every screen and then fails every paid-ops *write*. Until #2297 the three
// write surfaces rendered that permanent refusal as an ordinary save failure
// and invited a retry that cannot succeed. That is the Guideline 2.1 finding.
//
// WHY THE DISCRIMINATOR IS PROSE, AND WHY THAT NEEDS A LOCK.
// `ChapterGuard.enforceSubscription` throws `ForbiddenException({code, message})`,
// but `AllExceptionsFilter` serialises exactly `{statusCode, error, message,
// requestId}` — `code` is dropped on every response (#1020). So `codeOf` is
// `null` in production and the message is the only discriminator that reaches
// a client. That makes the client's behaviour depend on four English strings
// living in two files, with nothing previously asserting they match. Reword
// one side and the refusal silently stops being recognised — the member gets
// the retry-forever bug back, and every unit test still passes because they
// all build their own fixtures. This is that missing assertion.
//
// A BARE 403 IS NOT A SUBSTITUTE, and this is the trap that reverted a prior
// attempt: these same write routes 403 for `PermissionsGuard` denials (both
// controllers carry a CLASS-level `@RequirePermissions`, which a `grep -B4`
// from `@Post(` misses) and for the `chapter.context.*` family, which a stale
// `active_chapter_id` produces for up to the 3600s JWT lifetime. Those all
// recover on their own and MUST keep their retry control. Do not "simplify"
// any branch below to a status check.
//
// SCOPE. Message parity between the guard and `@repo/validation`, and the
// wiring of the three surfaces named in #2297. Copy wording itself is asserted
// in `apps/mobile/lib/subscription-refusal.spec.ts` (no price/plan/link, names
// an officer, never says "try again"). Reads are deliberately NOT in scope:
// the gate returns early for GET/HEAD/OPTIONS, so a read surface has no
// refusal to render and a gate state on a read error is dead code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const GUARD = "apps/api/src/interface/guards/chapter.guard.ts";
const MIRROR = "packages/validation/src/subscription.ts";
const DETECTOR = "apps/mobile/lib/subscription-refusal.ts";
const TASK_SHEET = "apps/mobile/components/tasks/new-task-sheet.tsx";
const CHECK_IN = "apps/mobile/app/(tabs)/check-in.tsx";
const STUDY = "apps/mobile/app/(tabs)/study.tsx";
const STUDY_ERRORS = "apps/mobile/lib/study/errors.ts";

/** Every refusal the guard can throw. A dropped one must fail this lock. */
const REFUSAL_COUNT = 4;

function readRepo(rel) {
  const source = readFileSync(join(REPO_ROOT, rel), "utf8");
  assert.ok(
    source.length > 0,
    `${rel} is empty — this lock cannot assert anything about it`,
  );
  return source;
}

/**
 * Strip comments before scanning for message literals.
 *
 * Both files discuss these strings in prose — the mirror's own docblock quotes
 * the BillingService 400 that shares their opening words — so an uncommented
 * scan picks up documentation and reports a false mismatch.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n]*?\/\/.*$/gm, (line) =>
    // Keep the code before a trailing `//`, drop the comment.
    line.slice(0, line.indexOf("//")),
  );
}

function refusalMessages(rel) {
  const found = [
    ...stripComments(readRepo(rel)).matchAll(
      /['"](Chapter subscription [^'"]*)['"]/g,
    ),
  ].map((m) => m[1]);
  return [...new Set(found)].sort();
}

test("the guard and the shared mirror carry byte-identical refusal messages", () => {
  const fromGuard = refusalMessages(GUARD);
  const fromMirror = refusalMessages(MIRROR);

  assert.equal(
    fromGuard.length,
    REFUSAL_COUNT,
    `expected ${REFUSAL_COUNT} refusal messages in ${GUARD}, found ${fromGuard.length}: ${JSON.stringify(fromGuard)}`,
  );

  // The whole point: a reworded guard message fails here rather than silently
  // disabling the client's only discriminator.
  assert.deepEqual(
    fromMirror,
    fromGuard,
    `${MIRROR} has drifted from ${GUARD}. The mobile write surfaces recognise a ` +
      `subscription refusal by matching these strings exactly, so a mismatch ` +
      `restores the retry-forever bug in #2297 with every unit test still green.`,
  );
});

test("the mirror exposes the message lookup, and does not reach for `code`", () => {
  const mirror = readRepo(MIRROR);
  assert.match(
    mirror,
    /export function subscriptionRefusalFromServerMessage/,
    "the shared lookup the clients depend on is gone",
  );
  // Exact equality, never a prefix: `billing.service.ts` throws a 400 opening
  // with the same words ("…is past due, not cancelled"), and a prefix test
  // would claim it and strip the retry from a recoverable failure.
  assert.match(
    stripComments(mirror),
    /r\.reason === message/,
    "the lookup must compare messages exactly, not by prefix",
  );
  assert.doesNotMatch(
    stripComments(mirror),
    /startsWith\(\s*["']Chapter subscription/,
    "a prefix match would also claim the BillingService 400",
  );
});

test("the mobile detector requires both the 403 and an exact message", () => {
  const detector = stripComments(readRepo(DETECTOR));
  assert.match(
    detector,
    /statusOf\(error\) !== 403/,
    "the 403 narrowing is gone from the detector",
  );
  assert.match(
    detector,
    /subscriptionRefusalFromServerMessage\(serverMessageOf\(error\)\)/,
    "the detector no longer reads the server message",
  );
  // `codeOf` is `null` on every real response. A detector using it typechecks,
  // returns null forever, and silently reopens #2297.
  assert.doesNotMatch(
    detector,
    /codeOf/,
    `${DETECTOR} must not branch on codeOf — AllExceptionsFilter drops it (#1020)`,
  );
});

test("all three write surfaces route their failures through the detector", () => {
  for (const rel of [TASK_SHEET, CHECK_IN, STUDY_ERRORS]) {
    assert.match(
      readRepo(rel),
      /subscriptionRefusalOf/,
      `${rel} no longer distinguishes a subscription refusal from a save failure`,
    );
  }
});

test("the task sheet withdraws its submit control on a refusal", () => {
  const sheet = stripComments(readRepo(TASK_SHEET));
  // The retry affordance here is the Create button staying enabled.
  assert.match(
    sheet,
    /!subscriptionRefused/,
    "Create is still offered after a refusal that cannot succeed",
  );
  // The other direction: an ordinary failure keeps the copy and the retry it
  // has always had.
  assert.match(
    sheet,
    /setSubmitFailed\(true\)/,
    "ordinary save failures must keep their existing retry copy",
  );
});

test("check-in stops scanning and stops manual submit on a refusal", () => {
  const checkIn = stripComments(readRepo(CHECK_IN));
  assert.match(
    checkIn,
    /kind: "blocked"/,
    "the terminal refusal state is gone from check-in",
  );
  // Both affordances: the camera re-arming, and the manual code field.
  assert.match(
    checkIn,
    /status\.kind !== "blocked"/,
    "the scanner still re-arms after a refusal",
  );
  assert.match(
    checkIn,
    /status\.kind === "blocked" \|\|/,
    "manual submit is still enabled after a refusal",
  );
});

test("study does not re-arm its automatic retry against a refusal", () => {
  const study = stripComments(readRepo(STUDY));
  // This one is the automatic version of the bug: the pause/resume mirror
  // re-armed a setTimeout on EVERY error, so a permanent refusal spun it every
  // MIRROR_RETRY_MS for as long as the screen stayed open.
  assert.match(
    study,
    /if \(!refused\) \{\s*retryTimer = setTimeout\(/,
    "the mirror retry timer is no longer guarded against a permanent refusal",
  );
  assert.match(
    study,
    /isBlocked=\{subscriptionRefused\}/,
    "Start is still offered after a refusal",
  );
});

test("the study refusal branch sits above the arms that relay the server string", () => {
  const source = stripComments(readRepo(STUDY_ERRORS));
  // Ordering is load-bearing. Below the 403 arm the branch is dead, and the
  // 403 arm returns the server's own words — for an `incomplete` chapter
  // "…complete checkout to use this feature.", a purchase instruction the
  // store declaration forbids in this app.
  for (const fn of ["startErrorCopy", "sessionErrorCopy"]) {
    const body = source.slice(source.indexOf(`export function ${fn}`));
    const refusalAt = body.indexOf("subscriptionRefusalOf");
    const relayAt = body.indexOf("case 403:");
    assert.ok(refusalAt !== -1, `${fn} lost its subscription-refusal branch`);
    assert.ok(relayAt !== -1, `${fn} lost its 403 arm — this lock needs updating`);
    assert.ok(
      refusalAt < relayAt,
      `${fn} checks the refusal after its 403 arm, which makes the branch dead`,
    );
  }
});
