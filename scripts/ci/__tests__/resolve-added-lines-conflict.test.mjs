// `resolve-added-lines-conflict.mjs`: base-sync's keep-both merge for conflicts
// where both sides only added lines (2026-11-14). The pure parts run on text.
// The plan and push run against a fake GitHub that serves a real throwaway git
// repository's trees and blobs and applies the pushed tree with git, so what
// the sweep would push is checked against what git itself makes of the merge.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  balanced,
  diff3,
  keepBoth,
  keyCollisions,
  lcsMatches,
  mergeFile,
  namesOf,
  planAddedLinesConflict,
  pushAddedLinesMerge,
} from "../resolve-added-lines-conflict.mjs";

const lines = (...l) => `${l.join("\n")}\n`;

describe("lcsMatches / diff3", () => {
  it("matches every base line when the other side only inserted", () => {
    assert.deepEqual([...lcsMatches(["a", "b", "c"], ["a", "x", "b", "y", "c"])], [0, 2, 4]);
  });

  it("takes each side's change where only one side changed", () => {
    const chunks = diff3(["a", "b", "c"], ["A", "b", "c"], ["a", "b", "C"]);
    assert.deepEqual(chunks.flatMap((c) => c.ok ?? ["!"]), ["A", "b", "C"]);
  });

  it("takes a change both sides made the same way once", () => {
    const chunks = diff3(["a", "b"], ["a", "x", "b"], ["a", "x", "b"]);
    assert.deepEqual(chunks.flatMap((c) => c.ok ?? ["!"]), ["a", "x", "b"]);
  });

  it("reports an insertion at the same place as a conflict with an empty base", () => {
    const chunks = diff3(["a", "b"], ["a", "pr", "b"], ["a", "main", "b"]);
    assert.deepEqual(chunks.find((c) => c.conflict).conflict, { ours: ["pr"], base: [], theirs: ["main"] });
  });

  it("refuses to compare when the changed middle is too big", () => {
    const big = Array.from({ length: 5000 }, (_, k) => `l${k}`);
    assert.equal(lcsMatches(big, big.map((l) => `${l}x`)), null);
  });
});

describe("mergeFile", () => {
  it("keeps both appended exports, main's first", () => {
    const r = mergeFile({
      path: "packages/v/src/index.ts",
      base: lines('export * from "./a";'),
      ours: lines('export * from "./a";', 'export * from "./pr";'),
      theirs: lines('export * from "./a";', 'export * from "./main";'),
    });
    assert.deepEqual(r, { ok: true, hunks: 1, text: lines('export * from "./a";', 'export * from "./main";', 'export * from "./pr";') });
  });

  it("merges the clean parts too, and counts every hunk", () => {
    const r = mergeFile({
      path: "spec/x.md",
      base: lines("# T", "- one", "", "## Next", "- two"),
      ours: lines("# Title", "- one", "- pr one", "", "## Next", "- two", "- pr two"),
      theirs: lines("# T", "- one", "- main one", "", "## Next", "- two", "- main two"),
    });
    assert.equal(r.ok, true);
    assert.equal(r.hunks, 2);
    assert.equal(r.text, lines("# Title", "- one", "- main one", "- pr one", "", "## Next", "- two", "- main two", "- pr two"));
  });

  it("refuses a conflict where a side changed or removed existing lines", () => {
    const r = mergeFile({ path: "x.ts", base: lines("a = 1"), ours: lines("a = 2"), theirs: lines("a = 3") });
    assert.match(r.reason, /changed or removed existing lines/);
  });

  it("refuses binary content", () => {
    assert.match(mergeFile({ path: "x.bin", base: "a\0", ours: "b\0", theirs: "c\0" }).reason, /binary/);
  });

  it("keeps CRLF lines as they are", () => {
    const r = mergeFile({ path: "x.txt", base: "a\r\nd\r\n", ours: "a\r\nb\r\nd\r\n", theirs: "a\r\nc\r\nd\r\n" });
    assert.equal(r.text, "a\r\nc\r\nb\r\nd\r\n");
  });

  it("refuses a JSON file that keep-both leaves unparseable", () => {
    const r = mergeFile({ path: "x.json", base: lines("[", '  "a"', "]"), ours: lines("[", '  "a",', '  "b"', "]"), theirs: lines("[", '  "a",', '  "c"', "]") });
    assert.equal(r.ok, false);
  });

  it("keeps the comment when both sides pinned the same date but only one explained it", () => {
    // A real 2026-11-13 pair: the same fix twice, one with a comment.
    const r = mergeFile({
      path: "dev-log.service.spec.ts",
      base: lines("    const text = f(", "      NOTE,", "    );"),
      ours: lines("    const text = f(", "      NOTE,", "      // Pinned: the real clock failed it.", "      new Date('2026-11-11T15:00:00Z'),", "    );"),
      theirs: lines("    const text = f(", "      NOTE,", "      new Date('2026-11-11T15:00:00Z'),", "    );"),
    });
    assert.equal(r.text, lines("    const text = f(", "      NOTE,", "      // Pinned: the real clock failed it.", "      new Date('2026-11-11T15:00:00Z'),", "    );"));
  });
});

