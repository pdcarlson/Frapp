import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkAncestry,
  classifyRequiredChecks,
  describeCheckFailure,
  CANCELLED_CONCLUSIONS,
  isFullSha,
  jobIdsAtRef,
  validateDeploySha,
} from "../validate-deploy-sha.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const quiet = { log: () => {} };

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

/** A `git` double that records argv and fails for the listed subcommands. */
function makeGit({ failOn = [] } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (failOn.some((needle) => args.join(" ").includes(needle))) {
      throw new Error(`git ${args.join(" ")} exited 1`);
    }
    return "";
  };
  return { git, calls };
}

describe("isFullSha", () => {
  it("accepts a 40-char lowercase hex SHA", () => assert.equal(isFullSha(SHA), true));

  // Abbreviated SHAs resolve fine in git and are useless afterwards: they
  // cannot be matched against a Render commitId or a Vercel githubCommitSha.
  it("rejects an abbreviated SHA", () => assert.equal(isFullSha("afc8193"), false));
  it("rejects uppercase hex", () => assert.equal(isFullSha(SHA.toUpperCase()), false));
  it("rejects a branch name", () => assert.equal(isFullSha("main"), false));

  // These never reach `git` — which is what makes passing the value through an
  // argument array safe by construction rather than by hygiene alone.
  it("rejects a command-injection attempt", () =>
    assert.equal(isFullSha("main; rm -rf /"), false));
  it("rejects a path-traversal attempt", () =>
    assert.equal(isFullSha("../../etc/passwd"), false));
  it("rejects undefined", () => assert.equal(isFullSha(undefined), false));
});

describe("checkAncestry", () => {
  it("passes for a commit on main", () => {
    const { git, calls } = makeGit();
    assert.equal(checkAncestry({ sha: SHA, git }).ok, true);
    assert.deepEqual(calls[1], ["merge-base", "--is-ancestor", SHA, "origin/main"]);
  });

  it("rejects a well-formed SHA that is not a commit here", () => {
    const { git } = makeGit({ failOn: ["cat-file"] });
    const result = checkAncestry({ sha: SHA, git });
    assert.equal(result.ok, false);
    assert.match(result.reason, /not a commit in this repository/);
  });

  it("rejects a commit on an unmerged feature branch", () => {
    // This is the direct replacement for ci.yml's `branch-policy` job, which
    // enforced that a PR into `production` came from `main`.
    const { git } = makeGit({ failOn: ["merge-base"] });
    const result = checkAncestry({ sha: SHA, git });
    assert.equal(result.ok, false);
    assert.match(result.reason, /not an ancestor of origin\/main/);
  });
});

describe("classifyRequiredChecks", () => {
  const required = ["ci-a", "ci-b"];

  it("passes when every required check succeeded", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [
        { name: "ci-a", status: "completed", conclusion: "success" },
        { name: "ci-b", status: "completed", conclusion: "success" },
      ],
      required,
    });
    assert.equal(verdict.ok, true);
  });

  it("accepts skipped and neutral, which satisfy a required check on GitHub", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [
        { name: "ci-a", status: "completed", conclusion: "skipped" },
        { name: "ci-b", status: "completed", conclusion: "neutral" },
      ],
      required,
    });
    assert.equal(verdict.ok, true);
  });

  it("rejects a failure", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [
        { name: "ci-a", status: "completed", conclusion: "failure" },
        { name: "ci-b", status: "completed", conclusion: "success" },
      ],
      required,
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.failing, ["ci-a (failure)"]);
  });

  // "Has not failed" is not "has passed". A queued check is a check that has
  // asserted nothing yet.
  it("rejects a check that is still running", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [
        { name: "ci-a", status: "in_progress", conclusion: null },
        { name: "ci-b", status: "completed", conclusion: "success" },
      ],
      required,
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.pending, ["ci-a (in_progress)"]);
  });

  // The shape of every false-green this repo has fixed: the workflow was
  // filtered out, nothing reported, and the absence read as silence.
  it("rejects a required check that never reported at all", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [{ name: "ci-b", status: "completed", conclusion: "success" }],
      required,
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.missing, ["ci-a"]);
  });

  it("takes the LATEST run of a re-run name, so a red re-run is not masked", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [
        { name: "ci-a", status: "completed", conclusion: "success", started_at: "2026-08-28T10:00:00Z" },
        { name: "ci-a", status: "completed", conclusion: "failure", started_at: "2026-08-28T11:00:00Z" },
        { name: "ci-b", status: "completed", conclusion: "success" },
      ],
      required,
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.failing, ["ci-a (failure)"]);
  });

  it("ignores unrelated check runs", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [
        { name: "ci-a", status: "completed", conclusion: "success" },
        { name: "ci-b", status: "completed", conclusion: "success" },
        { name: "some-advisory-job", status: "completed", conclusion: "failure" },
      ],
      required,
    });
    assert.equal(verdict.ok, true);
  });
});

