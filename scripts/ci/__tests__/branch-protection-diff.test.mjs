import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertKnownArgs,
  assertRosterFloor,
  buildProtectionPayload,
  diffProtection,
  formatProtectionDiff,
  hasProtectionDrift,
  normalizeProtection,
} from "../../configure-branch-protection.mjs";
import { ALL_REQUIRED_CHECKS } from "../lib/required-checks.mjs";

// Before #1383 `configure-branch-protection.mjs` had exactly one API call and
// exactly one method — PUT — so it could report only what it INTENDED to write.
// These cover the read-back that replaced the checkmark. The network call itself
// is deliberately untested here and untestable from a sandbox: `api.github.com`
// is reachable in some sessions and 403s through the proxy in others (#680's
// evidence table records both on the same day). Everything below is a pure
// function over a plain object for that reason.

// The real GET shape, trimmed. Note every boolean arrives WRAPPED as
// `{enabled}`, which the PUT payload does not do — that asymmetry is the trap
// `normalizeProtection` exists to absorb.
//
// `forkSyncing` defaults to FALSE because that is what `main` actually returns.
// It defaulted to `true` in the first version of this suite — matching the
// payload rather than reality — which made the happy-path test assert a state
// live protection does not hold, and hid a bug that would have made every
// `--verify` run exit 1. A fixture that models the payload instead of the
// server is not a fixture, it is the assumption under test.
const liveResponse = ({
  contexts = ALL_REQUIRED_CHECKS,
  forkSyncing = false,
  lockBranch = false,
} = {}) => ({
  url: "https://api.github.com/repos/o/r/branches/main/protection",
  required_status_checks: { strict: true, contexts: [...contexts] },
  required_signatures: { enabled: false },
  enforce_admins: { enabled: true },
  required_linear_history: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  block_creations: { enabled: false },
  required_conversation_resolution: { enabled: false },
  lock_branch: { enabled: lockBranch },
  allow_fork_syncing: { enabled: forkSyncing },
});

describe("normalizeProtection", () => {
  it("flattens the GET's {enabled} wrappers to plain booleans", () => {
    const normalized = normalizeProtection(liveResponse());
    assert.equal(normalized.enforce_admins, true);
    assert.equal(normalized.allow_force_pushes, false);
    assert.equal(normalized.required_linear_history, true);
  });

  it("reads the PUT payload shape identically, so both sides compare like-for-like", () => {
    // Every field but the one GitHub declines to persist on an unlocked branch.
    const fromPut = normalizeProtection(buildProtectionPayload("main"));
    const fromGet = normalizeProtection(liveResponse({ forkSyncing: true }));
    assert.deepEqual(fromPut, fromGet);
  });

  it("derives contexts from the newer `checks` array when `contexts` is empty", () => {
    const normalized = normalizeProtection({
      required_status_checks: {
        strict: true,
        contexts: [],
        checks: [{ context: "api-tests", app_id: 1 }, { context: "web-tests", app_id: 1 }],
      },
    });
    assert.deepEqual(normalized.required_status_checks.contexts, ["api-tests", "web-tests"]);
  });

  it("returns null for an unprotected branch rather than an all-false object", () => {
    // The 404 case. Distinguishing it from "protected, everything off" is what
    // lets the diff say "no protection rule at all" instead of listing 9 flags.
    assert.equal(normalizeProtection(null), null);
    assert.equal(normalizeProtection(undefined), null);
  });
});

