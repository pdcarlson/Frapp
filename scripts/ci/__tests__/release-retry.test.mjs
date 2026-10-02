// `release.yml` run again for a commit it already tagged (#3126).
//
// A retry after `Create tag` minted `vN` and a later step failed used to tag
// the same commit again: `vN..SHA` was empty, the bump defaulted to a patch,
// and `vN+1` landed beside `vN`. These tests run the workflow's own step
// scripts (read through `workflowSteps`, not copied) in a fixture repository
// with a stub `gh`, so a change to the shell is what they exercise.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stepRunScript, workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const RELEASE = join(REPO_ROOT, ".github", "workflows", "release.yml");

const step = (name) => {
  const found = workflowSteps(RELEASE).find(
    (s) => s.jobId === "release" && s.name === name,
  );
  assert.ok(found, `release.yml has no step "${name}"`);
  return found;
};

const IDENTITY = ["-c", "user.email=t@example.com", "-c", "user.name=t"];

/**
 * An `origin` holding two commits, `old` and `live`, tagged as `tags` says
 * (`{ v0.1.0: "old", v0.2.0: { at: "live", annotated: true } }`), cloned into
 * a work tree with its tags fetched, as the job's checkout and `Fetch tags`
 * leave it. `gh` is a stub: it logs each call, answers `git/tags` with a fake
 * object, creates the ref in `origin` on `git/refs`, and finds a Release only
 * for the tags in `releases`.
 */
function fixture({ tags = {}, releases = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "release-retry-"));
  const origin = join(dir, "origin.git");
  const work = join(dir, "work");
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["clone", "-q", origin, work], { stdio: "ignore" });
  git(work, ...IDENTITY, "commit", "-q", "--allow-empty", "-m", "old");
  const old = git(work, "rev-parse", "HEAD");
  git(work, ...IDENTITY, "commit", "-q", "--allow-empty", "-m", "live");
  const live = git(work, "rev-parse", "HEAD");
  const commits = { old, live };
  for (const [tag, spec] of Object.entries(tags)) {
    const { at, annotated } =
      typeof spec === "string" ? { at: spec, annotated: false } : spec;
    const args = annotated
      ? ["tag", "-a", tag, "-m", tag, commits[at]]
      : ["tag", tag, commits[at]];
    git(work, ...IDENTITY, ...args);
  }
  git(
    work,
    "-c",
    "push.negotiate=false",
    "push",
    "-q",
    "origin",
    "HEAD:refs/heads/main",
    "--tags",
  );

  const log = join(dir, "gh.log");
  writeFileSync(log, "");
  const bin = join(dir, "bin");
  execFileSync("mkdir", [bin]);
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      'if [ "$1" = api ]; then',
      '  case "$*" in',
      "    *git/tags*) echo fakeobject ;;",
      "    *git/refs*)",
      '      ref=$(printf "%s\\n" "$@" | sed -n "s/^ref=refs\\/tags\\///p")',
      `      git -C ${JSON.stringify(origin)} tag "$ref" "$SHA" ;;`,
      "  esac",
      "  exit 0",
      "fi",
      'if [ "$1 $2" = "release view" ]; then',
      `  for r in ${releases.join(" ")}; do [ "$r" = "$3" ] && exit 0; done`,
      '  echo "release not found" >&2; exit 1',
      "fi",
      "exit 0",
    ].join("\n"),
  );
  chmodSync(join(bin, "gh"), 0o755);

  /** Runs one step's script with `env`; returns its status, stdout and outputs. */
  const run = (name, env = {}) => {
    const output = join(dir, `out-${Math.random().toString(36).slice(2)}`);
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", stepRunScript(step(name))], {
      cwd: work,
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: "o/r",
        RUNNER_TEMP: dir,
        ...env,
      },
    });
    const outputs = Object.fromEntries(
      readFileSync(output, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    return {
      status: result.status,
      stdout: result.stdout + result.stderr,
      outputs,
    };
  };

  const ghCalls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const originTags = () =>
    git(origin, "tag", "--list").split("\n").filter(Boolean).sort();
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { commits, run, ghCalls, originTags, cleanup };
}

