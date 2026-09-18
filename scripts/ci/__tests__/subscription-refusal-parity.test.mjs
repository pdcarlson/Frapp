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
function scan(source) {
  const literals = [];
  let code = "";
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
      code += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let value = "";
      const at = code.length;
      code += quote;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          value += source[i + 1] ?? "";
          code += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        value += source[i];
        code += source[i];
        i += 1;
      }
      code += quote;
      i += 1;
      // Template literals are scanned so their contents cannot be mistaken for
      // code, but they are not offered as refusal messages: an interpolated
      // string could not be compared byte-for-byte anyway.
      if (quote !== "`") literals.push({ value, at });
      continue;
    }
    code += c;
    i += 1;
  }
  return { literals, code };
}

/** Every non-template string literal in a file, comments excluded. */
function stringLiterals(rel) {
  return scan(readRepo(rel)).literals.map((l) => l.value);
}

/**
 * Source with comments removed, for the wiring assertions.
 *
 * Shares the scanner above rather than running its own regexes. The earlier
 * regex version stripped block comments FIRST, so a `/*` inside a line comment
 * or a string ate everything up to the next `*\/` anywhere in the file — which
 * would have made `assert.doesNotMatch(detector, /codeOf/)` pass while the
 * detector really did use it. A guard that fails open is the one thing this
 * file must not contain.
 */
function readCode(rel) {
  return scan(readRepo(rel)).code;
}

/**
 * The refusal messages a file declares.
 *
 * Adjacent literals are NOT joined: a `'…' + '…'` concatenation compares as
 * two fragments and fails loudly rather than silently half-matching.
 */
function refusalMessages(rel) {
  const found = stringLiterals(rel).filter((v) =>
    v.startsWith("Chapter subscription "),
  );
  return [...new Set(found)].sort();
}

/**
 * Every message `enforceSubscription` throws, however it is worded.
 *
 * Counted from the function body rather than by prefix, because the prefix
 * filter can only ever see messages that already conform: adding a fifth
 * refusal worded "Your chapter trial has ended…" left the count at 4, the
 * mirror un-updated, and the lock green while that 403 rendered to members as
 * an ordinary retryable failure.
 */
function guardRefusalThrows() {
  const code = readCode(GUARD);
  const start = code.indexOf("private enforceSubscription(");
  assert.ok(start !== -1, `${GUARD} no longer declares enforceSubscription`);
  let depth = 0;
  let i = code.indexOf("{", start);
  const bodyStart = i;
  for (; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = code.slice(bodyStart, i);
  const { literals } = scan(readRepo(GUARD));
  const inBody = literals
    .filter((l) => l.at >= bodyStart && l.at < i)
    .map((l) => l.value);
  return {
    throwCount: (body.match(/new ForbiddenException\(/g) ?? []).length,
    // A space is what separates a message from a `code`: the codes are
    // dotted identifiers (`chapter.subscription.canceled`), the messages are
    // sentences. Without this the count reads 8 against 4 throws.
    messages: inBody.filter(
      (v) => v.includes(" ") && v.toLowerCase().includes("subscription"),
    ),
  };
}

/**
 * The right-hand side of one `const <name> = …;` declaration.
 *
 * WHY ASSERTIONS ARE ANCHORED THIS WAY. Matching a token against the whole
 * file proves the token exists somewhere, not that the control is gated — and
 * it failed in BOTH directions. Removing the gate from `manualSubmitDisabled`
 * and reordering an unrelated render ternary left the lock fully green while a
 * refused member could still submit; merely reordering the disjuncts, which
 * changes nothing, turned it red. Both were reproduced against earlier
 * versions of this file.
 *
 * The slice ends at the first `;` at brace/paren depth 0, so a declaration
 * containing an inner `;` (a `useMemo` with a block body, say) is captured
 * whole instead of truncating to a head that passes every `doesNotMatch`
 * vacuously. The name must be followed by a non-identifier character, so a
 * `const scanningPaused` declared above `const scanning` cannot silently
 * redirect the assertions to the wrong statement.
 */
function declaration(rel, name) {
  const code = readCode(rel);
  const at = new RegExp(`const ${name}(?![A-Za-z0-9_$])`).exec(code);
  assert.ok(at, `${rel} no longer declares \`${name}\``);
  let depth = 0;
  for (let i = at.index; i < code.length; i += 1) {
    const c = code[i];
    if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") depth -= 1;
    else if (c === ";" && depth === 0) return code.slice(at.index, i);
  }
  assert.fail(`${rel}: could not find the end of \`${name}\``);
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

test("every refusal the guard throws is one the mirror knows", () => {
  const { throwCount, messages } = guardRefusalThrows();
  const known = refusalMessages(MIRROR);

  // Counted from the function body, not filtered by prefix. A fifth refusal
  // worded "Your chapter trial has ended…" previously left the count at 4 and
  // the lock green, while that 403 rendered to members as an ordinary
  // retryable failure.
  assert.equal(
    messages.length,
    throwCount,
    `enforceSubscription throws ${throwCount} ForbiddenException(s) but only ` +
      `${messages.length} carry a subscription message this lock can read: ` +
      `${JSON.stringify(messages)}`,
  );
  for (const message of messages) {
    assert.ok(
      known.includes(message),
      `the guard throws a refusal the mirror does not know:\n  ${message}\n` +
        `Add it to packages/validation/src/subscription.ts, or every client ` +
        `will read that 403 as an ordinary retryable failure.`,
    );
  }
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
  //
  // LIMITS, STATED. `apps/mobile/app/(tabs)` has no render harness, so this is
  // a source tripwire, not a behaviour test: it cannot prove the effect runs,
  // and hoisting the callback to a named `const` will trip it even though
  // behaviour is unchanged. If you are here because a refactor turned it red,
  // re-point the assertion — do not delete it. The real fix is a harness for
  // these two screens.
  const study = readCode(STUDY);
  assert.match(
    study,
    /useFocusEffect\(/,
    "study no longer resets anything on focus",
  );
  // Unconditional, so a reset neutered into a branch that never runs fails.
  assert.match(
    study,
    /\n\s*setSubscriptionRefused\(false\);/,
    "study's latch reset is gone or is no longer unconditional",
  );

  const checkIn = readCode(CHECK_IN);
  assert.match(
    checkIn,
    /useFocusEffect\(/,
    "check-in no longer resets anything on focus",
  );
  // The MAPPING, not the tokens: an inverted ternary (`? current : idle`)
  // names all the same identifiers while leaving both latches in place.
  assert.match(
    checkIn,
    /\?\s*\{ kind: "idle" \}/,
    "check-in's focus reset no longer maps the dead states to idle",
  );
  for (const dead of ['"blocked"', '"success"']) {
    assert.ok(
      checkIn.includes(`current.kind === ${dead}`),
      `check-in does not clear ${dead} on focus, and it disarms the scanner`,
    );
  }
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