describe("diffProtection", () => {
  it("reports no drift when live already matches the roster", () => {
    const diff = diffProtection({
      current: liveResponse(),
      desired: buildProtectionPayload("main"),
    });
    assert.equal(hasProtectionDrift(diff), false);
    assert.deepEqual(formatProtectionDiff(diff), []);
  });

  it("names an added required check rather than diffing the whole array", () => {
    const withoutOne = ALL_REQUIRED_CHECKS.filter((c) => c !== "migration-order");
    const diff = diffProtection({
      current: liveResponse({ contexts: withoutOne }),
      desired: buildProtectionPayload("main"),
    });
    assert.deepEqual(diff.contextsAdded, ["migration-order"]);
    assert.deepEqual(diff.contextsRemoved, []);
    assert.ok(formatProtectionDiff(diff).some((l) => l.includes("+ required check   migration-order")));
  });

  it("names a check that is live but no longer in the roster", () => {
    // The `migration-drift` demotion (ADR-20 decision 5) is exactly this shape:
    // still required on GitHub, deliberately gone from the roster.
    const diff = diffProtection({
      current: liveResponse({ contexts: [...ALL_REQUIRED_CHECKS, "migration-drift"] }),
      desired: buildProtectionPayload("main"),
    });
    assert.deepEqual(diff.contextsRemoved, ["migration-drift"]);
    assert.deepEqual(diff.contextsAdded, []);
  });

  it("catches a flag difference, and does not mistake it for a missing field", () => {
    const current = { ...liveResponse(), required_linear_history: { enabled: false } };
    const diff = diffProtection({ current, desired: buildProtectionPayload("main") });
    assert.deepEqual(diff.changes, [
      { field: "required_linear_history", from: false, to: true },
    ]);
    assert.equal(hasProtectionDrift(diff), true);
  });

  it("treats an unprotected branch as a create, listing every context as added", () => {
    const diff = diffProtection({ current: null, desired: buildProtectionPayload("main") });
    assert.equal(diff.unprotected, true);
    assert.equal(diff.contextsAdded.length, ALL_REQUIRED_CHECKS.length);
    assert.ok(formatProtectionDiff(diff)[0].includes("NO protection rule"));
  });

  it("flags a required review someone added out of band", () => {
    // This repo writes `required_pull_request_reviews: null` on purpose (#1340 —
    // the human gate is the production deploy approval, not the merge). Someone
    // adding one in the UI is a governance change worth surfacing.
    const current = { ...liveResponse(), required_pull_request_reviews: { required_approving_review_count: 1 } };
    const diff = diffProtection({ current, desired: buildProtectionPayload("main") });
    assert.deepEqual(diff.changes, [
      { field: "required_pull_request_reviews", from: true, to: false },
    ]);
  });

  it("ignores fields this repo does not manage", () => {
    // `required_signatures` comes back on every GET and is not in the payload.
    // Diffing it would make every run report permanent drift.
    const diff = diffProtection({
      current: { ...liveResponse(), required_signatures: { enabled: true } },
      desired: buildProtectionPayload("main"),
    });
    assert.equal(hasProtectionDrift(diff), false);
  });
});

