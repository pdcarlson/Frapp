import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
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
const liveResponse = ({ contexts = ALL_REQUIRED_CHECKS, forkSyncing = true } = {}) => ({
  url: "https://api.github.com/repos/o/r/branches/main/protection",
  required_status_checks: { strict: true, contexts: [...contexts] },
  required_signatures: { enabled: false },
  enforce_admins: { enabled: true },
  required_linear_history: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  block_creations: { enabled: false },
  required_conversation_resolution: { enabled: false },
  lock_branch: { enabled: false },
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
    const fromPut = normalizeProtection(buildProtectionPayload("main"));
    const fromGet = normalizeProtection(liveResponse());
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
    // The live drift this found on its first real run against `main`.
    const diff = diffProtection({
      current: liveResponse({ forkSyncing: false }),
      desired: buildProtectionPayload("main"),
    });
    assert.deepEqual(diff.changes, [
      { field: "allow_fork_syncing", from: false, to: true },
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

  it("the writer does not re-export the rosters, so no second import path can appear", () => {
    // A pass-through export would quietly restore the old coupling for any
    // future caller, which is the drift this test exists to prevent.
    const src = read("../../configure-branch-protection.mjs");
    assert.doesNotMatch(src, /export \{[^}]*ALL_REQUIRED_CHECKS/s);
  });

  it("the doc-table gate parses the rosters from their new home", () => {
    // `check-doc-tables.mjs` reads the arrays as SOURCE TEXT, so moving them
    // without moving its pointer silently breaks the docs gate.
    const src = read("../../check-doc-tables.mjs");
    assert.match(src, /const SCRIPT_SRC = "scripts\/ci\/lib\/required-checks\.mjs";/);
  });

  it("the data module stays free of side effects and entry points", () => {
    // The whole reason the deploy path can import it safely.
    const src = read("../lib/required-checks.mjs");
    assert.doesNotMatch(src, /process\.argv/);
    assert.doesNotMatch(src, /\bfetch\(/);
    assert.doesNotMatch(src, /function main\b/);
  });
});