describe("release.yml run again for a commit it already tagged (#3126)", () => {
  it("finds a plain vX.Y.Z on the SHA, annotated or not, and the highest of two", () => {
    for (const annotated of [false, true]) {
      const f = fixture({
        tags: { "v0.1.0": "old", "v0.2.0": { at: "live", annotated } },
      });
      try {
        const found = f.run("Find a release tag already on this commit", {
          SHA: f.commits.live,
        });
        assert.equal(found.status, 0, found.stdout);
        assert.equal(found.outputs.tag, "v0.2.0", `annotated=${annotated}`);
      } finally {
        f.cleanup();
      }
    }
    const f = fixture({
      tags: { "v0.2.0": "live", "v0.10.0": "live", "v0.11.0-rc1": "live" },
    });
    try {
      const found = f.run("Find a release tag already on this commit", {
        SHA: f.commits.live,
      });
      assert.equal(
        found.outputs.tag,
        "v0.10.0",
        "by version, and never a tag release.yml doesn't mint",
      );
    } finally {
      f.cleanup();
    }
  });

  it("finds nothing on an untagged SHA, so a first run bumps and mints as before", () => {
    const f = fixture({ tags: { "v0.1.0": "old" } });
    try {
      const found = f.run("Find a release tag already on this commit", {
        SHA: f.commits.live,
      });
      assert.equal(found.status, 0, found.stdout);
      assert.equal(found.outputs.tag, "");
      const tag = f.run("Create tag", {
        SHA: f.commits.live,
        VERSION: "0.2.0",
        EXISTING: "",
      });
      assert.equal(tag.status, 0, tag.stdout);
      assert.deepEqual(
        { tag: tag.outputs.tag, created: tag.outputs.created },
        { tag: "v0.2.0", created: "true" },
      );
      assert.deepEqual(f.originTags(), ["v0.1.0", "v0.2.0"]);
    } finally {
      f.cleanup();
    }
  });

  it("skips the bump and mints no tag when the SHA already carries one", () => {
    // The two steps that would bump are gated on the lookup, so a retry never
    // computes vN+1 at all.
    for (const name of ["Get current version", "Resolve the version bump"]) {
      assert.equal(step(name).if, "steps.existing.outputs.tag == ''", name);
    }
    const f = fixture({ tags: { "v0.1.0": "old", "v0.2.0": "live" } });
    try {
      // VERSION is what a bump would have said had it run; it must not matter.
      const tag = f.run("Create tag", {
        SHA: f.commits.live,
        VERSION: "0.2.1",
        EXISTING: "v0.2.0",
      });
      assert.equal(tag.status, 0, tag.stdout);
      assert.deepEqual(
        { tag: tag.outputs.tag, created: tag.outputs.created },
        { tag: "v0.2.0", created: "false" },
      );
      assert.deepEqual(f.ghCalls(), [], "no tag object and no ref");
      assert.deepEqual(f.originTags(), ["v0.1.0", "v0.2.0"]);
    } finally {
      f.cleanup();
    }
  });

  it("makes a reused tag's missing GitHub Release, and leaves one that exists", () => {
    assert.equal(
      step("Create GitHub Release").if,
      "steps.tag.outputs.created == 'true' || steps.existing.outputs.tag != ''",
    );
    const missing = fixture({ tags: { "v0.1.0": "old", "v0.2.0": "live" } });
    try {
      const release = missing.run("Create GitHub Release", {
        TAG: "v0.2.0",
        CREATED: "false",
      });
      assert.equal(release.status, 0, release.stdout);
      assert.deepEqual(missing.ghCalls(), [
        "release view v0.2.0",
        "release create v0.2.0 --title v0.2.0 --notes-file /tmp/changelog.md --latest=true",
      ]);
    } finally {
      missing.cleanup();
    }
    const present = fixture({
      tags: { "v0.2.0": "live" },
      releases: ["v0.2.0"],
    });
    try {
      const release = present.run("Create GitHub Release", {
        TAG: "v0.2.0",
        CREATED: "false",
      });
      assert.equal(release.status, 0, release.stdout);
      assert.deepEqual(present.ghCalls(), ["release view v0.2.0"]);
    } finally {
      present.cleanup();
    }
  });

  it("marks a tag this run minted Latest even when its local fetch failed", () => {
    // Create tag only warns when fetching the new ref fails, so the local list
    // can lack it; a minted tag is still the newest.
    const f = fixture({ tags: { "v0.1.0": "old" } });
    try {
      const release = f.run("Create GitHub Release", {
        TAG: "v0.2.0",
        CREATED: "true",
      });
      assert.equal(release.status, 0, release.stdout);
      assert.deepEqual(f.ghCalls(), [
        "release create v0.2.0 --title v0.2.0 --notes-file /tmp/changelog.md --latest=true",
      ]);
    } finally {
      f.cleanup();
    }
  });

  it("doesn't mark a reused tag Latest, or diff it against a newer one, once a later ship is tagged", () => {
    const f = fixture({
      tags: { "v0.1.0": "old", "v0.2.0": "live", "v0.3.0": "live" },
    });
    try {
      // v0.2.0 reused while v0.3.0 is newer: the Release is not Latest...
      const release = f.run("Create GitHub Release", {
        TAG: "v0.2.0",
        CREATED: "false",
      });
      assert.equal(release.status, 0, release.stdout);
      assert.match(f.ghCalls().at(-1), /--latest=false$/);
      // ...and its notes start from the tag below it, not the newer one.
      const notes = f.run("Generate changelog", {
        SHA: f.commits.live,
        TAG: "v0.2.0",
      });
      assert.equal(notes.status, 0, notes.stdout);
      assert.match(notes.stdout, /- [0-9a-f]+ live/);
      assert.doesNotMatch(notes.stdout, /- [0-9a-f]+ old/);
    } finally {
      f.cleanup();
    }
  });
});
