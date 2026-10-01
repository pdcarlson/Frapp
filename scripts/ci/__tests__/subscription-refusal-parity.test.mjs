// Locks the subscription-refusal chain at the level only source can check:
// the guard's messages, the shared mirror's copy of them, the mobile detector
// that matches on them, and the order of the study copy's arms. What the
// mobile write surfaces DO with a refusal is rendered (see SCOPE).
//
// WHY THIS EXISTS (#2297). A freshly created chapter is `subscription_status
// 'incomplete'` — chapter creation has no billing gate — so a founder reaches
// every screen and then fails every paid-ops *write*. Until #2297 the three
// write surfaces rendered that permanent refusal as an ordinary save failure
// and invited a retry that cannot succeed. That is the Guideline 2.1 finding.
//
// WHY THE DISCRIMINATOR IS PROSE, AND WHY THAT NEEDS A LOCK.
// `ChapterGuard.enforceSubscription` throws `ForbiddenException({code, message})`,
// but until #1020 `AllExceptionsFilter` dropped `code`, so the message was the
// only discriminator that reached a client. The code arrives now, and reading it
// first is #2995, but installed builds and an API that predates #1020 still
// depend on the message. That makes the client's behaviour depend on four English strings
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
// SCOPE. Message parity between the guard and `@repo/validation`, the
// detector, and the order of the study copy's arms. What the write surfaces
// DO with a refusal is rendered, not source-matched (#2416):
// `apps/mobile/lib/events/check-in-screen.spec.tsx`,
// `apps/mobile/lib/study/study-screen.spec.tsx`,
// `apps/mobile/components/tasks/new-task-sheet.spec.tsx` (the three #2297
// named), `apps/mobile/lib/more/service-hours-screen.spec.tsx` (#2410) and
// `apps/mobile/lib/tasks/tasks-screen.spec.tsx` (the status toggle, #2710).
// Copy wording itself is asserted in `apps/mobile/lib/subscription-refusal.spec.ts`
// (no price/plan/link, names an officer, never says "try again"). Reads are
// deliberately NOT in scope: the gate returns early for GET/HEAD/OPTIONS, so a read surface has no
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
 * Split `source` into code and string literals, in one pass.
 *
 * WHY A SCANNER AND NOT A REGEX. `/['"](Chapter subscription [^'"]*)['"]/`
 * fails **open**: `[^'"]*` stops at the first quote, so
 * "Chapter subscription isn't active; complete checkout" captures only
 * "Chapter subscription isn". Reword the guard and the mirror to two
 * different sentences that both contain a contraction and both truncate to
 * the same prefix — the lock reports parity, the discriminator is dead, and
 * every unit test stays green. Stripping comments by regex fails the same
 * way: cutting each line at its first `//` also cuts `"https://…"` in half.
 *
 * `code` keeps string CONTENTS, so the assertions over it can match a string
 * where one is part of the rule. That makes any structural walk over `code`
 * steerable by string text, which was proven — a `}` inside a string
 * truncated the guard-body walk — so every literal's span is recorded and the
 * walker jumps them.
 *
 * NO REGEX-LITERAL STATE, DELIBERATELY. A previous version tried to detect
 * regex literals by looking at the preceding character. It was worse than
 * nothing: `}` was in the operator set, so every JSX `<Foo prop={x} />`
 * parsed as a regex — 23 bogus spans across the files scanned then, which
 * included the JSX surfaces — while the
 * two commonest real positions (`=> /…/` and `return /…/`) were missed. The
 * heuristic is gone. `assertNoRegexLiterals` below turns the residual hazard
 * into a loud failure instead of a silent misparse.
 */
function scan(source) {
  const literals = [];
  const spans = [];
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
      code += source[i] ?? "";
      i += 1;
      const span = { at, end: code.length };
      spans.push(span);
      // Template literals are scanned so their contents cannot be read as
      // code, but are never offered as refusal messages — an interpolated
      // string could not be compared byte-for-byte anyway.
      if (quote !== "`") literals.push({ value, ...span });
      continue;
    }
    code += c;
    i += 1;
  }
  return { literals, code, spans };
}

/**
 * A regex literal would defeat `scan`, so its presence is a hard failure
 * rather than something to parse around.
 *
 * Conservative and one-directional: it only ever makes the suite RED. A false
 * positive costs someone a rewrite of one line into a `new RegExp(...)` or a
 * named constant; a false negative is a silent misparse, which is what this
 * exists to prevent. `/>` is excluded so JSX self-closing tags do not trip it.
 */
