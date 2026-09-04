import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tests for .claude/hooks/pre-push-review-gate.sh — a shell hook, not a JS module, so this
// drives it as a subprocess. It lives here (rather than beside the hook) so the existing
// `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs) and the ci-scripts-tests CI job pick
// it up; a standalone script next to the hook is never run by anything and rots.
const HOOK = fileURLToPath(new URL("../../../.claude/hooks/pre-push-review-gate.sh", import.meta.url));

// Every case runs against a THROWAWAY git repo. Pointing the hook at the real working tree
// would make the suite read and write the live .cache/diff-review/<HEAD_SHA> marker that the
// production gate trusts — deleting a developer's genuine review evidence, and (worse) leaving
// a forged marker behind on an interrupted run, which opens the real gate for that HEAD.
let repo;
let headSha;
// A linked worktree of `repo` whose HEAD has diverged — the FRA-319 scenario, where
// CLAUDE_PROJECT_DIR (still `repo`) and the pushing checkout disagree about both the
// repository root and HEAD.
let worktree;
let worktreeHeadSha;

before(() => {
  repo = mkdtempSync(path.join(tmpdir(), "review-gate-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(path.join(repo, "f.txt"), "hello\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  headSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  worktree = mkdtempSync(path.join(tmpdir(), "review-gate-wt-"));
  git("worktree", "add", worktree, "-b", "wt-branch");
  writeFileSync(path.join(worktree, "wt.txt"), "worktree\n");
  execFileSync("git", ["-C", worktree, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", worktree, "commit", "-qm", "wt"], { stdio: "pipe" });
  worktreeHeadSha = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  assert.notEqual(worktreeHeadSha, headSha, "worktree HEAD must diverge or the cases are vacuous");
});

after(() => {
  rmSync(worktree, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

function runHook(command, { env = {}, pathOverride, transcriptPath = "", cwd = "", raw = false } = {}) {
  // `raw` sends the argument to the hook verbatim, for the malformed-payload cases. Without it
  // a "malformed" string would just be JSON-wrapped into a perfectly valid payload and the case
  // would assert nothing.
  const payload = raw
    ? command
    : JSON.stringify({
        tool_input: { command },
        transcript_path: transcriptPath,
        ...(cwd ? { cwd } : {}),
      });
  // A fresh TMPDIR per call keeps the livelock attempt counter from leaking between cases.
  const tmp = mkdtempSync(path.join(tmpdir(), "rg-tmp-"));
  const res = spawnSync("bash", [HOOK], {
    input: payload,
    encoding: "utf8",
    env: {
      ...(pathOverride ? { PATH: pathOverride } : process.env),
      TMPDIR: tmp,
      CLAUDE_PROJECT_DIR: repo,
      ...env,
    },
  });
  rmSync(tmp, { recursive: true, force: true });
  return res;
}

// The hook communicates only through stdout; it must always exit 0 so it never breaks the tool
// call itself. Deriving "allow" from the mere absence of "deny" would let a crashed hook score
// as a passing allow, so assert the exit status and the emptiness of stdout explicitly.
function assertAllow(res, label) {
  assert.equal(res.status, 0, `${label}: hook should exit 0, got ${res.status} (stderr: ${res.stderr})`);
  assert.equal(res.stdout.trim(), "", `${label}: expected no decision, got ${res.stdout}`);
}

function assertDeny(res, label) {
  assert.equal(res.status, 0, `${label}: hook should exit 0, got ${res.status} (stderr: ${res.stderr})`);
  const parsed = JSON.parse(res.stdout); // also proves the emitted JSON is well-formed
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny", `${label}: expected deny`);
  assert.ok(
    typeof parsed.hookSpecificOutput.permissionDecisionReason === "string" &&
      parsed.hookSpecificOutput.permissionDecisionReason.length > 0,
    `${label}: deny must carry a non-empty reason`,
  );
}

const marker = () => path.join(repo, ".cache", "diff-review", headSha);
const writeMarker = () => {
  mkdirSync(path.dirname(marker()), { recursive: true });
  writeFileSync(marker(), "");
};
const clearMarker = () => rmSync(path.join(repo, ".cache"), { recursive: true, force: true });

// ── Command-position matching ───────────────────────────────────────────────

for (const cmd of [
  "git push",
  "git push -u origin br",
  "git -C /repo push",
  "git -c user.name=x push",
  "cd x && git push",
  "cd x\ngit push",
  "git push --dry-run && git push origin main",
]) {
  test(`gates: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertDeny(runHook(cmd), cmd);
  });
}

for (const cmd of [
  "ls -la",
  'git commit -m "wire up push notifications"',
  'grep "git push" file',
  "git pushdeploy",
  "git push --dry-run",
  "cat README.md",
]) {
  test(`ignores: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertAllow(runHook(cmd), cmd);
  });
}

// ── Evidence marker ─────────────────────────────────────────────────────────

test("allows the push once the marker exists for HEAD", () => {
  writeMarker();
  assertAllow(runHook("git push"), "marker present");
  clearMarker();
});

test("a marker for a different SHA does not satisfy the gate", () => {
  clearMarker();
  mkdirSync(path.join(repo, ".cache", "diff-review"), { recursive: true });
  writeFileSync(path.join(repo, ".cache", "diff-review", "0".repeat(40)), "");
  assertDeny(runHook("git push"), "stale marker");
  clearMarker();
});

// ── Worktree resolution (FRA-319) ───────────────────────────────────────────
// CLAUDE_PROJECT_DIR is pinned to `repo` in every runHook call, so these cases prove the
// hook trusts the payload's cwd over it: HEAD and the marker path must both resolve to the
// worktree, or a completed review can never satisfy the gate there.

const worktreeMarker = () => path.join(worktree, ".cache", "diff-review", worktreeHeadSha);

test("worktree: a marker at the worktree root for the worktree HEAD allows the push", () => {
  clearMarker();
  mkdirSync(path.dirname(worktreeMarker()), { recursive: true });
  writeFileSync(worktreeMarker(), "");
  assertAllow(runHook("git push", { cwd: worktree }), "worktree marker");
  rmSync(path.join(worktree, ".cache"), { recursive: true, force: true });
});

test("worktree: a stale main-worktree marker does not satisfy a worktree push", () => {
  // The main root holds a perfectly valid marker for the MAIN HEAD, but the push happens in the
  // worktree, whose HEAD has no marker anywhere: keying to CLAUDE_PROJECT_DIR would allow it.
  writeMarker();
  assertDeny(runHook("git push", { cwd: worktree }), "stale main marker, worktree push");
  clearMarker();
});

test("worktree: the node parser extracts cwd when python3 is absent", () => {
  // Parity discriminator for the matched parser pair: with python3 gone, only the node
  // branch runs. If it failed to extract cwd, the root would fall back to
  // CLAUDE_PROJECT_DIR (= repo), the worktree marker would never be found, and this
  // would deny — so an allow proves the node branch carries the field too.
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3"));
  mkdirSync(path.dirname(worktreeMarker()), { recursive: true });
  writeFileSync(worktreeMarker(), "");
  assertAllow(
    runHook("git push", { cwd: worktree, pathOverride: stub }),
    "worktree marker via node parser",
  );
  rmSync(path.join(worktree, ".cache"), { recursive: true, force: true });
  rmSync(stub, { recursive: true, force: true });
});

// ── `git -C <dir> push`: the gate keys to the -C target, not the cwd ────────
// These catch an implementation that keys ROOT to the cwd: it would deny the genuinely
// reviewed -C push in the first case, and fail open on the unreviewed target in the second.

test("-C push: a marker at the -C target satisfies the gate regardless of cwd", () => {
  clearMarker();
  mkdirSync(path.dirname(worktreeMarker()), { recursive: true });
  writeFileSync(worktreeMarker(), "");
  assertAllow(
    runHook(`git -C ${worktree} push`, { cwd: repo }),
    "-C target marker, cwd elsewhere",
  );
  rmSync(path.join(worktree, ".cache"), { recursive: true, force: true });
});

test("-C push: a valid marker in the cwd's repo must NOT allow pushing another worktree", () => {
  // The fail-open case: main checkout holds a legitimate marker for main HEAD, but the
  // command pushes the (unreviewed) worktree. Keying to cwd would exit 0 here.
  writeMarker();
  assertDeny(
    runHook(`git -C ${worktree} push`, { cwd: repo }),
    "cwd marker, unreviewed -C target",
  );
  clearMarker();
});

test("a -C on an earlier statement is not borrowed for a later plain push", () => {
  // `git -C <wt> fetch; git push` — the push targets the cwd repo, whose HEAD has a
  // marker; extracting the first statement's -C would key to the worktree and deny.
  writeMarker();
  assertAllow(
    runHook(`git -C ${worktree} fetch; git push`, { cwd: repo }),
    "plain push keyed to cwd, not the fetch's -C",
  );
  clearMarker();
});

// ── Deliberate bypass, in both forms an agent will actually write ───────────

test("bypass via the hook's own environment", () => {
  clearMarker();
  assertAllow(runHook("git push", { env: { FRAPP_SKIP_REVIEW_GATE: "1" } }), "env bypass");
});

// These catch a hook that reads only its own environment: the `export … && git push` forms are
// then denied, and the bare-prefix form passes only vacuously, because push_re declines to
// match an env-prefixed command at all.
for (const cmd of [
  "FRAPP_SKIP_REVIEW_GATE=1 git push",
  "export FRAPP_SKIP_REVIEW_GATE=1 && git push",
  "export FRAPP_SKIP_REVIEW_GATE=1; git push origin main",
]) {
  test(`bypass via command text: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertAllow(runHook(cmd), cmd);
  });
}

// ── Livelock guard: deny, but never wedge ───────────────────────────────────

test("releases with a warning after 4 blocked attempts for the same HEAD", () => {
  clearMarker();
  const tmp = mkdtempSync(path.join(tmpdir(), "rg-livelock-"));
  const run = () =>
    spawnSync("bash", [HOOK], {
      input: JSON.stringify({ tool_input: { command: "git push" }, transcript_path: "" }),
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp, CLAUDE_PROJECT_DIR: repo },
    });
  for (let i = 1; i <= 4; i++) assertDeny(run(), `attempt ${i}`);
  const released = run();
  assert.equal(released.stdout.trim(), "", "5th attempt should be allowed through");
  assert.match(released.stderr, /UNREVIEWED/, "release must warn loudly on stderr");
  rmSync(tmp, { recursive: true, force: true });
});

// ── Fail-closed parsing ─────────────────────────────────────────────────────

const STUB_BINS = ["bash", "cat", "grep", "mkdir", "dirname", "id", "git", "rm", "sed", "env", "node", "python3"];

// Build a PATH containing only `keep`. Asserts every requested binary actually resolved — a
// stub that silently omits something the hook needs makes the hook die for the wrong reason,
// and an "allow" assertion would then pass vacuously.
function makeStub(keep) {
  const dir = mkdtempSync(path.join(tmpdir(), "rg-stub-"));
  for (const bin of keep) {
    const src = spawnSync("bash", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
    assert.ok(src && src.startsWith("/"), `stub needs a real path for ${bin}, got ${JSON.stringify(src)}`);
    symlinkSync(src, path.join(dir, bin));
  }
  return dir;
}

test("node parses the payload when python3 is absent", () => {
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3"));

  // These two assertions alone would be VACUOUS: deleting the node branch entirely leaves them
  // green, because the parse-failure grep heuristic produces the same allow/deny verdicts.
  assertDeny(runHook("git push", { pathOverride: stub }), "no python3, push");
  assertAllow(runHook("ls -la", { pathOverride: stub }), "no python3, non-push");

  // So assert something only a real parse can produce. The rich deny carries additionalContext;
  // the fail-closed heuristic path emits a bare reason with none.
  const rich = JSON.parse(runHook("git push", { pathOverride: stub }).stdout);
  assert.ok(
    typeof rich.hookSpecificOutput.additionalContext === "string" &&
      rich.hookSpecificOutput.additionalContext.includes(".cache/diff-review"),
    "node must have actually parsed the payload, not fallen through to the heuristic",
  );

  // And a case the fallback heuristic gets WRONG in the other direction: the heuristic matches the
  // bare word "push" anywhere in the raw payload, so it denies this; only a real parse runs push_re
  // and correctly allows it. Deleting the node branch flips this assertion.
  assertAllow(
    runHook('git commit -m "wire up push notifications"', { pathOverride: stub }),
    "no python3, commit mentioning push",
  );

  rmSync(stub, { recursive: true, force: true });
});

// ── Bypass must not fire on a mere mention of the flag ──────────────────────
// These go red if the bypass check is ever loosened to an unanchored substring test: this repo
// documents FRAPP_SKIP_REVIEW_GATE by name in CONTRIBUTING.md and the runbook, so ordinary work
// naming it would then skip the gate silently — with no warning, unlike a livelock release.
for (const cmd of [
  'git commit -m "docs: explain FRAPP_SKIP_REVIEW_GATE=1 escape hatch" && git push',
  "grep -rn FRAPP_SKIP_REVIEW_GATE=1 docs/ && git push",
  'echo "set FRAPP_SKIP_REVIEW_GATE=1" >> README.md && git push',
  'git push -o ci.variable="FRAPP_SKIP_REVIEW_GATE=1"',
  "git push origin main # FRAPP_SKIP_REVIEW_GATE=1 would skip review",
]) {
  test(`mentioning the flag does not bypass: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertDeny(runHook(cmd), cmd);
  });
}

// ── Dry runs must not consume the gate ──────────────────────────────────────

for (const cmd of ["git push -n", "git push -n origin main"]) {
  test(`dry run is exempt: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertAllow(runHook(cmd), cmd);
  });
}

test("--no-verify is not mistaken for the -n dry-run flag", () => {
  clearMarker();
  assertDeny(runHook("git push --no-verify"), "--no-verify");
});

// ── Ref deletions publish no objects, so there is nothing to review ─────────
//
// These go red if the flag-form exemption is dropped. `--delete` makes EVERY refspec in the
// invocation a deletion: the command publishes no objects, so /diff-review (which reviews HEAD)
// has nothing to say about it, and the livelock guard would release it UNREVIEWED regardless.

for (const cmd of [
  "git push origin --delete br",
  "git push --delete origin br",
  "git push -d origin br",
  "git push --no-verify -d origin br",
  "git push origin --delete a b c",
]) {
  test(`ref deletion is exempt: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertAllow(runHook(cmd), cmd);
  });
}

// The colon refspec is git's other deletion form, and it must NOT be exempt: unlike the flag it
// COMPOSES, so one command can delete a ref and publish another. These two cases go red if
// `:<ref>` is ever added to the exempt set — they do not, on their own, prove the flag-vs-substring
// restriction; the ref-name cases below are what prove that.
for (const cmd of ["git push origin :br", "git push origin :old main"]) {
  test(`colon-refspec deletion is still gated: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertDeny(runHook(cmd), cmd);
  });
}

// ── The exemption is decided on TOKENS, not by searching the command string ──
//
// Every case below was demonstrated to release a REAL push against a live remote while the
// exemption was a substring test over `$command`. They are the reason the hook now requires the
// whole command to be one plain git invocation of inert tokens before it will look for a flag.
// A shell operator, a comment, a quote, or a command substitution anywhere keeps the gate on.

for (const [cmd, why] of [
  ["git push origin --delete br && git push origin main", "deletion chained onto a real push"],
  ["git push origin main & git push -d origin tmp", "backgrounded: `&` is a separator too"],
  ["git push --dry-run & git push origin main", "same hole on the dry-run form"],
  ["git push origin main # -d", "flag sits in a shell comment"],
  ["git push origin main # not a -d deletion", "flag sits in prose inside a comment"],
  ['git push -o "ci.skip -d " origin main', "flag sits inside a quoted option value"],
  ['git push origin "release-$(date -d +1day +%F)"', "flag belongs to date(1)"],
  ["git push --repo -d origin main", "git consumes -d as --repo's value"],
  ["git push -o -d origin main", "git consumes -d as -o's value"],
]) {
  test(`real push is still gated (${why}): ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertDeny(runHook(cmd), why);
  });
}

// A flag is matched as a WHOLE token, at both ends. `feature-d` and `fix--delete-exemption` only
// exercise the leading boundary; `-deploy` and `--delete-merged` are what fail if the trailing
// anchor is ever dropped. `--dry-run` needs the same coverage as `--delete`.
for (const cmd of [
  "git push origin fix--delete-exemption",
  "git push origin feature-d",
  "git push origin -deploy",
  "git push origin --delete-merged main",
  "git push origin fix--dry-run-branch",
  "git push --no-verify",
]) {
  test(`flag text inside a longer token does not exempt: ${JSON.stringify(cmd)}`, () => {
    clearMarker();
    assertDeny(runHook(cmd), cmd);
  });
}

// `-C` and `-c` take a value, but the deletion after them is still a real deletion — skipping an
// option's argument must not also skip the flag that follows it.
test("a -C-targeted deletion is still exempt", () => {
  clearMarker();
  assertAllow(runHook(`git -C ${repo} push --delete origin br`), "-C deletion");
});

test("a ref name with underscores and slashes is exempt", () => {
  clearMarker();
  assertAllow(runHook("git push origin --delete claude/some_branch-name"), "underscore ref");
});

// The second stated benefit of the exemption: an exempt deletion must not burn livelock budget,
// which would otherwise count toward auto-allowing a real push. Without this, moving the `exit 0`
// to after the counter would leave the whole suite green.
test("an exempt deletion does not consume livelock budget", () => {
  clearMarker();
  const tmp = mkdtempSync(path.join(tmpdir(), "rg-budget-"));
  const run = (command) =>
    spawnSync("bash", [HOOK], {
      input: JSON.stringify({ tool_input: { command }, transcript_path: "" }),
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp, CLAUDE_PROJECT_DIR: repo },
    });
  for (let i = 0; i < 6; i++) assertAllow(run("git push origin --delete br"), `deletion ${i}`);
  // If the deletions had incremented the counter, this 7th call would be past the 4-attempt
  // livelock threshold and would be ALLOWED with an UNREVIEWED warning instead of denied.
  assertDeny(run("git push origin main"), "real push after 6 exempt deletions");
  rmSync(tmp, { recursive: true, force: true });
});

// ── Unresolvable HEAD: deny, with a real reason, and never wedge ────────────

test("an empty repository denies with a diagnostic and still releases via livelock", () => {
  const empty = mkdtempSync(path.join(tmpdir(), "review-gate-empty-"));
  execFileSync("git", ["-C", empty, "init", "-q"]);
  const tmp = mkdtempSync(path.join(tmpdir(), "rg-nohead-"));
  const run = () =>
    spawnSync("bash", [HOOK], {
      input: JSON.stringify({ tool_input: { command: "git push" }, transcript_path: "" }),
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp, CLAUDE_PROJECT_DIR: empty },
    });
  const first = run();
  assertDeny(first, "no HEAD");
  assert.match(
    JSON.parse(first.stdout).hookSpecificOutput.permissionDecisionReason,
    /cannot resolve HEAD/,
    "deny must carry a diagnostic, not an empty reason",
  );
  for (let i = 2; i <= 4; i++) assertDeny(run(), `no HEAD attempt ${i}`);
  assert.equal(run().stdout.trim(), "", "unresolvable HEAD must not wedge the session");
  rmSync(tmp, { recursive: true, force: true });
  rmSync(empty, { recursive: true, force: true });
});

test("with no interpreter at all, a push is denied and an unrelated command is not", () => {
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3" && b !== "node"));
  assertDeny(runHook("git push origin main", { pathOverride: stub }), "no interpreter, push");
  assertAllow(runHook("cat README.md", { pathOverride: stub }), "no interpreter, unrelated");
  rmSync(stub, { recursive: true, force: true });
});

test("a malformed payload mentioning a push is denied, not silently allowed", () => {
  clearMarker();
  assertDeny(runHook("not json at all: git push origin main", { raw: true }), "malformed + push");
  assertAllow(runHook("not json at all: ls -la", { raw: true }), "malformed, no push");
});

// `! grep -q` cannot tell "no match" (status 1) from "grep is broken/absent" (2 or 127), so
// writing the fallback that way allows a real push in exactly the broken environment it handles.
test("a broken grep fails closed rather than allowing the push", () => {
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3" && b !== "node" && b !== "grep"));
  assertDeny(runHook("git push origin main", { pathOverride: stub }), "no grep, push");
  rmSync(stub, { recursive: true, force: true });
});

test("the no-interpreter deny still counts toward the livelock release", () => {
  clearMarker();
  const stub = makeStub(STUB_BINS.filter((b) => b !== "python3" && b !== "node"));
  const tmp = mkdtempSync(path.join(tmpdir(), "rg-wedge-"));
  const run = () =>
    spawnSync("bash", [HOOK], {
      input: JSON.stringify({ tool_input: { command: "git push" }, transcript_path: "" }),
      encoding: "utf8",
      env: { PATH: stub, TMPDIR: tmp, CLAUDE_PROJECT_DIR: repo },
    });
  for (let i = 1; i <= 4; i++) assertDeny(run(), `unparseable attempt ${i}`);
  assert.equal(run().stdout.trim(), "", "must not wedge the session forever");
  rmSync(tmp, { recursive: true, force: true });
  rmSync(stub, { recursive: true, force: true });
});
