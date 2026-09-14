import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards the failure class that took out `scripts/cloud-sandbox-egress-probe.sh` for four
 * days (#2205, introduced by #2110).
 *
 * That script embedded its Python manifest builder as a single-quoted bash word
 * (`python3 -c '…'`). A docs edit inside the Python rewrote one warning string to read
 * `this session's environment dashboard`; the apostrophe closed the bash quote and the
 * rest of the file was parsed as shell. The whole script became unparseable — and because
 * a parse error kills a file before any command in it runs, the script's own
 * `|| { cs_log "WARN: …"; }` guard never fired. Bringup invoked it as
 * `bash … >/dev/null || true`, so nothing surfaced anywhere. Every cloud session ran with
 * no `.cloud-sandbox-capabilities.json` while the docs told agents to read it.
 *
 * The probe itself predates that commit and worked when it landed in #2105 — the dead
 * region was four days long, not the script's whole life. What had genuinely never
 * executed is the SECURITY branch, which needs a production host to answer; it is covered
 * below with a stubbed curl.
 */

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const PROBE = join(repoRoot, "scripts", "cloud-sandbox-egress-probe.sh");

const MANIFEST_KEYS = [
  "docs",
  "generated_at",
  "hosts",
  "probe_ok",
  "production_blocked_as_expected",
  "skill",
  "staging_reachable",
  "summary",
  "warnings",
];

// ── Discovery ────────────────────────────────────────────────────────────────────────
// By SHEBANG, not by `*.sh`. The repo's most security-relevant shell script is
// `.githooks/pre-commit` — the gitleaks scan that `scripts/setup-git-hooks.mjs` wires into
// `core.hooksPath` on every install — and it has no extension. A glob-based sweep would
// report "every tracked shell script parses" while never opening it, and the vacuity guard
// below would not notice because the glob still matches two dozen other files.
function trackedShellScripts() {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  return files.filter((rel) => {
    if (rel.endsWith(".sh")) return true;
    let head = "";
    try {
      head = readFileSync(join(repoRoot, rel), "utf8").slice(0, 200).split("\n", 1)[0];
    } catch {
      return false; // deleted, or not a regular readable file
    }
    return /^#!.*\b(ba)?sh\b/.test(head);
  });
}

test("every tracked shell script parses", () => {
  const scripts = trackedShellScripts();
  assert.ok(scripts.length > 5, `expected to find shell scripts, found ${scripts.length}`);
  assert.ok(
    scripts.includes(".githooks/pre-commit"),
    "discovery must reach extensionless scripts — .githooks/pre-commit is the gitleaks gate",
  );

  const broken = [];
  for (const rel of scripts) {
    const result = spawnSync("bash", ["-n", rel], { cwd: repoRoot, encoding: "utf8" });
    if (result.status !== 0) broken.push(`${rel}: ${(result.stderr || "").trim()}`);
  }
  assert.deepEqual(broken, [], `shell scripts failed \`bash -n\`:\n${broken.join("\n")}`);
});

test("the egress probe keeps its Python builder in a quoted heredoc, not `python3 -c '…'`", () => {
  const src = readFileSync(PROBE, "utf8");
  assert.match(
    src,
    /cat >"\$BUILDER" <<'PY'/,
    "builder must be written via a single-quoted heredoc, which bash does not scan for quotes",
  );
  // Comments are stripped first: the script explains this hazard in prose, and that prose
  // necessarily quotes the very form it warns against.
  const code = src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(
    code,
    /python3 -c '/,
    "inlining the builder as a single-quoted bash word is what #2205 was — an apostrophe in the Python breaks the whole file",
  );
  // The apostrophe that caused #2205. It must still be there, and still be harmless:
  // #2205's acceptance criteria explicitly forbid 'fixing' this by rewording.
  assert.ok(
    src.includes("this session's environment dashboard"),
    "the SECURITY warning wording from #2110 must be preserved verbatim",
  );
});

// ── Running the real probe ───────────────────────────────────────────────────────────
// One helper, used by every case below. `process.env` is inherited so a version-managed
// python3 (asdf/mise shims need $HOME) still resolves; the no-PATH cases override PATH
// explicitly, which is the only variable they need to control.
function runProbe(t, { curlStub, env = {}, expectManifest = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "egress-probe-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let pathPrefix = "";
  if (curlStub) {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    const stub = join(bin, "curl");
    writeFileSync(stub, curlStub);
    chmodSync(stub, 0o755);
    pathPrefix = `${bin}:`;
  }

  // /bin/bash by absolute path so the no-PATH cases still have a shell to run.
  const result = spawnSync("/bin/bash", [PROBE], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: dir,
      PATH: `${pathPrefix}${process.env.PATH}`,
      ...env,
    },
  });

  // Assert on the process before parsing, so a probe that died early reports its own
  // diagnosis instead of a bare ENOENT on the manifest.
  assert.equal(result.error, undefined, `spawn failed: ${result.error}`);
  assert.equal(
    result.status,
    0,
    `the probe is contracted never to exit non-zero. stderr:\n${result.stderr}`,
  );
  if (!expectManifest) return { result, manifest: null, dir };
  return {
    result,
    manifest: JSON.parse(readFileSync(join(dir, ".cloud-sandbox-capabilities.json"), "utf8")),
    dir,
  };
}