describe("describeCheckFailure", () => {
  it("is null when nothing is wrong", () =>
    assert.equal(describeCheckFailure({ missing: [], pending: [], failing: [] }), null));

  it("names all three categories", () => {
    const message = describeCheckFailure({ missing: ["m"], pending: ["p"], failing: ["f"] });
    assert.match(message, /failed: f/);
    assert.match(message, /still running: p/);
    assert.match(message, /never reported: m/);
  });
});

describe("validateDeploySha", () => {
  const required = ["ci-a"];

  it("passes a merged, CI-green commit", async () => {
    const { git } = makeGit();
    const result = await validateDeploySha({
      sha: SHA, repo: "o/r", token: "t", required, git, logger: quiet,
      fetchImpl: async () => okJson({ check_runs: [{ name: "ci-a", status: "completed", conclusion: "success" }] }),
    });
    assert.equal(result.ok, true);
  });

  it("rejects before touching git when the SHA is malformed", async () => {
    const { git, calls } = makeGit();
    const result = await validateDeploySha({
      sha: "not-a-sha", repo: "o/r", token: "t", required, git, logger: quiet,
      fetchImpl: async () => { throw new Error("must not be called"); },
    });
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });

  it("rejects a merged commit whose CI is red", async () => {
    const { git } = makeGit();
    const result = await validateDeploySha({
      sha: SHA, repo: "o/r", token: "t", required, git, logger: quiet,
      fetchImpl: async () => okJson({ check_runs: [{ name: "ci-a", status: "completed", conclusion: "failure" }] }),
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /CI is not green/);
  });

  // Unknown is not safe. `check-migration-drift.mjs` takes the same position
  // about an unreachable database, for the same reason.
  it("rejects when the checks API cannot be read", async () => {
    const { git } = makeGit();
    const result = await validateDeploySha({
      sha: SHA, repo: "o/r", token: "t", required, git, logger: quiet,
      fetchImpl: async () => ({ ok: false, status: 500 }),
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Could not read CI status/);
  });

  it("does not call the checks API when ancestry already failed", async () => {
    const { git } = makeGit({ failOn: ["merge-base"] });
    let fetched = false;
    const result = await validateDeploySha({
      sha: SHA, repo: "o/r", token: "t", required, git, logger: quiet,
      fetchImpl: async () => { fetched = true; return okJson({ check_runs: [] }); },
    });
    assert.equal(result.ok, false);
    assert.equal(fetched, false);
  });
});

// ── The deployable window ───────────────────────────────────────────────────
// `ALL_REQUIRED_CHECKS` is today's list, asked of a commit from any point in
// the past. A check run cannot exist on a commit whose tree never defined the
// job that emits it, so every check ADDED to that array used to make every
// older commit undeployable with "never reported: <new-check>".
//
// Measured, not hypothesised: at `971d7d5` — the commit production's API was
// running when this was written — `.github/workflows/` defines 50 job ids and
// `web-production-build` is not among them. #1374 added that check, so rolling
// production back to the commit it was already running had become impossible.
// The recovery `DB_ROLLBACK_PLAYBOOK.md` prescribes is "redeploy the API at the
// pre-<X> revision", which is exactly this operation.

describe("classifyRequiredChecks — checks the commit could not have produced", () => {
  const runs = [{ name: "api-tests", status: "completed", conclusion: "success" }];

  it("treats a check the commit's workflows never defined as not applicable", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: runs,
      required: ["api-tests", "web-production-build"],
      defined: new Set(["api-tests"]),
    });
    assert.deepEqual(verdict.missing, []);
    assert.deepEqual(verdict.notApplicable, ["web-production-build"]);
    assert.equal(verdict.ok, true);
  });

  it("still fails a check the commit DID define and never reported", () => {
    // The half that must not soften. A defined job that produced no run is the
    // silent-skip hole this gate exists for.
    const verdict = classifyRequiredChecks({
      checkRuns: runs,
      required: ["api-tests", "secret-scan"],
      defined: new Set(["api-tests", "secret-scan"]),
    });
    assert.deepEqual(verdict.missing, ["secret-scan"]);
    assert.equal(verdict.ok, false);
  });

  it("still fails a check that ran and failed, defined or not", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [{ name: "api-tests", status: "completed", conclusion: "failure" }],
      required: ["api-tests"],
      defined: new Set(),
    });
    assert.deepEqual(verdict.failing, ["api-tests (failure)"]);
    assert.deepEqual(verdict.notApplicable, []);
    assert.equal(verdict.ok, false);
  });

  it("narrows nothing when `defined` is null", () => {
    // Null is the conservative answer — "could not read the tree", not "no jobs
    // exist". An empty Set would excuse the entire required list.
    const verdict = classifyRequiredChecks({
      checkRuns: runs,
      required: ["api-tests", "secret-scan"],
      defined: null,
    });
    assert.deepEqual(verdict.missing, ["secret-scan"]);
    assert.equal(verdict.ok, false);
  });
});

