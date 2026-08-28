import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkAncestry,
  classifyRequiredChecks,
  describeCheckFailure,
  isFullSha,
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