const REGEX_LITERAL = /(?:^|[=(,:[!&|?;{}]|=>|\breturn)\s*\/(?![/*>=])/m;

function assertNoRegexLiterals(rel) {
  const { code } = scan(readRepo(rel));
  assert.doesNotMatch(
    code,
    REGEX_LITERAL,
    `${rel} appears to contain a regex literal. This lock's scanner has no ` +
      `regex state — an earlier attempt at one misparsed JSX and missed real ` +
      `regexes — so a literal here would be scanned as code and could silently ` +
      `disable these assertions. Rewrite it as \`new RegExp(...)\`, or teach ` +
      `the scanner properly and test that branch by deleting it and watching ` +
      `this suite go red.`,
  );
}

/**
 * Advance `i` past the string span containing it.
 *
 * Spans are disjoint and produced in ascending order by a single forward
 * pass, so a linear probe is correct; `end` is one past the closing quote.
 */
function skipSpan(spans, i) {
  for (const span of spans) {
    if (i >= span.at && i < span.end) return span.end;
  }
  return i;
}

/** Every non-template string literal in a file, comments excluded. */
function stringLiterals(rel) {
  return scan(readRepo(rel)).literals.map((l) => l.value);
}

/** Source with comments removed, for the assertions over code. */
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
 * The body of a named member function, brace-matched, skipping strings.
 *
 * Pure so it can be tested against synthetic sources. The repo-reading
 * wrappers below are one line each; the logic that can be wrong lives here.
 */
function functionBodyIn(code, spans, signature) {
  const start = code.indexOf(signature);
  if (start === -1) return null;
  let depth = 0;
  let i = code.indexOf("{", start);
  const bodyStart = i;
  for (; i < code.length; i += 1) {
    const jumped = skipSpan(spans, i);
    if (jumped !== i) {
      i = jumped - 1;
      continue;
    }
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return { body: code.slice(bodyStart, i), at: bodyStart, end: i };
}

/**
 * Every message `enforceSubscription` throws, however it is worded.
 *
 * Counted from the body rather than by prefix: the prefix filter can only see
 * messages that already conform, so a fifth refusal worded "Your chapter
 * trial has ended…" left the count at 4 and the lock green.
 */
function guardRefusalThrows() {
  const { code, spans, literals } = scan(readRepo(GUARD));
  const found = functionBodyIn(code, spans, "private enforceSubscription(");
  assert.ok(found, `${GUARD} no longer declares enforceSubscription`);
  const inBody = literals
    .filter((l) => l.at >= found.at && l.at < found.end)
    .map((l) => l.value);
  return {
    throwCount: (found.body.match(/new ForbiddenException\(/g) ?? []).length,
    // A space separates a message from a `code`: codes are dotted identifiers
    // (`chapter.subscription.canceled`), messages are sentences.
    messages: inBody.filter(
      (v) => v.includes(" ") && v.toLowerCase().includes("subscription"),
    ),
  };
}

/**
 * The scanner's own tests.
 *
 * Every hazard here has been exploited against an earlier version of this
 * file. The first attempt at these tests asserted on `scan().code` and on
 * span existence, and was FAKE COVERAGE: deleting the entire regex branch, or
 * replacing `skipSpan`'s body with `return i`, left them all green. So these
 * drive the actual walker, `functionBodyIn`, against synthetic sources,
 * which is the only form that can fail.
 */
test("an apostrophe cannot truncate an extracted message", () => {
  // The `[^'"]*` regex cut here, so two DIFFERENT sentences both reduced to
  // "Chapter subscription isn" and compared equal — parity reported on drift.
  const { literals } = scan(
    `const a = "Chapter subscription isn't active; ask an officer.";`,
  );
  assert.deepEqual(literals.map((l) => l.value), [
    "Chapter subscription isn't active; ask an officer.",
  ]);
});

test("a quote style does not change the message that comes out", () => {
  const single = scan(`const a = 'it\\'s here';`).literals[0].value;
  const double = scan(`const a = "it's here";`).literals[0].value;
  assert.equal(single, double);
});

test("a brace inside a string cannot truncate a function body", () => {
  // PROVEN EXPLOIT: this made the refusal count compare 0 against 0 while a
  // new refusal went unknown to the mirror.
  // No space after the closing quote in `{code: "x"}` — with one, an
  // off-by-one in the span jump survives, because the skipped character is
  // only whitespace. This is ordinary object-literal style, so a plain
  // reformat of the guard would otherwise reach it.
  const src = `class G { private enforceSubscription() { const s = "a } here"; const m = {code: "x"}; throw new ForbiddenException({ message: 'Chapter subscription x' }); } private other() { const marker = "OUTSIDE"; } }`;
  const { code, spans } = scan(src);
  const found = functionBodyIn(code, spans, "private enforceSubscription(");
  assert.match(
    found.body,
    /ForbiddenException/,
    "the function body was truncated at a brace inside a string",
  );
  // And it must not OVER-run. `{code: "x"}` has no space after the closing
  // quote, so an off-by-one in the span jump swallows that `}` and the walk
  // runs past enforceSubscription's own closing brace into the next method —
  // counting throws and literals that are not its own.
  assert.doesNotMatch(
    found.body,
    /OUTSIDE/,
    "the function body over-ran into the following method",
  );
});

test("comments are removed, including ones carrying quotes and braces", () => {
  const { code, literals } = scan(`// don't read { this ; either\nconst x = 1;`);
  assert.doesNotMatch(code, /don/);
  assert.deepEqual(literals, []);
  assert.match(code, /const x = 1;/);
});

test("the scanned files contain no regex literal, which the scanner cannot read", () => {
  // The tripwire that replaced a regex-detection heuristic. The heuristic was
  // worse than nothing: `}` in its operator set made every JSX `{x} />` parse
  // as a regex (23 bogus spans across the JSX surfaces this used to scan) while missing `=> /…/` and
  // `return /…/`. Failing loudly beats misparsing silently.
  for (const rel of [GUARD, MIRROR, DETECTOR, STUDY_ERRORS]) {
    assertNoRegexLiterals(rel);
  }
  // And the tripwire itself must be able to fire.
  assert.match(`const isUrl = (s) => /^https?:x/.test(s);`, REGEX_LITERAL);
  assert.match(`return /abc/.test(x);`, REGEX_LITERAL);
  // …without firing on JSX or division, so a .tsx file can be scanned again
  // without tripping it.
  assert.doesNotMatch(`const row = <Icon name={n} />;`, REGEX_LITERAL);
  assert.doesNotMatch(`const ratio = total / count;`, REGEX_LITERAL);
  assert.doesNotMatch(`const ratio = f(a) / g(b);`, REGEX_LITERAL);
});

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
  // A non-zero floor. Without it, any misparse that empties the body makes
  // this compare 0 against 0 and the loop below iterate zero times — the
  // "a fifth refusal goes unnoticed" fail-open this function exists to stop,
  // reachable without renaming anything.
  assert.ok(
    throwCount >= REFUSAL_COUNT,
    `only ${throwCount} ForbiddenException(s) found in enforceSubscription; ` +
      `expected at least ${REFUSAL_COUNT}. The body scan is probably empty, ` +
      `which would make every assertion below pass vacuously.`,
  );
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
  // Reading `codeOf` first is fine since #1020 (#2995), but a detector keyed on
  // it alone meets an API that predates #1020, returns null, and reopens #2297.
  // The regex above only proves the message match is still present; the
  // code-less fixtures in apps/mobile/lib/subscription-refusal.spec.ts prove it
  // still runs when there is no code.
});

test("the study refusal branch sits above the arms that relay the server string", () => {
  const source = readCode((STUDY_ERRORS));
  // Ordering is load-bearing. Below the 403 arm the branch is dead, and the
  // 403 arm returns the server's own words — for an `incomplete` chapter
  // "…complete checkout to use this feature.", a purchase instruction the
  // store declaration forbids in this app.
  //
  // Both functions reach the gate through `permanentRefusalCopy` (#2393), the
  // one place that names the permanent refusals, so it must still ask the
  // subscription detector, and each function must ask it above its 403 arm.
  const dispatch = source.slice(
    source.indexOf("export function permanentRefusalCopy"),
    source.indexOf("export function isActiveSessionConflict"),
  );
  assert.ok(
    dispatch.includes("subscriptionRefusalOf(error)"),
    "permanentRefusalCopy no longer asks the subscription detector",
  );
  for (const fn of ["startErrorCopy", "sessionErrorCopy"]) {
    const body = source.slice(source.indexOf(`export function ${fn}`));
    const refusalAt = body.indexOf("permanentRefusalCopy(error");
    const relayAt = body.indexOf("case 403:");
    assert.ok(refusalAt !== -1, `${fn} lost its subscription-refusal branch`);
    assert.ok(relayAt !== -1, `${fn} lost its 403 arm — this lock needs updating`);
    assert.ok(
      refusalAt < relayAt,
      `${fn} checks the refusal after its 403 arm, which makes the branch dead`,
    );
  }
});