describe("one roster, two consumers (#1383 scope item 1)", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

  it("the deploy gate imports the roster from the data module, not from the writer", () => {
    // The coupling this issue removed: `validate-deploy-sha.mjs` runs on every
    // production deploy, and used to import a module whose import once PUT live
    // branch protection (#840).
    const src = read("../validate-deploy-sha.mjs");
    assert.match(src, /import \{ ALL_REQUIRED_CHECKS \} from "\.\/lib\/required-checks\.mjs";/);
    assert.doesNotMatch(src, /from "\.\.\/configure-branch-protection\.mjs"/);
  });

  it("the writer does not re-export the rosters, by any spelling", () => {
    // A pass-through export quietly restores the old coupling for any future
    // caller. Matching only the named-export block missed the shape that would
    // restore it most completely — `export *` re-exports all four rosters and
    // would have sailed past the first version of this assertion.
    const src = read("../../configure-branch-protection.mjs");
    assert.doesNotMatch(src, /export \{[^}]*ALL_REQUIRED_CHECKS/s);
    assert.doesNotMatch(src, /export \s*\*\s*from\s*["'][^"']*required-checks\.mjs["']/);
    assert.doesNotMatch(src, /export \{[^}]*\b(CI_CHECKS|DOCS_CHECKS|DRIFT_CHECKS)\b/s);
  });

  it("the writer imports only the roster it actually uses", () => {
    // Dead bindings for CI_CHECKS/DOCS_CHECKS/DRIFT_CHECKS put three names back
    // on this module's surface and make a grep for them here return hits, which
    // is the ambiguity the split removed. `scripts/` is not a workspace, so
    // `turbo run lint` never sees this file and nothing else would catch it.
    const src = read("../../configure-branch-protection.mjs");
    const importLine = src.match(/import \{[^}]*\} from "\.\/ci\/lib\/required-checks\.mjs";/s);
    assert.ok(importLine, "expected an import from the roster module");
    assert.doesNotMatch(importLine[0], /\b(CI_CHECKS|DOCS_CHECKS|DRIFT_CHECKS)\b/);
  });

  it("the data module stays free of side effects and entry points", () => {
    // The whole reason the deploy path can import it safely. Asserted by
    // IMPORTING it and watching, rather than by grepping for three spellings of
    // trouble — a module-scope console.log, a process.env write and a top-level
    // `await main()` all passed the grep version of this test.
    const src = read("../lib/required-checks.mjs");
    assert.doesNotMatch(src, /process\.argv/);
    assert.doesNotMatch(src, /\bfetch\(/);
    assert.doesNotMatch(src, /function main\b/);
    assert.doesNotMatch(src, /^\s*(await|console\.|process\.env\s*\[|execSync)/m);
  });
});

describe("allow_fork_syncing is only compared where it means something", () => {
  // Regression tests for the bug that would have made `--verify` exit non-zero
  // on a correctly-configured repo forever. GitHub only honours fork-syncing on
  // a LOCKED branch; this payload sends `allow_fork_syncing: true` alongside
  // `lock_branch: false`, and live has reported `false` since 2026-08-27
  // through at least one intervening apply. Comparing it on an unlocked branch
  // produces drift no run can resolve.

  it("ignores the flag on an unlocked branch, where GitHub will not persist it", () => {
    const diff = diffProtection({
      current: liveResponse({ forkSyncing: false }), // what `main` really returns
      desired: buildProtectionPayload("main"), // which asks for true
    });
    assert.equal(
      hasProtectionDrift(diff),
      false,
      "an unlocked branch must not report permanent, unresolvable fork-syncing drift",
    );
  });

  it("compares it again as soon as the branch is locked", () => {
    // The exemption is scoped to the case where the field is inert. If
    // lock_branch is ever set, this is a real setting again and must be diffed.
    const diff = diffProtection({
      current: liveResponse({ forkSyncing: false, lockBranch: true }),
      desired: { ...buildProtectionPayload("main"), lock_branch: true },
    });
    assert.ok(
      diff.changes.some((c) => c.field === "allow_fork_syncing"),
      "a locked branch must still diff fork-syncing",
    );
  });

  it("still reports lock_branch itself changing", () => {
    const diff = diffProtection({
      current: liveResponse({ lockBranch: true }),
      desired: buildProtectionPayload("main"),
    });
    assert.ok(diff.changes.some((c) => c.field === "lock_branch"));
  });
});

describe("assertRosterFloor", () => {
  // The writer is the half that can destroy the gates. validate-deploy-sha.mjs
  // has this floor on the reading side; without it here, one bad edit PUTs
  // `contexts: []` and every required check on `main` disappears, printed as an
  // ordinary run of `- required check` lines.
  it("refuses an empty roster", () => {
    assert.throws(() => assertRosterFloor([]), /Refusing to apply/);
  });

  it("refuses a non-array, which is what a failed import looks like", () => {
    assert.throws(() => assertRosterFloor(undefined), /Refusing to apply/);
    assert.throws(() => assertRosterFloor(null), /Refusing to apply/);
  });

  it("accepts the real roster", () => {
    assert.doesNotThrow(() => assertRosterFloor(ALL_REQUIRED_CHECKS));
  });
});