// Staging answers, production refuses at the connect layer — the correct environment.
const HEALTHY_CURL = `#!/usr/bin/env bash
url="\${!#}"
case "$url" in
  *//api.frapp.live/*|*//app.frapp.live*|*unttyvyfezddlyafcydh*) printf '000'; exit 56 ;;
  *) printf '200'; exit 0 ;;
esac
`;

// Same, except the production Supabase project answers — an allowlist widened to a wildcard.
const PROD_REACHABLE_CURL = `#!/usr/bin/env bash
url="\${!#}"
case "$url" in
  *//api.frapp.live/*|*//app.frapp.live*) printf '000'; exit 56 ;;
  *unttyvyfezddlyafcydh*) printf '404'; exit 0 ;;
  *) printf '200'; exit 0 ;;
esac
`;

test("a healthy environment produces a clean manifest with probe_ok true", (t) => {
  const { manifest } = runProbe(t, { curlStub: HEALTHY_CURL });

  assert.equal(manifest.probe_ok, true);
  assert.deepEqual(Object.keys(manifest).sort(), MANIFEST_KEYS);
  assert.deepEqual(manifest.warnings, [], "a correct environment warns about nothing");
  assert.equal(manifest.hosts.length, 7, "four staging hosts plus three production assertions");
  assert.ok(
    manifest.summary.startsWith("EGRESS: deployed staging reachable"),
    `unexpected summary: ${manifest.summary}`,
  );
  // live-verification/SKILL.md tells agents to resolve the staging Supabase ref by this
  // exact label rather than typing a `supabase.co` host from memory. It is load-bearing.
  const supabase = manifest.hosts.find((h) => h.key === "staging_supabase");
  assert.equal(supabase.label, "frapp-staging Supabase");
  assert.ok(supabase.url.includes("hnoyzpidbmizhbqaiity"), "must point at the staging project ref");
});

test("a reachable production host raises a SECURITY warning, not extra capability", (t) => {
  const { manifest } = runProbe(t, { curlStub: PROD_REACHABLE_CURL });

  const security = manifest.warnings.filter((w) => w.startsWith("SECURITY:"));
  assert.equal(security.length, 1, `expected one SECURITY warning, got ${JSON.stringify(manifest.warnings)}`);
  assert.match(security[0], /PRODUCTION Supabase is REACHABLE \(HTTP 404\) and must not be/);
  assert.match(security[0], /regressed to a wildcard/);
  assert.equal(
    manifest.summary,
    "EGRESS: production is reachable -- allowlist regression, see warnings",
    "the summary must lead with the regression, not with staging being fine",
  );
  const prodSupabase = manifest.hosts.find((h) => h.key === "prod_supabase");
  assert.equal(prodSupabase.ok, false, "a reachable prod host is ok:false");
  assert.equal(
    manifest.production_blocked_as_expected.includes("PRODUCTION Supabase"),
    false,
    "a host that answered must not be listed as correctly blocked",
  );
});