describe("keepBoth safety checks", () => {
  it("keeps a line both sides added at the edge once", () => {
    const r = keepBoth({ ours: ['export * from "./shared";', 'export * from "./pr";'], theirs: ['export * from "./shared";', 'export * from "./main";'], path: "i.ts" });
    assert.deepEqual(r.lines, ['export * from "./shared";', 'export * from "./main";', 'export * from "./pr";']);
  });

  it("refuses a line both sides added in the middle", () => {
    const r = keepBoth({ ours: ["x", "same thing", "y"], theirs: ["p", "same thing", "q"], path: "a.md" });
    assert.match(r.reason, /both sides add the line "same thing"/);
  });

  it("does not hoist blank lines or lone punctuation, so each block keeps its own", () => {
    const r = keepBoth({ ours: ["## A", "text", ""], theirs: ["## B", "more", ""], path: "README.md" });
    assert.deepEqual(r.lines, ["## B", "more", "", "## A", "text", ""]);
  });

  it("refuses two imports of the same name", () => {
    const r = keepBoth({ ours: ['import { foo } from "./a";'], theirs: ['import { bar, foo } from "./b";'], path: "x.ts" });
    assert.match(r.reason, /both sides add `foo`/);
  });

  it("refuses the same object key", () => {
    const r = keepBoth({ ours: ["  retries: 3,"], theirs: ["  retries: 5,"], path: "config.ts" });
    assert.match(r.reason, /`retries`/);
  });

  it("refuses a fragment of a larger bracketed structure", () => {
    const r = keepBoth({ ours: ["b: {", "  x: 1,"], theirs: ["c: {", "  y: 2,"], path: "x.ts" });
    assert.match(r.reason, /larger bracketed structure/);
  });

  it("refuses a Markdown block that opens or closes a code fence", () => {
    const r = keepBoth({ ours: ["```sql", "select 1;"], theirs: ["text"], path: "doc.md" });
    assert.match(r.reason, /code fence/);
  });

  it("allows two Markdown bullets that look like keys", () => {
    assert.equal(keepBoth({ ours: ["- Note: one"], theirs: ["- Note: two"], path: "doc.md" }).ok, true);
  });
});

