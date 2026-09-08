import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyBump,
  fetchPrLabels,
  highestBump,
  prNumberFromSubject,
  prNumbersFromSubjects,
  resolveReleaseBump,
} from "../resolve-release-bump.mjs";

const quiet = { log: () => {} };

// `fetchPrLabels` now goes through `ghRequest`, which reads `.text()` and
// JSON-parses it — not `.json()`. Test doubles must be `.text()`-shaped.
function okJson(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

function notFound() {
  return { ok: false, status: 404, text: async () => "" };
}

function githubFetch(routes) {
  return async (url) => {
    const path = new URL(url).pathname;
    const response = routes[path];
    if (!response) throw new Error(`unexpected fetch: ${url}`);
    return response;
  };
}

describe("prNumberFromSubject", () => {
  it("reads a merge-commit subject", () =>
    assert.equal(
      prNumberFromSubject("Merge pull request #1337 from pdcarlson/claude/next-steps-7s3mz5"),
      1337,
    ));

  it("reads a squash subject", () =>
    assert.equal(
      prNumberFromSubject("Exempt URGENT from the notification category gate (#1325)"),
      1325,
    ));

  // The bug this function exists to prevent. The old extraction was
  // `grep -oP '#\K[0-9]+' | head -1` over the WHOLE message, and squashed
  // bodies reference issues long before they reference their own PR — so it
  // would fetch issue #1293's labels and call them the release label.
  it("ignores issue references in the body and reads only the subject", () => {
    const commit = [
      "Exempt URGENT from the notification category gate (#1325)",
      "",
      "This is the failure #1293 documents: #460 presupposes an AI request path",
      "that does not exist. See also #643 and #1330.",
    ].join("\n");
    assert.equal(prNumberFromSubject(commit), 1325);
  });

  it("ignores an issue reference that leads a merge-commit body", () => {
    const commit = ["Merge pull request #1337 from pdcarlson/x", "", "Fixes #1", ""].join("\n");
    assert.equal(prNumberFromSubject(commit), 1337);
  });

  it("returns null for a subject naming no PR", () =>
    assert.equal(prNumberFromSubject("chore(git): record production's ancestry"), null));

  it("does not read a mid-subject issue reference as a PR", () =>
    assert.equal(prNumberFromSubject("Fix the #1293 regression in chat"), null));

  it("returns null for a non-string", () => assert.equal(prNumberFromSubject(null), null));
});

describe("prNumbersFromSubjects", () => {
  it("dedupes and preserves order", () => {
    assert.deepEqual(
      prNumbersFromSubjects([
        "Merge pull request #10 from x",
        "thing (#11)",
        "Merge pull request #10 from x",
        "no pr here",
      ]),
      [10, 11],
    );
  });
});

describe("highestBump", () => {
  it("defaults to patch with no release labels", () =>
    assert.equal(highestBump([["area:db"], []]), "patch"));
  it("takes minor over patch", () =>
    assert.equal(highestBump([["release:patch"], ["release:minor"]]), "minor"));
  it("takes major over minor regardless of order", () =>
    assert.equal(highestBump([["release:major"], ["release:minor"]]), "major"));
  it("takes major over minor when minor comes first", () =>
    assert.equal(highestBump([["release:minor"], ["release:major"]]), "major"));
  it("tolerates a non-array", () => assert.equal(highestBump([null]), "patch"));
});

describe("applyBump", () => {
  it("patches", () => assert.equal(applyBump("1.2.3", "patch"), "1.2.4"));
  it("minors and zeroes patch", () => assert.equal(applyBump("1.2.3", "minor"), "1.3.0"));
  it("majors and zeroes the rest", () => assert.equal(applyBump("1.2.3", "major"), "2.0.0"));
  it("starts from 0.0.0 when there is no prior tag", () =>
    assert.equal(applyBump("0.0.0", "patch"), "0.0.1"));
  it("survives a malformed version", () => assert.equal(applyBump("garbage", "patch"), "0.0.1"));
});

describe("resolveReleaseBump", () => {
  it("takes the highest label across every PR in range", async () => {
    const labels = { 10: ["release:minor"], 11: ["release:major"] };
    const result = await resolveReleaseBump({
      currentVersion: "0.1.0",
      subjects: ["Merge pull request #10 from x", "thing (#11)"],
      repo: "o/r",
      token: "t",
      logger: quiet,
      fetchImpl: async (url) => okJson({ labels: labels[url.split("/").pop()].map((name) => ({ name })) }),
    });
    assert.equal(result.bump, "major");
    assert.equal(result.version, "1.0.0");
  });

  it("an explicit override skips the label scan entirely", async () => {
    let fetched = false;
    const result = await resolveReleaseBump({
      currentVersion: "0.1.0",
      subjects: ["Merge pull request #10 from x"],
      repo: "o/r",
      token: "t",
      override: "minor",
      logger: quiet,
      fetchImpl: async () => { fetched = true; return okJson({ labels: [] }); },
    });
    assert.equal(result.bump, "minor");
    assert.equal(result.version, "0.2.0");
    assert.equal(fetched, false);
  });

  // Run 34155737950: squash subject `(#1340)` named an issue. GET /pulls/1340
  // 404'd; GET /issues/1340 is a bare issue. Skipping the issue and reading
  // remaining PRs is the #1839 fix. Skipping every 404 (#1840) is not enough:
  // a missing/unauthorized real PR must still throw.
  it("skips a squash trailer that names an issue, and still reads other PRs", async () => {
    const logs = [];
    const result = await resolveReleaseBump({
      currentVersion: "0.1.0",
      subjects: [
        "Retire the production branch: deploy a named commit from main (#1340)",
        "docs(backup): restore dump-era (#1836)",
      ],
      repo: "o/r",
      token: "t",
      logger: { log: (line) => logs.push(line) },
      fetchImpl: githubFetch({
        "/repos/o/r/pulls/1340": notFound(),
        "/repos/o/r/issues/1340": okJson({ title: "issue only" }),
        "/repos/o/r/pulls/1836": okJson({ labels: [{ name: "release:minor" }] }),
      }),
    });
    assert.equal(result.bump, "minor");
    assert.equal(result.version, "0.2.0");
    assert.deepEqual(result.prNumbers, [1836]);
    assert.match(logs[0], /::warning::#1340 is an issue, not a pull request/);
  });

  it("defaults to patch when every squash trailer in range names an issue", async () => {
    const result = await resolveReleaseBump({
      currentVersion: "0.1.0",
      subjects: ["Retire the production branch: deploy a named commit from main (#1340)"],
      repo: "o/r",
      token: "t",
      logger: quiet,
      fetchImpl: githubFetch({
        "/repos/o/r/pulls/1340": notFound(),
        "/repos/o/r/issues/1340": okJson({ title: "issue only" }),
      }),
    });
    assert.equal(result.bump, "patch");
    assert.equal(result.version, "0.1.1");
    assert.deepEqual(result.prNumbers, []);
  });

  it("still throws when GET /pulls 404s but GET /issues shows a pull request", async () => {
    await assert.rejects(
      () =>
        resolveReleaseBump({
          currentVersion: "0.1.0",
          subjects: ["Merge pull request #10 from x"],
          repo: "o/r",
          token: "t",
          logger: quiet,
          fetchImpl: githubFetch({
            "/repos/o/r/pulls/10": notFound(),
            "/repos/o/r/issues/10": okJson({
              title: "a real PR",
              pull_request: { url: "https://api.github.com/repos/o/r/pulls/10" },
            }),
          }),
        }),
      /missing or unauthorized PR lookup/,
    );
  });

  it("still throws when GET /issues includes pull_request: null", async () => {
    await assert.rejects(
      () =>
        resolveReleaseBump({
          currentVersion: "0.1.0",
          subjects: ["Merge pull request #10 from x"],
          repo: "o/r",
          token: "t",
          logger: quiet,
          fetchImpl: githubFetch({
            "/repos/o/r/pulls/10": notFound(),
            "/repos/o/r/issues/10": okJson({
              title: "ambiguous",
              pull_request: null,
            }),
          }),
        }),
      /missing or unauthorized PR lookup/,
    );
  });

  it("still throws when GET /issues cannot classify a /pulls 404", async () => {
    await assert.rejects(
      () =>
        fetchPrLabels({
          repo: "o/r",
          prNumber: 10,
          token: "t",
          fetchImpl: githubFetch({
            "/repos/o/r/pulls/10": notFound(),
            "/repos/o/r/issues/10": { ok: false, status: 403, text: async () => "nope" },
          }),
        }),
      /could not be classified as a bare issue/,
    );
  });

  // A silent downgrade is the dangerous failure: a release:major PR shipping as
  // a patch because a token lacked a scope, with nothing red anywhere.
  it("throws when a PR in range cannot be read, rather than defaulting to patch", async () => {
    await assert.rejects(
      () =>
        resolveReleaseBump({
          currentVersion: "0.1.0",
          subjects: ["Merge pull request #10 from x"],
          repo: "o/r",
          token: "t",
          logger: quiet,
          fetchImpl: async () => ({ ok: false, status: 403, text: async () => "" }),
        }),
      /HTTP 403 for PR #10/,
    );
  });

  it("throws on a payload with no labels array", async () => {
    await assert.rejects(
      () =>
        resolveReleaseBump({
          currentVersion: "0.1.0",
          subjects: ["thing (#10)"],
          repo: "o/r",
          token: "t",
          logger: quiet,
          fetchImpl: async () => okJson({}),
        }),
      /Unexpected pull request payload/,
    );
  });

  it("falls back to patch when the range names no PRs", async () => {
    const result = await resolveReleaseBump({
      currentVersion: "1.0.0",
      subjects: ["chore: no pr reference"],
      repo: "o/r",
      token: "t",
      logger: quiet,
      fetchImpl: async () => { throw new Error("must not be called"); },
    });
    assert.equal(result.bump, "patch");
    assert.equal(result.version, "1.0.1");
  });
});

describe("the workflows that run this script grant the scope it needs", () => {
  // `fetchPrLabels` calls GET /repos/{repo}/pulls/{n}, which is gated on the
  // `pull-requests` permission — NOT on `contents`. A `permissions:` block is
  // exhaustive, so a job declaring only `contents: write` has `pull-requests:
  // none`, and the DEFAULT `bump: auto` path then fails after Render and Vercel
  // have already deployed. Both the reusable workflow and its caller need it:
  // a called workflow's permissions are intersected with the caller's.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  for (const [file, job] of [
    [".github/workflows/release.yml", "release"],
    [".github/workflows/deploy-production.yml", "release"],
  ]) {
    it(`${file} grants pull-requests: read and issues: read on its \`${job}\` job`, () => {
      const text = readFileSync(join(repoRoot, file), "utf8");
      const jobStart = text.indexOf(`\n  ${job}:\n`);
      assert.notEqual(jobStart, -1, `job \`${job}\` not found in ${file}`);
      const jobBody = text.slice(jobStart, jobStart + 2000);
      assert.match(jobBody, /permissions:/);
      assert.match(jobBody, /pull-requests: read/);
      // #1839: classify a /pulls 404 as a bare issue. Exhaustive `permissions:`
      // would otherwise set issues to none and the classifier would 403.
      assert.match(jobBody, /issues: read/);
    });
  }

  // Run 34155737950 tagged nothing because `auto` executed the live SHA's
  // pre-#1844 script. The overlay from `github.sha` is what makes a retry of
  // Release from main able to classify that same SHA.
  it("release.yml overlays the bump classifier from github.sha onto the live SHA checkout", () => {
    const text = readFileSync(join(repoRoot, ".github/workflows/release.yml"), "utf8");
    // Checkout and LIVE_SHA must be the trimmed output. Raw `inputs.sha` is
    // what left a trailing space on run 34234768094; overlaying onto that
    // would tag the wrong ref (or fail git) after Render/Vercel already
    // shipped.
    assert.match(text, /ref: \$\{\{ steps\.sha\.outputs\.sha \}\}/);
    assert.match(text, /WORKFLOW_SHA: \$\{\{ github\.sha \}\}/);
    assert.match(text, /LIVE_SHA: \$\{\{ steps\.sha\.outputs\.sha \}\}/);
    assert.doesNotMatch(text, /ref: \$\{\{ inputs\.sha \}\}/);
    assert.doesNotMatch(text, /LIVE_SHA: \$\{\{ inputs\.sha \}\}/);
    assert.match(text, /scripts\/ci\/resolve-release-bump\.mjs/);
    assert.match(text, /scripts\/ci\/lib/);
  });

  // Run 34247752847: Packet B shipped 0ca478e9, then `git push origin v1.0.0`
  // was rejected because the GitHub App token cannot update workflow files
  // and that SHA's release.yml differed from main. Contents API + contents:write.
  it("release.yml mints the tag via the Contents API, not git push", () => {
    const text = readFileSync(join(repoRoot, ".github/workflows/release.yml"), "utf8");
    const start = text.indexOf("- name: Create tag");
    assert.notEqual(start, -1);
    const next = text.indexOf("\n      - name:", start + 1);
    const step = next === -1 ? text.slice(start) : text.slice(start, next);
    assert.match(step, /git\/tags/);
    assert.match(step, /git\/refs/);
    assert.match(step, /RELEASE_GITHUB_TOKEN/);
    assert.match(step, /export GH_TOKEN="\$RELEASE_GITHUB_TOKEN"/);
    assert.match(step, /export GH_TOKEN="\$GITHUB_TOKEN"/);
    assert.match(step, /git fetch origin "refs\/tags\/\$\{TAG\}:refs\/tags\/\$\{TAG\}"/);
    assert.doesNotMatch(step, /git push origin/);
    assert.doesNotMatch(step, /git tag -a/);
    // A permissions grant, not the prose that forbids one.
    assert.doesNotMatch(text, /^[ \t]+workflows:[ \t]*write[ \t]*$/m);
  });

  // Run 34254679932: POST /git/tags succeeded; POST /git/refs 403'd on the
  // Actions App. The caller must pass the optional user-PAT secret through.
  it("deploy-production.yml forwards RELEASE_GITHUB_TOKEN into release.yml", () => {
    const text = readFileSync(
      join(repoRoot, ".github/workflows/deploy-production.yml"),
      "utf8",
    );
    const start = text.indexOf("\n  release:\n");
    assert.notEqual(start, -1);
    const jobBody = text.slice(start, start + 2500);
    assert.match(jobBody, /secrets:/);
    assert.match(jobBody, /RELEASE_GITHUB_TOKEN: \$\{\{ secrets\.RELEASE_GITHUB_TOKEN \}\}/);
    assert.doesNotMatch(text, /^[ \t]+workflows:[ \t]*write[ \t]*$/m);
  });

  it("release.yml declares RELEASE_GITHUB_TOKEN as an optional workflow_call secret", () => {
    const text = readFileSync(join(repoRoot, ".github/workflows/release.yml"), "utf8");
    const call = text.slice(text.indexOf("workflow_call:"), text.indexOf("workflow_dispatch:"));
    assert.match(call, /secrets:/);
    assert.match(call, /RELEASE_GITHUB_TOKEN:/);
    assert.match(call, /required: false/);
  });
});
