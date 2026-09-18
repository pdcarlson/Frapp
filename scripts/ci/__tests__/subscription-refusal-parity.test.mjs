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
 * Walk `source` and return every JavaScript string literal in it, skipping
 * comments.
 *
 * WHY A SCANNER AND NOT A REGEX. The obvious
 * `/['"](Chapter subscription [^'"]*)['"]/` is wrong in a way that fails
 * **open**, which is the worst direction for this file. `[^'"]*` stops at the
 * first quote of either kind, so `"Chapter subscription isn't active; …"`
 * captures only `Chapter subscription isn`. Reword the guard and the mirror to
 * two *different* sentences that both contain "isn't" and both sides truncate
 * to the same prefix — `deepEqual` passes, the lock reports parity, and
 * `subscriptionRefusalFromServerMessage` returns `null` for every real 403
 * with every unit test still green. A contraction is a very likely rewording,
 * so this is not a theoretical hazard.
 *
 * Stripping comments with a regex first has the same shape of bug: cutting
 * each line at its first `//` also cuts `"https://…"` in half, and a `/*`
 * inside a line comment swallows code up to the next `*\/` anywhere in the
 * file. Deleting a `throw` that way would make the count assertion fire with a
 * nonsense diff, and deleting a line from the detector would make
 * `assert.doesNotMatch(…, /codeOf/)` pass while the detector really does use
 * it.
 *
 * So: one pass, tracking whether we are in a line comment, a block comment, or
 * a literal. Escapes are honoured, which is what lets an apostrophe or an
 * escaped quote survive intact. Template literals are skipped deliberately —
 * none of the scanned messages is one, and interpolation could not be compared
 * byte-for-byte anyway.
 */
function stringLiterals(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let value = "";
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          // Keep the escaped character itself, so `\'` compares equal to a
          // plain `'` written inside double quotes.
          value += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        value += source[i];
        i += 1;
      }
      i += 1;
      out.push(value);
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * The refusal messages a file declares.
 *
 * Adjacent literals are NOT joined: a `'…' + '…'` concatenation would compare
 * as two fragments and fail loudly rather than silently half-matching. If
 * Prettier ever wraps one of these messages that way, fix the wrap — do not
 * teach this function to concatenate, because then a real divergence in the
 * tail could hide behind a matching head.
 */
function refusalMessages(rel) {
  const found = stringLiterals(readRepo(rel)).filter((v) =>
    v.startsWith("Chapter subscription "),
  );
  return [...new Set(found)].sort();
}

/**
 * The right-hand side of one `const <name> = …;` declaration.
 *
 * WHY ASSERTIONS ARE ANCHORED THIS WAY. Matching a token against the whole
 * file proves the token exists somewhere, not that the control is gated — and
 * it fails in BOTH directions. Removing `status.kind === "blocked" ||` from
 * `manualSubmitDisabled` and reordering the unrelated render ternary to start
 * with `blocked` left this lock fully green while a refused member could still
 * submit a manual code; and merely reordering the disjuncts, which changes
 * nothing, turned it red. Both were reproduced against the first version of
 * this file. Slice the declaration, then assert inside it.
 */
function declaration(rel, name) {
  const code = readCode(rel);
  const start = code.indexOf(`const ${name}`);
  assert.ok(start !== -1, `${rel} no longer declares \`${name}\``);
  const end = code.indexOf(";", start);
  assert.ok(end !== -1, `${rel}: could not find the end of \`${name}\``);
  return code.slice(start, end);
}

/** Source with comments removed, for the wiring assertions further down. */
function readCode(rel) {
  return readRepo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
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
    readCode(MIRROR),
    /r\.reason === message/,
    "the lookup must compare messages exactly, not by prefix",
  );
  assert.doesNotMatch(
    readCode(MIRROR),
    /startsWith\(\s*["']Chapter subscription/,
    "a prefix match would also claim the BillingService 400",
  );
});

test("the mobile detector requires both the 403 and an exact message", () => {
  const detector = readCode((DETECTOR));
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
    // Stripped, deliberately. Against the raw source this passes on a comment
    // that merely NAMES the detector — including the comments this change
    // added — so the call could be deleted and the lock would stay green.
    assert.match(
      readCode((rel)),
      /subscriptionRefusalOf\(/,
      `${rel} no longer distinguishes a subscription refusal from a save failure`,
    );
  }
});

test("the task sheet withdraws its submit control on a refusal", () => {
  // The retry affordance here is the Create button staying enabled, which is
  // `canSubmit` — not any occurrence of the identifier elsewhere in the file.
  const canSubmit = declaration(TASK_SHEET, "canSubmit");
  assert.match(
    canSubmit,
    /!subscriptionRefused/,
    "Create is still offered after a refusal that cannot succeed",
  );
  // THE OTHER DIRECTION, and the regression that reverted the previous attempt
  // at #2297: an ordinary save failure must KEEP its retry. Gating `canSubmit`
  // on `submitFailed` too would withdraw Create from failures that recover.
  assert.doesNotMatch(
    canSubmit,
    /submitFailed/,
    "an ordinary save failure must not withdraw Create — only a refusal may",
  );
  assert.match(
    readCode((TASK_SHEET)),
    /setSubmitFailed\(true\)/,
    "ordinary save failures must keep their existing retry copy",
  );
});

test("check-in stops scanning and stops manual submit on a refusal", () => {
  assert.match(
    readCode((CHECK_IN)),
    /kind: "blocked"/,
    "the terminal refusal state is gone from check-in",
  );

  // Anchored to the declarations that actually gate the two affordances, so a
  // render-branch mention cannot satisfy either one.
  const scanning = declaration(CHECK_IN, "scanning");
  assert.match(
    scanning,
    /"blocked"/,
    "the scanner still re-arms after a refusal",
  );
  // The other direction: an ordinary error must NOT kill the scanner. Before
  // #2297 a failed scan always re-armed, and that has to stay true.
  assert.doesNotMatch(
    scanning,
    /!== "error"/,
    "an ordinary failure must not disarm the scanner — only a refusal may",
  );

  const manualSubmitDisabled = declaration(CHECK_IN, "manualSubmitDisabled");
  assert.match(
    manualSubmitDisabled,
    /"blocked"/,
    "manual submit is still enabled after a refusal",
  );
});

test("a refusal does not outlive the visit that produced it", () => {
  // Both screens keep the refusal in component state, and a tab screen is
  // never unmounted — so without a focus reset an officer could fix the
  // chapter's billing and the member would still be locked out until they
  // force-quit. "Dead until a force-quit" is what got the previous attempt
  // at #2297 reverted; it must not come back as the fix.
  assert.match(
    readCode((STUDY)),
    /useFocusEffect\([\s\S]{0,200}setSubscriptionRefused\(false\)/,
    "study never clears its refusal latch, so Start stays dead for the process",
  );
  assert.match(
    readCode((CHECK_IN)),
    /useFocusEffect\([\s\S]{0,300}kind === "blocked"/,
    "check-in never clears its blocked state, so the scanner stays dead",
  );
});

test("study does not re-arm its automatic retry against a refusal", () => {
  const study = readCode((STUDY));
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
  const source = readCode((STUDY_ERRORS));
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