describe("jobIdsAtRef", () => {
  it("reads real job ids out of the tree at a ref", () => {
    const ids = jobIdsAtRef({ ref: "HEAD" });
    assert.ok(ids instanceof Set);
    // Present in ci.yml on every commit this repo has had for months.
    assert.ok(ids.has("api-tests"), "expected api-tests among HEAD's job ids");
    assert.ok(ids.has("lint-and-typecheck"));
  });

  it("returns null — never an empty Set — for an unreadable ref", () => {
    // An empty Set would mark every required check not-applicable and pass a
    // deploy having asserted nothing.
    assert.equal(jobIdsAtRef({ ref: "refs/heads/definitely-not-a-branch" }), null);
    assert.equal(
      jobIdsAtRef({
        ref: "HEAD",
        git: () => {
          throw new Error("git exploded");
        },
      }),
      null,
    );
  });

  it("returns null when the ref has workflow files it cannot read", () => {
    let call = 0;
    const git = (args) => {
      call += 1;
      if (args[0] === "ls-tree") return ".github/workflows/ci.yml\n";
      throw new Error("unreadable blob");
    };
    assert.equal(jobIdsAtRef({ ref: "HEAD", git }), null);
    assert.ok(call >= 2);
  });
});

describe("classifyRequiredChecks — the narrowing must not excuse everything", () => {
  it("refuses when NOT ONE required check could be matched", () => {
    // The narrowing exists so an older commit stays deployable. Taken to its
    // limit it says "none of these 21 checks applies", which is not an old
    // commit — it is an unreadable tree or a roster matching nothing. Returning
    // ok:true there deploys to production with no CI evidence at all, which is
    // worse than the refusal the narrowing was softening.
    const verdict = classifyRequiredChecks({
      checkRuns: [],
      required: ["api-tests", "secret-scan", "web-tests"],
      defined: new Set(["some-unrelated-job"]),
      currentlyDefined: new Set(["api-tests", "secret-scan", "web-tests"]),
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.exhausted, true);
    assert.deepEqual(verdict.notApplicable, []);
    assert.deepEqual(verdict.missing.sort(), ["api-tests", "secret-scan", "web-tests"]);
  });

  it("a roster entry no ref defines is missing, not excused", () => {
    // A job renamed in the workflows without updating ALL_REQUIRED_CHECKS, or a
    // stale roster entry. Excusing it silently drops a gate and mislabels the
    // drop as "this commit predates them".
    const verdict = classifyRequiredChecks({
      checkRuns: [{ name: "api-tests", status: "completed", conclusion: "success" }],
      required: ["api-tests", "renamed-away"],
      defined: new Set(["api-tests"]),
      currentlyDefined: new Set(["api-tests"]),
    });
    assert.deepEqual(verdict.missing, ["renamed-away"]);
    assert.deepEqual(verdict.notApplicable, []);
    assert.equal(verdict.ok, false);
  });

  it("excuses only a check that exists NOW and did not exist THEN", () => {
    const verdict = classifyRequiredChecks({
      checkRuns: [{ name: "api-tests", status: "completed", conclusion: "success" }],
      required: ["api-tests", "web-production-build"],
      defined: new Set(["api-tests"]),
      currentlyDefined: new Set(["api-tests", "web-production-build"]),
    });
    assert.deepEqual(verdict.notApplicable, ["web-production-build"]);
    assert.equal(verdict.ok, true);
  });

  it("end to end: a no-CI-evidence commit is refused, with a reason that says why", async () => {
    const result = await validateDeploySha({
      sha: "a".repeat(40),
      repo: "o/r",
      token: "t",
      required: ["api-tests", "secret-scan"],
      // Ref-aware: the trusted ref defines both checks, the deployed commit
      // defines neither — a total workflow restructure. That is the shape the
      // floor exists for; a roster naming jobs NEITHER ref defines is the
      // separate stale-roster case asserted above.
      git: (args) => {
        if (args[0] === "cat-file" || args[0] === "merge-base") return "";
        if (args[0] === "ls-tree") return ".github/workflows/ci.yml\n";
        const ref = args[1] ?? "";
        return ref.startsWith("origin/main")
          ? "  api-tests:\n  secret-scan:\n"
          : "  unrelated-job:\n";
      },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ check_runs: [] }) }),
      logger: { log: () => {} },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /no CI evidence at all/);
  });
});