// ── The manifest is unconditional ────────────────────────────────────────────────────
// Absence, not the syntax error, was the harm in #2205: the docs tell agents to read this
// file INSTEAD of probing by hand and frame its absence as impossible, so a session that
// finds nothing has no sanctioned reading of what it is looking at.

test("a probe that cannot run still writes a parseable manifest, marked UNKNOWN", (t) => {
  // No PATH at all: mktemp, curl, sed, cat and date are all unreachable. This is the
  // harshest failure the script can meet, and the one where its degraded writer has
  // nothing but bash builtins to work with.
  const { manifest } = runProbe(t, { env: { PATH: "/nonexistent" } });

  assert.equal(manifest.probe_ok, false);
  assert.deepEqual(Object.keys(manifest).sort(), MANIFEST_KEYS, "degraded and real manifests must be shape-compatible");
  assert.deepEqual(manifest.hosts, []);
  assert.deepEqual(manifest.staging_reachable, []);
});

test("an UNKNOWN manifest reads as unknown, never as 'staging is blocked'", (t) => {
  const { manifest } = runProbe(t, { env: { PATH: "/nonexistent" } });

  // The empty `staging_reachable` above is the dangerous field: it is shaped exactly like
  // "nothing was reachable". The prose is what stops it being read that way.
  assert.match(manifest.summary, /capability UNKNOWN/);
  assert.equal(manifest.warnings.length, 1);
  const shown = [manifest.summary, ...manifest.warnings].join(" ");
  assert.match(shown, /nothing was verified/);
  assert.match(shown, /NOT evidence that staging is blocked/);
  assert.match(shown, /NOT evidence that production is unreachable/);
  assert.match(shown, /production-is-unreachable assertion did NOT run/);
  assert.equal(
    manifest.warnings[0].includes(manifest.summary),
    false,
    "the warning must not restate the summary — the hook prints both",
  );
});

test("the SessionStart hook does not advertise live checks off an UNKNOWN manifest", (t) => {
  // Drives the hook's ACTUAL renderer rather than re-implementing its gate here. That gate
  // carries a comment explaining why it is not keyed on `staging_reachable` alone, so it is
  // a live design decision; a JS copy of it would pass while the real one drifted.
  const { dir } = runProbe(t, { env: { PATH: "/nonexistent" } });
  const hook = join(repoRoot, ".claude", "hooks", "session-start.sh");
  const rendered = spawnSync(
    "bash",
    ["-c", `set -u; ROOT=${JSON.stringify(dir)}; source <(sed -n '/^egress_summary()/,/^}/p' ${JSON.stringify(hook)}); egress_summary`],
    { encoding: "utf8" },
  );

  assert.equal(rendered.status, 0, `hook renderer failed: ${rendered.stderr}`);
  assert.match(rendered.stdout, /capability UNKNOWN/, "the hook must surface the UNKNOWN summary");
  assert.doesNotMatch(
    rendered.stdout,
    /Live checks against deployed staging are available/,
    "the nudge must never fire off a manifest that verified nothing",
  );
});

