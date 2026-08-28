import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyBump,
  highestBump,
  prNumberFromSubject,
  prNumbersFromSubjects,
  resolveReleaseBump,
} from "../resolve-release-bump.mjs";

const quiet = { log: () => {} };

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
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
          fetchImpl: async () => ({ ok: false, status: 404 }),
        }),
      /HTTP 404 for PR #10/,
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
    it(`${file} grants pull-requests: read on its \`${job}\` job`, () => {
      const text = readFileSync(join(repoRoot, file), "utf8");
      const jobStart = text.indexOf(`\n  ${job}:\n`);
      assert.notEqual(jobStart, -1, `job \`${job}\` not found in ${file}`);
      const jobBody = text.slice(jobStart, jobStart + 2000);
      assert.match(jobBody, /permissions:/);
      assert.match(jobBody, /pull-requests: read/);
    });
  }
});