describe("malformed input does not throw out of an exported function", () => {
  // These are exported, independently callable entry points. Guarding `current`
  // but not `desired`, and `!diff` but not a diff-shaped object missing a key,
  // left several shapes throwing TypeError instead of answering.
  it("diffProtection tolerates every non-object `current`", () => {
    for (const current of [null, undefined, "", false, 0, "nonsense"]) {
      const diff = diffProtection({ current, desired: buildProtectionPayload("main") });
      assert.equal(diff.unprotected, true, `failed for ${JSON.stringify(current)}`);
    }
  });

  it("diffProtection tolerates a missing `desired`", () => {
    const diff = diffProtection({ current: liveResponse(), desired: undefined });
    assert.equal(diff.unprotected, false);
    assert.equal(diff.contextsRemoved.length, ALL_REQUIRED_CHECKS.length);
  });

  it("hasProtectionDrift tolerates a diff-shaped object missing keys", () => {
    assert.equal(hasProtectionDrift({}), false);
    assert.equal(hasProtectionDrift(null), false);
    assert.equal(hasProtectionDrift(undefined), false);
    assert.equal(hasProtectionDrift({ contextsRemoved: ["x"] }), true);
  });

  it("formatProtectionDiff renders removals and flag changes, not just additions", () => {
    const lines = formatProtectionDiff({
      unprotected: false,
      changes: [{ field: "enforce_admins", from: true, to: false }],
      contextsAdded: ["added-check"],
      contextsRemoved: ["removed-check"],
    });
    assert.ok(lines.some((l) => l.includes("+ required check   added-check")));
    assert.ok(lines.some((l) => l.includes("- required check   removed-check")));
    assert.ok(lines.some((l) => l.includes("~ enforce_admins: true -> false")));
  });
});

describe("normalizeProtection edge cases", () => {
  it("drops non-string context entries rather than emitting undefined", () => {
    const normalized = normalizeProtection({
      required_status_checks: { strict: true, contexts: [], checks: [{ app_id: 1 }, { context: "" }] },
    });
    assert.deepEqual(normalized.required_status_checks.contexts, []);
  });

  it("reports required_status_checks absent as null, not an empty object", () => {
    const normalized = normalizeProtection({ enforce_admins: { enabled: true } });
    assert.equal(normalized.required_status_checks, null);
  });

  it("normalizes `restrictions` to a boolean", () => {
    assert.equal(normalizeProtection(liveResponse()).restrictions, false);
    assert.equal(
      normalizeProtection({ ...liveResponse(), restrictions: { users: [] } }).restrictions,
      true,
    );
  });
});

describe("assertKnownArgs", () => {
  // A read-only flag that fails open to a write is the wrong direction to fail.
  // hasFlag is exact-match, so any spelling it does not recognise reads as
  // absent - and absent for --verify/--dry-run means LIVE, i.e. a governance PUT.
  it("refuses the `=` form of a documented flag rather than applying", () => {
    assert.throws(() => assertKnownArgs(["--verify=true"]), /Unrecognised argument/);
    assert.throws(() => assertKnownArgs(["--repo=o/r"]), /Unrecognised argument/);
  });

  it("refuses misspellings rather than applying", () => {
    for (const arg of ["--verfiy", "--dryrun", "--check", "--dry_run"]) {
      assert.throws(() => assertKnownArgs([arg]), /Unrecognised argument/, `missed ${arg}`);
    }
  });

  it("accepts the real flag set, and does not mistake an option value for a flag", () => {
    assert.doesNotThrow(() => assertKnownArgs([]));
    assert.doesNotThrow(() => assertKnownArgs(["--verify"]));
    assert.doesNotThrow(() => assertKnownArgs(["--dry-run", "--repo", "owner/repo"]));
    assert.doesNotThrow(() => assertKnownArgs(["--token-env", "GH_PAT", "--verify"]));
  });

  it("names every offending argument, so one typo does not hide another", () => {
    assert.throws(
      () => assertKnownArgs(["--verfiy", "--nope"]),
      /--verfiy, --nope/,
    );
  });
});