test("generated_at is real UTC, not the host's local clock wearing a Z", (t) => {
  // The timestamp comes from `TZ=UTC printf -v now '%(…)T'` (with a `date -u` fallback for
  // bash 3.2, which has no %(…)T). A shape-only regex would stay green if the TZ=UTC prefix
  // stopped reaching the builtin, and CI runs in UTC so CI could never see it — so run the
  // probe under a deliberately non-UTC TZ and check the value against real time.
  const before = Date.now();
  const { manifest } = runProbe(t, { env: { PATH: "/nonexistent", TZ: "America/New_York" } });

  if (manifest.generated_at === "") {
    // Survivable by design: no %(…)T and no `date` reachable. Nothing further to assert.
    return;
  }
  assert.match(manifest.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const skewMs = Math.abs(Date.parse(manifest.generated_at) - before);
  assert.ok(
    skewMs < 120_000,
    `generated_at is ${manifest.generated_at} but now is ${new Date(before).toISOString()} — ` +
      `a ~${Math.round(skewMs / 60_000)}min skew means it is local time labelled Z`,
  );
});

// ── Regressions found reviewing this change ──────────────────────────────────────────

test("no host results never becomes an all-clear", (t) => {
  // `len(reachable) == staging_total` is 0 == 0 when the spec block is empty, which claimed
  // "deployed staging reachable; production correctly blocked" off zero probes. The `else`
  // was no safer: it asserted NOT reachable, equally unearned. Stub `sed` to emit nothing so
  // the fold's spec block arrives empty, exactly as a broken sed would.
  const dir = mkdtempSync(join(tmpdir(), "egress-nofold-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "sed"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(bin, "sed"), 0o755);
  writeFileSync(join(bin, "curl"), "#!/usr/bin/env bash\nprintf '000'\nexit 56\n");
  chmodSync(join(bin, "curl"), 0o755);

  const result = spawnSync("/bin/bash", [PROBE], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
  const manifest = JSON.parse(readFileSync(join(dir, ".cloud-sandbox-capabilities.json"), "utf8"));

  assert.doesNotMatch(
    manifest.summary,
    /production correctly blocked/,
    "zero probes must never produce an all-clear — nothing was measured",
  );
  assert.doesNotMatch(
    manifest.summary,
    /NOT reachable -- local stack only/,
    "zero probes must not assert unreachability either — that is equally unearned",
  );
  assert.match(manifest.summary, /could not determine/);
});

test("a builder that writes the manifest then dies reporting keeps the manifest", (t) => {
  // json.dump runs BEFORE the builder's two trailing print()s. The only non-ASCII bytes in
  // the program are the `§` in the SECURITY and "NOT reachable" warnings, which are printed
  // only when a host MISSES its expectation — so an ASCII stdout encoding raises
  // UnicodeEncodeError on exactly the runs that found something. Overwriting there would
  // erase a real allowlist regression.
  const { manifest, result } = runProbe(t, {
    curlStub: PROD_REACHABLE_CURL,
    env: { PYTHONIOENCODING: "ascii" },
  });

  assert.match(result.stderr, /UnicodeEncodeError/, "this test is only meaningful if the tail actually failed");
  assert.equal(manifest.probe_ok, true, "the manifest the builder wrote must survive its reporting failure");
  assert.equal(manifest.hosts.length, 7);
  assert.equal(
    manifest.warnings.filter((w) => w.startsWith("SECURITY:")).length,
    1,
    "the SECURITY finding must not be replaced by an UNKNOWN manifest",
  );
});

test("bringup surfaces a probe that fails instead of swallowing it", () => {
  // `bash … >/dev/null || true` reported neither the exit code nor the syntax error for
  // four days. Pin what replaced it.
  const src = readFileSync(join(repoRoot, "scripts", "cloud-sandbox-up.sh"), "utf8");
  assert.doesNotMatch(
    src,
    /cloud-sandbox-egress-probe\.sh" >\/dev\/null \|\| true/,
    "the probe invocation must not discard its exit status again",
  );
  assert.match(src, /egress_rc=\$\?/, "bringup must capture the probe's exit code");
  assert.match(
    src,
    /if \[ ! -s "\$EGRESS_MANIFEST" \]; then/,
    "bringup must warn when no manifest was produced at all",
  );
  assert.match(
    src,
    /rm -f "\$DONE_SENTINEL" "\$FAILED_SENTINEL" "\$EGRESS_MANIFEST"/,
    "the manifest must be cleared with the sentinels so a stale one cannot answer for this run",
  );
});