describe("namesOf / keyCollisions / balanced", () => {
  it("reads the names a line declares", () => {
    assert.deepEqual(namesOf('import Foo, { bar as baz, type Qux } from "x";'), ["baz", "Qux", "Foo"]);
    assert.deepEqual(namesOf('export * as ns from "./ns";'), ["ns"]);
    assert.deepEqual(namesOf("export const useThing = () => {};"), ["useThing"]);
    assert.deepEqual(namesOf('  "name": "x",'), ["name"]);
    assert.deepEqual(namesOf("  optional?: string;"), ["optional"]);
    assert.deepEqual(namesOf("  Member,"), ["Member"]);
    assert.deepEqual(namesOf("see https://example.com"), []);
  });

  it("finds collisions only across the two blocks", () => {
    assert.deepEqual(keyCollisions(["a: 1", "b: 2"], ["c: 3", "a: 4"]), ["a"]);
    assert.deepEqual(keyCollisions(["a: 1"], ["b: 1"]), []);
  });

  it("balances brackets outside strings and comments", () => {
    assert.equal(balanced(["foo({ a: [1, 2] });"]), true);
    assert.equal(balanced(['const s = "(";', "// )"]), true);
    assert.equal(balanced(["foo: {"]), false);
    assert.equal(balanced(["}"]), false);
  });
});

// ── A fake GitHub over a real git repository ────────────────────────────────

const REPO = "pdcarlson/Frapp";