describe("classifyRequiredChecks — a cancelled check is not a failed one", () => {
  it("refuses a cancelled check, but reports it apart from a failure", () => {
    // How this happens: ci.yml, docs.yml and migration-drift-gate.yml all key
    // concurrency on `github.ref`, which is `refs/heads/main` for EVERY push to
    // main. Two merges minutes apart put both push runs in one group, so the
    // first commit's run is cancelled by the second's. Nothing re-runs it, and
    // the commit becomes permanently undeployable — the same class as the
    // deployable-window bug above, through a different door, landing on the
    // same operation (rollback = redeploy an older commit).
    const verdict = classifyRequiredChecks({
      checkRuns: [
        { name: "api-tests", status: "completed", conclusion: "success" },
        { name: "migration-order", status: "completed", conclusion: "cancelled" },
      ],
      required: ["api-tests", "migration-order"],
    });
    assert.equal(verdict.ok, false, "a cancelled check asserted nothing and must not pass");
    assert.deepEqual(verdict.failing, [], "must not be reported as a test failure");
    assert.deepEqual(verdict.cancelled, ["migration-order (cancelled)"]);
  });

  it("names the remedy, which is a re-run and not a code change", () => {
    const text = describeCheckFailure({
      missing: [],
      pending: [],
      failing: [],
      cancelled: ["migration-order (cancelled)"],
    });
    assert.match(text, /cancelled/);
    assert.match(text, /re-run the workflow run for this commit/);
    assert.doesNotMatch(text, /failed:/);
  });

  it("timed_out and stale are the same shape as cancelled", () => {
    assert.ok(CANCELLED_CONCLUSIONS.has("cancelled"));
    assert.ok(CANCELLED_CONCLUSIONS.has("timed_out"));
    assert.ok(CANCELLED_CONCLUSIONS.has("stale"));
    // And a real failure is still a real failure.
    assert.ok(!CANCELLED_CONCLUSIONS.has("failure"));
    const verdict = classifyRequiredChecks({
      checkRuns: [{ name: "api-tests", status: "completed", conclusion: "failure" }],
      required: ["api-tests"],
    });
    assert.deepEqual(verdict.failing, ["api-tests (failure)"]);
    assert.deepEqual(verdict.cancelled, []);
  });
});
