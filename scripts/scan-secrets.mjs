#!/usr/bin/env node

/**
 * gitleaks wrapper shared by the pre-commit hook, `npm run ci:local-gate`, and
 * the CI `secret-scan` job. Resolves a single pinned gitleaks binary and runs the
 * mode-appropriate scan against the repo-root .gitleaks.toml. Exits non-zero when
 * a secret is found (gitleaks default `--exit-code 1`).
 *
 * Modes (argv):
 *   --staged                   scan staged changes only (pre-commit)
 *   --base <sha> --head <sha>  scan the base..head commit range (CI / local gate)
 *   (none)                     scan full history (audit)
 *
 * Flags:
 *   --soft-missing  when the gitleaks binary can't be found/installed, print
 *                   install guidance and exit 0 instead of failing. The local hook
 *                   and gate pass this so an offline dev isn't hard-blocked; CI
 *                   omits it so a missing scanner is a hard error.
 *
 * ## Ref completeness (full mode only)
 *
 * `gitleaks git` scans every ref the clone holds — and silently reports clean over
 * the ones it doesn't. A partial clone therefore produces an all-clear that is
 * indistinguishable from a real audit, which is how a false entry gets appended to
 * the audit record in SECRET_SCANNING.md. Full mode now refuses to pretend.
 *
 * **Shallowness is the wrong diagnostic.** A full-depth `--single-branch` clone
 * reports `is-shallow=false`, `git fetch --unshallow` errors as a no-op, and the
 * scan covers a fraction of history at exit 0. The load-bearing signal is instead
 * a *ref set comparison* against `git ls-remote`, which is the only one of the
 * three that catches the ordinary case of a clone that simply has not fetched
 * lately — neither shallow nor narrowly configured, just stale.
 *
 * It compares ref *sets*, not counts, because remote-tracking refs for branches
 * deleted upstream survive until someone runs `git fetch --prune`: under a count
 * comparison one stale ref silently pays for one never-fetched head.
 *
 * Severity depends on how full mode was reached, which is not cosmetic:
 *   - explicitly requested (an audit) -> refuse, non-zero
 *   - fallen back to from range mode  -> warn only, never fail. CI drops here on an
 *     unreachable base or the all-zeros new-branch sentinel (see main), and failing
 *     would red-light the required `secret-scan` check on a force-push.
 *   - origin unreachable (offline)    -> warn only, mirroring --soft-missing —
 *     UNLESS shallowness or the refspec already proves the clone incomplete
 *     without needing the network, which still refuses.
 *
 * Docs: docs/internal/ci-cd/SECRET_SCANNING.md
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, ".gitleaks.toml");
const BASELINE_PATH = join(ROOT, ".gitleaks-baseline.json");
const CACHED_BIN = join(ROOT, ".cache", "gitleaks", "gitleaks");
const INSTALL_SCRIPT = join(ROOT, "scripts", "install-gitleaks.sh");

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  // Guard against a following flag being swallowed as this flag's value (matches the
  // convention in scripts/check-migration-safety.mjs). Commit SHAs never start with "-".
  if (value === undefined || value.startsWith("-")) return undefined;
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

/**
 * Build the gitleaks argv (pure — unit-tested). Run from the repo root.
 * @param {{mode:"staged"|"range"|"full", base?:string, head?:string, configPath:string, baselinePath?:string}} opts
 */
export function buildGitleaksArgs({ mode, base, head, configPath, baselinePath }) {
  const args = ["git", "--no-banner", "--redact", "-c", configPath];
  if (baselinePath) {
    args.push("--baseline-path", baselinePath);
  }
  if (mode === "staged") {
    // Scan the staged diff (git index) — fast, pre-commit oriented.
    args.push("--pre-commit", "--staged");
  } else if (mode === "range") {
    // Scan only the commits introduced by head relative to base.
    args.push(`--log-opts=${base}..${head}`);
  }
  // mode "full": no extra args — `gitleaks git` scans the whole history.
  return args;
}

/**
 * A refspec that maps *every* head, rather than one branch. Accepts both the
 * ordinary `+refs/heads/*:refs/remotes/origin/*` and a mirror's `+refs/*:refs/*`;
 * `+refs/heads/main:...` does not qualify.
 */
const FULL_HEADS_REFSPEC = /^\+?refs\/(heads\/)?\*:/;

/** How many missing refs to name before summarising. */
const SAMPLE_LIMIT = 3;