describe("planAddedLinesConflict + pushAddedLinesMerge", () => {
  let dir;
  let n = 0;
  const git = (args, opts = {}) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trimEnd();

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "added-lines-"));
    git(["init", "--quiet", "-b", "main"]);
    for (const [k, v] of [["user.email", "t@example.com"], ["user.name", "t"], ["commit.gpgsign", "false"]]) git(["config", k, v]);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const commit = (files) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) git(["rm", "--quiet", path]);
      else {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
    }
    git(["add", "-A"]);
    git(["commit", "--quiet", "--allow-empty", "-m", `c${n++}`]);
    return git(["rev-parse", "HEAD"]);
  };

  /** GitHub's git data API over `dir`; the ref update moves refs/heads/<branch> unless it moved. */
  function fakeGitHub({ mergeBase }) {
    const calls = [];
    const json = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? "GET";
      const path = new URL(url).pathname.replace(`/repos/${REPO}`, "");
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ method, path, body, token: init.headers?.Authorization?.slice(7) });
      let m;
      if (method === "GET" && path.startsWith("/compare/")) return json(200, { merge_base_commit: { sha: mergeBase } });
      if (method === "GET" && (m = /^\/git\/commits\/(\w+)$/.exec(path))) return json(200, { tree: { sha: git(["rev-parse", `${m[1]}^{tree}`]) } });
      if (method === "GET" && (m = /^\/git\/trees\/(\w+)$/.exec(path))) {
        const tree = git(["ls-tree", "-r", m[1]]).split("\n").filter(Boolean).map((l) => {
          const [info, p] = l.split("\t");
          const [mode, type, sha] = info.split(" ");
          return { path: p, mode, type, sha };
        });
        return json(200, { tree, truncated: false });
      }
      if (method === "GET" && (m = /^\/git\/blobs\/(\w+)$/.exec(path))) {
        return json(200, { encoding: "base64", content: execFileSync("git", ["cat-file", "blob", m[1]], { cwd: dir }).toString("base64") });
      }
      if (method === "POST" && path === "/git/trees") {
        const env = { ...process.env, GIT_INDEX_FILE: join(dir, `.git/fake-index-${n++}`) };
        git(["read-tree", body.base_tree], { env });
        for (const e of body.tree) {
          if (e.sha === null) git(["update-index", "--force-remove", e.path], { env });
          else {
            const sha = e.content !== undefined ? git(["hash-object", "-w", "--stdin"], { input: e.content }) : e.sha;
            git(["update-index", "--add", "--cacheinfo", `${e.mode},${sha},${e.path}`], { env });
          }
        }
        return json(201, { sha: git(["write-tree"], { env }) });
      }
      if (method === "POST" && path === "/git/commits") {
        const args = ["commit-tree", body.tree, ...body.parents.flatMap((p) => ["-p", p]), "-m", body.message];
        return json(201, { sha: git(args) });
      }
      if (method === "PATCH" && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
        const ref = `refs/heads/${decodeURIComponent(m[1])}`;
        const current = git(["rev-parse", ref]);
        try {
          git(["merge-base", "--is-ancestor", current, body.sha]);
        } catch {
          return json(422, { message: "Update is not a fast forward" });
        }
        git(["update-ref", ref, body.sha]);
        return json(200, {});
      }
      return json(404, { message: `no route for ${method} ${path}` });
    };
    return { fetchImpl, calls };
  }

  /** main and a PR branch cut from one base commit, each changing files. */
  function scenario({ base, pr, main }) {
    const branch = `claude/pr-${n}`;
    git(["checkout", "--quiet", "--orphan", `base-${n}`]);
    git(["rm", "-rf", "--quiet", "--ignore-unmatch", "."]);
    const mergeBase = commit(base);
    git(["checkout", "--quiet", "-b", branch]);
    const headSha = commit(pr);
    git(["checkout", "--quiet", "--detach", mergeBase]);
    const baseSha = commit(main);
    const { fetchImpl, calls } = fakeGitHub({ mergeBase });
    const prObj = { head: { sha: headSha, ref: branch, repo: { full_name: REPO } } };
    const args = { token: "t", repo: REPO, pr: prObj, baseRef: "main", baseSha, fetchImpl };
    return {
      branch,
      headSha,
      baseSha,
      calls,
      plan: () => planAddedLinesConflict(args),
      push: (plan) => pushAddedLinesMerge({ pushToken: "pat", repo: REPO, plan, baseRef: "main", baseSha, fetchImpl }),
    };
  }

  const barrel = (...names) => names.map((x) => `export * from "./${x}";`).join("\n") + "\n";

  it("pushes a two-parent merge that keeps both exports and matches git's merge everywhere else", async () => {
    const s = scenario({
      base: { "packages/v/index.ts": barrel("a"), "other.txt": "one\n", "both.md": lines("# T", "a", "", "b"), "gone.txt": "x\n" },
      pr: { "packages/v/index.ts": barrel("a", "pr"), "pr.ts": "export const pr = 1;\n", "both.md": lines("# Title", "a", "", "b"), "gone.txt": null },
      main: { "packages/v/index.ts": barrel("a", "main"), "other.txt": "two\n", "both.md": lines("# T", "a", "", "b", "c") },
    });
    const plan = await s.plan();
    assert.equal(plan.ok, true, plan.reason);
    assert.deepEqual(plan.files, ["packages/v/index.ts"]);
    const pushed = await s.push(plan);
    assert.equal(pushed.resolved, true, pushed.reason);
    const tip = git(["rev-parse", `refs/heads/${s.branch}`]);
    assert.equal(tip, pushed.sha);
    assert.equal(git(["rev-parse", `${tip}^1`]), s.headSha);
    assert.equal(git(["rev-parse", `${tip}^2`]), s.baseSha);
    assert.equal(git(["show", `${tip}:packages/v/index.ts`]) + "\n", barrel("a", "main", "pr"));
    // Every other file is what git's own merge makes of it.
    // merge-tree exits 1 for a conflict and still prints the tree first.
    let out;
    try {
      out = git(["merge-tree", "--write-tree", s.headSha, s.baseSha]);
    } catch (error) {
      out = error.stdout;
    }
    const gitMerge = out.split("\n")[0];
    const differ = git(["diff", "--name-only", gitMerge, tip]).split("\n").filter(Boolean);
    assert.deepEqual(differ, ["packages/v/index.ts"]);
    // Reads on GITHUB_TOKEN, writes on the App token only.
    for (const c of s.calls) assert.equal(c.token, c.method === "GET" ? "t" : "pat", `${c.method} ${c.path}`);
    assert.deepEqual(s.calls.find((c) => c.method === "PATCH").body.force, false);
  });

  it("leaves a real conflict to a person", async () => {
    const s = scenario({ base: { "a.ts": "export const x = 1;\n" }, pr: { "a.ts": "export const x = 2;\n" }, main: { "a.ts": "export const x = 3;\n" } });
    assert.match((await s.plan()).reason, /changed or removed existing lines/);
  });

  it("is all or nothing: one real conflict among simple ones refuses the PR", async () => {
    const s = scenario({
      base: { "i.ts": barrel("a"), "b.ts": "export const y = 1;\n" },
      pr: { "i.ts": barrel("a", "pr"), "b.ts": "export const y = 2;\n" },
      main: { "i.ts": barrel("a", "main"), "b.ts": "export const y = 3;\n" },
    });
    assert.equal((await s.plan()).ok, false);
  });

  it("refuses a file deleted on one side and changed on the other", async () => {
    const s = scenario({ base: { "a.ts": "one\n" }, pr: { "a.ts": "two\n" }, main: { "a.ts": null, "k.txt": "k\n" } });
    assert.match((await s.plan()).reason, /added or deleted on one side/);
  });

  it("refuses a PR that changes .github/workflows", async () => {
    const s = scenario({
      base: { "i.ts": barrel("a"), ".github/workflows/ci.yml": "on: push\n" },
      pr: { "i.ts": barrel("a", "pr"), ".github/workflows/ci.yml": "on: [push]\n" },
      main: { "i.ts": barrel("a", "main") },
    });
    assert.match((await s.plan()).reason, /\.github\/workflows/);
  });

  it("refuses a PR whose migration now sorts before main's newest", async () => {
    const s = scenario({
      base: { "i.ts": barrel("a"), "supabase/migrations/20261101000000_a.sql": "select 1;\n" },
      pr: { "i.ts": barrel("a", "pr"), "supabase/migrations/20261110000000_pr.sql": "select 2;\n" },
      main: { "i.ts": barrel("a", "main"), "supabase/migrations/20261112000000_main.sql": "select 3;\n" },
    });
    assert.match((await s.plan()).reason, /renumbering/);
  });

  it("refuses a conflict in a lockfile", async () => {
    const s = scenario({
      // Keep-both would even parse here; a lockfile is regenerated, never hand-merged.
      base: { "package-lock.json": '{\n  "a": 1,\n  "z": 0\n}\n' },
      pr: { "package-lock.json": '{\n  "a": 1,\n  "b": 2,\n  "z": 0\n}\n' },
      main: { "package-lock.json": '{\n  "a": 1,\n  "c": 3,\n  "z": 0\n}\n' },
    });
    assert.match((await s.plan()).reason, /lockfile/);
  });

  it("refuses when it finds no conflict where GitHub found one", async () => {
    const s = scenario({ base: { "a.txt": lines("a", "b", "c") }, pr: { "a.txt": lines("A", "b", "c") }, main: { "a.txt": lines("a", "b", "C") } });
    assert.match((await s.plan()).reason, /no conflict where GitHub found one/);
  });

  it("refuses a fork head without a single read", async () => {
    const plan = await planAddedLinesConflict({
      token: "t",
      repo: REPO,
      pr: { head: { sha: "1".repeat(40), ref: "x", repo: { full_name: "someone/Frapp" } } },
      baseRef: "main",
      baseSha: "2".repeat(40),
      fetchImpl: () => assert.fail("no reads for a fork"),
    });
    assert.match(plan.reason, /not in this repository/);
  });

  it("refuses the push when the head moved after it was read", async () => {
    const s = scenario({ base: { "i.ts": barrel("a") }, pr: { "i.ts": barrel("a", "pr") }, main: { "i.ts": barrel("a", "main") } });
    const plan = await s.plan();
    assert.equal(plan.ok, true, plan.reason);
    git(["checkout", "--quiet", s.branch]);
    const moved = commit({ "late.txt": "late\n" });
    const pushed = await s.push(plan);
    assert.equal(pushed.resolved, false);
    assert.match(pushed.reason, /not a fast forward/);
    assert.equal(git(["rev-parse", `refs/heads/${s.branch}`]), moved);
  });
});