function narrowRefspecReason(fetchSpecs) {
  return (
    `\`remote.origin.fetch\` is ${fetchSpecs.map((spec) => `\`${spec}\``).join(", ")}, which does ` +
    "not map every head — widen it with `git remote set-branches origin '*'`"
  );
}

/**
 * Decide whether a clone can support a real full-history audit (pure — unit-tested).
 *
 * `remoteHeads: null` means origin was unreachable. That is deliberately NOT
 * "incomplete": an offline dev cannot prove completeness either way, and
 * hard-blocking them contradicts the --soft-missing precedent. It downgrades to
 * "unknown" — unless a local signal (shallow, narrow refspec) already proves
 * incompleteness on its own, which needs no network to know.
 *
 * @param {{isShallow:boolean, fetchSpecs?:string[], localObjects?:string[],
 *   remoteHeads?:{sha:string,name:string}[]|null,
 *   remotePrRefs?:{sha:string,name:string}[]|null}} state
 *   `localObjects` is every commit id this clone has a ref for, in any namespace.
 * @returns {{status:"complete"|"incomplete"|"unknown", reasons:string[],
 *   presentCount:number, remoteCount:number|null, missing:string[]}}
 */
export function evaluateRefCompleteness({
  isShallow,
  fetchSpecs = [],
  localObjects = [],
  remoteHeads = null,
  remotePrRefs = null,
}) {
  const reasons = [];

  if (isShallow) {
    reasons.push("the clone is shallow (`--depth`), so most commits are absent entirely");
  }

  // Only meaningful when at least one refspec is configured; a repo with no
  // `remote.origin.fetch` at all has no origin to be narrow about.
  const narrowRefspec =
    fetchSpecs.length > 0 && !fetchSpecs.some((spec) => FULL_HEADS_REFSPEC.test(spec.trim()));

  if (remoteHeads === null) {
    // Offline: shallowness and the refspec are the only signals that need no network.
    if (narrowRefspec) reasons.push(narrowRefspecReason(fetchSpecs));
    const offline = { presentCount: 0, remoteCount: null, missing: [] };
    if (reasons.length > 0) return { status: "incomplete", reasons, ...offline };
    return {
      status: "unknown",
      reasons: ["origin is unreachable, so ref coverage could not be compared"],
      ...offline,
    };
  }

  // Ask the only question that actually matters: **does this clone hold the commit
  // each remote ref points at?** Three cheaper formulations all fail:
  //
  //   - Ref *counts* — git never prunes remote-tracking refs on its own, so one
  //     ref for a branch deleted upstream silently pays for one head that was
  //     never fetched.
  //   - Ref *names* — a clone behind 20 commits on `main` has every branch name
  //     and none of the new commits, which is exactly the "~27% of history at
  //     exit 0" row the docs call the dangerous one.
  //   - Refs in one *namespace* — heads live under `refs/heads/*` in a mirror and
  //     under `refs/remotes/origin/*` in a working clone, and a bare repo with a
  //     remote uses the latter while `--is-bare-repository` says otherwise. A
  //     linked worktree of a bare repo reports non-bare besides.
  //
  // Comparing objects sidesteps all three: `localObjects` is every SHA this clone
  // has a ref for, in any namespace, and `gitleaks git` walks `--all`, so a remote
  // SHA present under *some* local ref is genuinely scanned.
  const held = new Set(localObjects);
  const missingHeads = remoteHeads.filter((ref) => !held.has(ref.sha));
  const presentCount = remoteHeads.length - missingHeads.length;

  if (missingHeads.length > 0) {
    reasons.push(
      `${missingHeads.length} of origin's ${remoteHeads.length} heads are absent or behind ` +
        `(${coveragePercent(presentCount, remoteHeads.length)} coverage; ` +
        `${describeRefs(missingHeads)})`,
    );
    // Advisory, and only ever alongside genuinely missing refs — never a verdict
    // of its own. A narrow refspec explains *why* refs are missing and names the
    // durable fix, but failing on it once every ref is actually present would
    // leave a dev who ran the printed remedy refused forever with no way out:
    // a command-line `git fetch` retrieves the refs without rewriting the
    // persisted `remote.origin.fetch` the check reads.
    if (narrowRefspec) reasons.push(narrowRefspecReason(fetchSpecs));
  }

  // PR refs are not optional for an audit: a secret pushed to a pull request
  // whose branch was later deleted is still on the remote and still fetchable,
  // but `git clone` never retrieves it and `--all` cannot walk it. Reported
  // separately because the remedy for it is a different fetch refspec.
  const missingPrRefs = (remotePrRefs ?? []).filter((ref) => !held.has(ref.sha));
  if (missingPrRefs.length > 0) {
    reasons.push(
      `${missingPrRefs.length} of origin's ${remotePrRefs.length} pull-request refs are absent ` +
        `(${describeRefs(missingPrRefs)}) — a secret pushed to a closed PR lives only here`,
    );
  }

  const counts = { presentCount, remoteCount: remoteHeads.length };
  if (reasons.length > 0) {
    return {
      status: "incomplete",
      reasons,
      ...counts,
      missing: [...missingHeads, ...missingPrRefs].map((ref) => ref.name),
    };
  }
  return { status: "complete", reasons: [], ...counts, missing: [] };
}

/** "e.g. main, feat/one, …" for a sample of refs. */
function describeRefs(refs) {
  const sample = refs
    .slice(0, SAMPLE_LIMIT)
    .map((ref) => ref.name)
    .join(", ");
  return `e.g. ${sample}${refs.length > SAMPLE_LIMIT ? ", …" : ""}`;
}

/** Coverage as a display string. Exported so the tests can pin the boundaries. */
export function coveragePercent(present, total) {
  if (!total) return "0%";
  if (present >= total) return "100%";
  const pct = (present / total) * 100;
  // Never round a partial clone up to "100%" — that is the exact false all-clear
  // this guard exists to prevent. `Math.round` takes 99.5 to 100, so the bound
  // has to be inclusive; `> 99.5` left exactly-99.5 (199/200) printing "100%".
  if (pct >= 99.5) return "<100%";
  // Likewise a sub-0.1% clone must not render as "0.0%", which reads as none.
  if (pct > 0 && pct < 1) return pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/**
 * Was full mode *fallen back to* from range mode, rather than requested (pure —
 * unit-tested)? `--base`/`--head` are only ever passed by an incremental caller,
 * so their presence alongside full mode means the fallback at the bottom of
 * `main()` fired. Extracted so the wiring, and not merely the policy it feeds,
 * is pinned by a test: inverting this is what would red-light the required
 * `secret-scan` check on every force-push.
 */
export function fullModeIsFallback(argv) {
  return argv.includes("--base") || argv.includes("--head");
}

/**
 * Map a completeness verdict onto what the run should do (pure — unit-tested).
 *
 * Split out from the IO below because this is the CI-safety-critical decision:
 * only an explicitly requested audit may refuse. Full mode reached as a fallback
 * from range mode warns, because CI drops there on a force-push and a hard
 * failure would red-light the required `secret-scan` check.
 *
 * @returns {{action:"pass"|"warn"|"refuse", note:string}} `note` is appended to
 *   the success line so an audit record entry can quote what was covered.
 */
export function refCompletenessOutcome(result, isFallback) {
  const { status, presentCount, remoteCount } = result;

  if (status === "complete") {
    return { action: "pass", note: ` Covered all ${remoteCount} of origin's heads.` };
  }

  // Keyed on `status`, not on whether the remote was reachable: a clone proven
  // incomplete by a local signal is INCOMPLETE even when origin was unreachable,
  // and must not be softened to "unverified" in the audit record. When origin
  // *was* unreachable there is no coverage figure to quote — saying "0 heads"
  // would read as a measurement rather than the absence of one.
  const note =
    remoteCount === null
      ? ` Coverage unverified (origin unreachable)${status === "incomplete" ? " — INCOMPLETE." : "."}`
      : status === "incomplete"
        ? ` Covered ${presentCount} of origin's ${remoteCount} heads — INCOMPLETE.`
        : ` Coverage unverified (origin unreachable).`;

  return { action: status === "incomplete" && !isFallback ? "refuse" : "warn", note };
}

/**
 * gitleaks' `git --pre-commit --staged` / `--log-opts` interface needs gitleaks >= 8.19
 * (the `git`/`dir`/`stdin` subcommand split). Used to vet a PATH fallback binary so an
 * older system/Homebrew gitleaks isn't driven with flags it doesn't understand.
 */
function isCompatibleGitleaks(versionOutput) {
  const match = /(\d+)\.(\d+)/.exec(String(versionOutput));
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 8 || (major === 8 && minor >= 19);
}

/** Is `rev` an object present in this repo, so a `<rev>..HEAD` range is valid? */
function isReachable(rev) {
  const result = spawnSync("git", ["cat-file", "-e", `${rev}^{commit}`], {
    cwd: ROOT,
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

/** A network git call must never outlive this; `check:secrets` is run interactively. */
const LS_REMOTE_TIMEOUT_MS = 15_000;

/**
 * spawnSync options for a git call (pure — unit-tested).
 *
 * `GIT_TERMINAL_PROMPT` is applied *last*, after any caller-supplied `env`, so it
 * cannot be clobbered: without it a private origin with no cached credentials
 * turns `npm run check:secrets` into a hang on a username prompt, where the
 * intended behavior is to fall through to "origin unreachable" and warn.
 */
export function gitSpawnOptions(options = {}) {
  const { env, ...rest } = options;
  return {
    cwd: ROOT,
    encoding: "utf8",
    ...rest,
    env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" },
  };
}

/**
 * Run git for stdout; null when git itself failed (not installed, no repo, offline,
 * or timed out — spawnSync reports a timeout kill as `error`).
 * Exported as the DI seam the tests drive, matching `scripts/ci/check-migration-drift-gate.mjs`.
 */
export function defaultRunGit(args, options = {}) {
  const result = spawnSync("git", args, gitSpawnOptions(options));
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

/** Non-empty trimmed lines of git stdout. */
function splitLines(stdout) {
  if (!stdout) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Parse `<sha>TAB<refname>` lines — the shape of both `git ls-remote` and
 * `for-each-ref --format='%(objectname)%09%(refname)'` — into `{sha, name}`.
 *
 * `name` drops the leading `refs/heads/` or `refs/pull/` for readability only;
 * the comparison is on `sha`. The symbolic `origin/HEAD` pointer is skipped: it
 * duplicates another ref's object and `ls-remote --heads` never lists it.
 */
export function parseRefLines(stdout) {
  const refs = [];
  for (const line of splitLines(stdout)) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const sha = line.slice(0, tab).trim();
    const refname = line.slice(tab + 1).trim();
    if (!sha || !refname || refname.endsWith("/HEAD")) continue;
    refs.push({ sha, name: refname.replace(/^refs\/(heads|remotes\/origin)\//, "") });
  }
  return refs;
}

/** Read this clone's ref state. Impure counterpart to evaluateRefCompleteness. */
export function gatherRefState(runGit = defaultRunGit) {
  // Every ref this clone holds, in EVERY namespace — local branches, remote
  // tracking refs, a mirror's bare `refs/heads/*`, and previously fetched PR
  // refs alike. Picking one namespace by a boolean is what made a bare repo
  // with a remote, and a linked worktree of a bare repo, both read as empty.
  // `gitleaks git` walks `--all`, so a commit reachable from any local ref is
  // genuinely scanned, which makes the union the honest denominator.
  const localObjects = parseRefLines(
    runGit(["for-each-ref", "--format=%(objectname)%09%(refname)", "refs/**"]),
  ).map((ref) => ref.sha);

  const headsOut = runGit(["ls-remote", "--heads", "origin"], { timeout: LS_REMOTE_TIMEOUT_MS });
  const prOut = runGit(["ls-remote", "origin", "refs/pull/*/head"], {
    timeout: LS_REMOTE_TIMEOUT_MS,
  });

  return {
    isShallow: String(runGit(["rev-parse", "--is-shallow-repository"]) ?? "").trim() === "true",
    fetchSpecs: splitLines(runGit(["config", "--get-all", "remote.origin.fetch"])),
    localObjects,
    // null (not []) when origin is unreachable — [] would read as "the remote has
    // no branches" and make an offline clone look complete.
    remoteHeads: headsOut === null ? null : parseRefLines(headsOut),
    remotePrRefs: prOut === null ? null : parseRefLines(prOut),
  };
}

const REMEDY =
  "  Fetch every ref, then re-run:\n" +
  "    git remote set-branches origin '*'          # widens a --single-branch clone\n" +
  "    git fetch --unshallow 2>/dev/null || true   # only needed for a shallow clone\n" +
  "    git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' '+refs/pull/*/head:refs/remotes/pr/*'\n" +
  "  See docs/internal/ci-cd/SECRET_SCANNING.md § The audit is only as complete as the clone's refs.";

/**
 * Gate a full-mode scan on ref completeness. Returns a coverage note to append to
 * the success line, so an audit record entry can quote what was actually covered.
 *
 * @param {boolean} isFallback true when full mode was fallen back to from range
 *   mode rather than requested — warn, never fail (see the module docblock).
 */
function checkRefCompleteness(isFallback) {
  const result = evaluateRefCompleteness(gatherRefState());
  const { action, note } = refCompletenessOutcome(result, isFallback);
  if (action === "pass") return note;

  const detail = result.reasons.map((reason) => `  • ${reason}`).join("\n");

  if (action === "refuse") {
    console.error(
      "❌ Refusing to run a full-history audit over an incomplete clone.\n" +
        `${detail}\n\n` +
        "  A scan over these refs would print a clean result that covers only part of\n" +
        "  history — indistinguishable from a real all-clear, and not a valid audit record.\n\n" +
        REMEDY,
    );
    process.exit(1);
  }

  console.warn(
    `⚠️  Scanning full history over a clone of ${result.status === "unknown" ? "unverified" : "incomplete"} coverage.\n` +
      `${detail}\n\n` +
      `${REMEDY}\n` +
      "  Continuing — but this run is NOT a valid audit record.",
  );
  return note;
}

function resolveBinary() {
  // The pinned binary in .cache/ is the source of truth — it keeps local and CI in lockstep.
  // install-gitleaks.sh is idempotent (a fast version check when already cached), so a
  // GITLEAKS_VERSION bump takes effect everywhere without a manual re-install. stdout is
  // suppressed to keep per-commit output quiet; stderr still surfaces real download errors.
  const install = spawnSync("bash", [INSTALL_SCRIPT], { stdio: ["ignore", "ignore", "inherit"] });
  if (install.status === 0 && existsSync(CACHED_BIN)) return CACHED_BIN;

  // Installer exited non-zero — offline, no bash, or a checksum error (see its stderr). Fall back to a
  // COMPATIBLE gitleaks on PATH so an offline dev isn't hard-blocked. In CI there's no gitleaks on PATH,
  // so this returns null below and the scan hard-fails — a failed pinned install never silently passes.
  const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0 && isCompatibleGitleaks(probe.stdout)) {
    return "gitleaks";
  }

  return null;
}

function main() {
  const soft = hasFlag("--soft-missing");

  let mode = "full";
  let base;
  let head;
  if (hasFlag("--staged")) {
    mode = "staged";
  } else if (hasFlag("--base") || hasFlag("--head")) {
    base = getArg("--base");
    head = getArg("--head");
    if (!base || !head) {
      console.error("scan-secrets: --base and --head are both required for a range scan.");
      process.exit(2);
    }
    // No usable predecessor — the all-zero new-branch sentinel, or a rewritten/unreachable
    // SHA (e.g. a force-push `before`) — has no valid `base..head` range, so scan full history
    // instead of letting `git log <bad>..<head>` die with exit 128.
    mode = /^0+$/.test(base) || !isReachable(base) ? "full" : "range";
  }

  // Full mode only, and before the scan so a refusal costs nothing. The presence
  // of --base/--head means we *fell back* to full at the line above rather than
  // being asked for an audit; that path warns and proceeds, because failing it
  // would red-light the required `secret-scan` check on a force-push.
  // `staged` and `range` legitimately run in shallow checkouts — they only ever
  // scan a diff — so neither is gated.
  const coverageNote =
    mode === "full" ? checkRefCompleteness(fullModeIsFallback(process.argv)) : "";

  const bin = resolveBinary();
  if (!bin) {
    const guidance =
      "gitleaks not found and could not be installed.\n" +
      "  Install it with:  bash scripts/install-gitleaks.sh   (or: brew install gitleaks)";
    if (soft) {
      console.warn(`⚠️  ${guidance}\n  Skipping local secret scan — CI still enforces it.`);
      process.exit(0);
    }
    console.error(`❌ ${guidance}`);
    process.exit(1);
  }

  const args = buildGitleaksArgs({
    mode,
    base,
    head,
    configPath: CONFIG_PATH,
    baselinePath: existsSync(BASELINE_PATH) ? BASELINE_PATH : undefined,
  });

  const result = spawnSync(bin, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) {
    console.error(`scan-secrets: failed to run gitleaks: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      "\n❌ gitleaks found potential secrets (or errored) above.\n" +
        "  If it's a real secret: remove it from the diff and rotate it.\n" +
        "  If it's a false positive: add a tight entry to .gitleaks.toml [allowlist]\n" +
        "  or an inline `gitleaks:allow` comment. See docs/internal/ci-cd/SECRET_SCANNING.md.",
    );
    // result.status is null when gitleaks was signal-killed (OOM/SIGTERM); treat that as a
    // failure, never a pass (process.exit(null) would coerce to 0 and falsely report clean).
    process.exit(result.status ?? 1);
  }
  console.log(`✅ gitleaks: no secrets found.${coverageNote}`);
}

// Run only when invoked directly, so tests can import buildGitleaksArgs cleanly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
