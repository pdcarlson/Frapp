import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  chmodSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tests for the cs_retry / cs_classify_failure helpers in scripts/lib/cloud-sandbox-common.sh —
// shell, not a JS module, so this drives bash as a subprocess. Placement follows
// review-gate.test.mjs in this directory: the `test:ci-scripts` glob
// (scripts/ci/__tests__/*.test.mjs) and the ci-scripts-tests CI job pick it up automatically,
// whereas a test parked next to the script would never be run by anything and would rot.
//
// What is deliberately NOT tested here: `cs_supabase start` end to end. That needs a Docker
// daemon and ~10 image pulls, and no CI job in this repo starts one. The retry LOGIC is the part
// that can silently regress — a classifier that stops recognising a CDN 503 fails open into
// exactly the session-killing behaviour this code exists to prevent, and nothing else would
// notice until a real outage.
const LIB = fileURLToPath(
  new URL("../../lib/cloud-sandbox-common.sh", import.meta.url),
);

// Every case sources the lib in a fresh bash. FRAPP_SANDBOX_RETRY_BASE_DELAY=0 removes the
// backoff sleeps so the suite runs in milliseconds instead of ~30s per retry case — which is the
// concrete reason that knob is configurable rather than hardcoded.
function bash(script, env = {}) {
  // EVERY knob the lib reads is pinned, not just the delay. These are ordinary environment
  // variables, so a developer or CI runner that happens to export FRAPP_SANDBOX_START_RETRIES
  // would otherwise silently rewrite the attempt budget and fail the budget assertions with a
  // result that looks like a code regression. Pin them here; individual cases override via `env`.
  const pinned = {
    FRAPP_SANDBOX_START_RETRIES: "",
    FRAPP_SANDBOX_RETRY_BASE_DELAY: "0",
    FRAPP_SANDBOX_CLEANUP_TIMEOUT: "",
    SUPABASE_TELEMETRY_DISABLED: "",
    DO_NOT_TRACK: "",
  };
  return spawnSync("bash", ["-c", `set -uo pipefail\n. '${LIB}'\n${script}`], {
    encoding: "utf8",
    env: { ...process.env, ...pinned, ...env },
  });
}

// The classifier reads a FILE, so each case writes its fixture to one. Passing text on argv
// would not exercise the grep-over-file path the real caller uses.
function classify(logText) {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-classify-"));
  const cap = path.join(dir, "capture.log");
  writeFileSync(cap, logText);
  try {
    const res = bash(`cs_classify_failure '${cap}'`);
    assert.equal(
      res.status,
      0,
      `classifier exited ${res.status}: ${res.stderr}`,
    );
    return res.stdout.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── cs_classify_failure ──────────────────────────────────────────────────────────────────

test("classifies transient registry/CDN errors as retryable", () => {
  // Strings drawn from the shapes docker/the Supabase CLI actually emit, not invented ones.
  const transient = {
    "cloudfront 503":
      "failed to pull: received unexpected HTTP status: 503 Service Unavailable",
    "bare 502": "Error response from daemon: 502 Bad Gateway",
    "504 gateway": "unexpected status from GET request: 504 Gateway Timeout",
    "connection reset": "read tcp 10.0.0.2:443: read: connection reset by peer",
    "truncated transfer": "error pulling image configuration: unexpected EOF",
    "i/o timeout": "dial tcp 99.84.0.1:443: i/o timeout",
    "tls handshake": "net/http: TLS handshake timeout",
    deadline:
      "context deadline exceeded (Client.Timeout exceeded while awaiting headers)",
  };
  for (const [label, text] of Object.entries(transient)) {
    assert.equal(classify(text), "transient", `${label} should be retryable`);
  }
});

test("classifies allowlist and rate-limit failures as fatal", () => {
  assert.equal(
    classify(
      "Get https://public.ecr.aws/v2/supabase/postgres/blobs/sha256:ab: 403 Host not in allowlist",
    ),
    "policy",
  );
  assert.equal(classify("error pulling image: denied by policy"), "policy");
  assert.equal(
    classify(
      "toomanyrequests: You have reached your pull rate limit. Increase the limit",
    ),
    "ratelimit",
  );
  assert.equal(
    classify("Error response from daemon: Rate exceeded"),
    "ratelimit",
  );
});

test("a blocked PostHog telemetry call is NOT a policy failure", () => {
  // The single subtlest correctness risk in this code. The Supabase CLI's telemetry call is
  // rejected with the IDENTICAL "403 Host not in allowlist" wording as a blocked image pull, but
  // it is harmless — it was the red herring in the original incident diagnosis. A classifier that
  // matched it would abort bringup on noise, i.e. exactly invert the fix.
  assert.equal(
    classify(
      "posthog: Post https://us.i.posthog.com/batch/: 403 Host not in allowlist",
    ),
    "unknown",
    "telemetry noise alone must not be classified as a fatal policy failure",
  );

  // ...and it must not mask a real transient failure that appears alongside it, which is the
  // exact log the incident produced.
  assert.equal(
    classify(
      [
        "posthog: Post https://us.i.posthog.com/batch/: 403 Host not in allowlist",
        "failed to pull supabase/postgres: 503 Service Unavailable",
      ].join("\n"),
    ),
    "transient",
  );
});

test("fatal classes win over transient noise in the same log", () => {
  // A blocked pull usually ALSO logs a 5xx or a reset as the connection dies. Matching transient
  // first would retry an unfixable misconfiguration to exhaustion and still fail.
  assert.equal(
    classify(
      [
        "Host not in allowlist: public.ecr.aws",
        "503 Service Unavailable during teardown",
      ].join("\n"),
    ),
    "policy",
  );
  assert.equal(
    classify(
      ["toomanyrequests: pull rate limit", "connection reset by peer"].join(
        "\n",
      ),
    ),
    "ratelimit",
  );
});

test("incidental digits in pull output are not read as HTTP statuses", () => {
  // Regression: the patterns were once bare `\b429\b` / `\b50[234]\b`. `.` is a word boundary, so
  // they matched Docker's progress lines AND Supabase image tags — and since `ratelimit` is
  // fail-fast and tested before `transient`, one incidental number turned a retryable CDN outage
  // into an immediate abort telling the user to add Docker Hub credentials that cannot help.
  // gotrue was at v2.193.0 when this was written, so v2.429.0 is a matter of time, not fiction.
  assert.equal(
    classify(
      [
        "v2.429.0: Pulling from supabase/gotrue",
        "failed to pull: 503 Service Unavailable",
      ].join("\n"),
    ),
    "transient",
  );
  assert.equal(
    classify(
      [
        "a1b2: Downloading 429.5MB/1.2GB",
        "read tcp: connection reset by peer",
      ].join("\n"),
    ),
    "transient",
  );
  assert.equal(
    classify(
      [
        "v2.502.1: Pulling from supabase/realtime",
        "error setting rlimit type 7: operation not permitted",
      ].join("\n"),
    ),
    "deterministic",
  );
  // Real HTTP context must still be recognised when the phrase form is absent.
  assert.equal(classify("received unexpected HTTP status 429"), "ratelimit");
  assert.equal(classify("registry responded with status: 503"), "transient");
});

test("a bare registry 403 is retryable; only the proxy's allowlist marker is fatal", () => {
  // ECR Public redirects blobs to short-lived presigned CloudFront URLs. On the ~1GB postgres
  // image — precisely this feature's workload — a slow pull can outlive the signature and get a
  // 403 that IS retryable. Matching bare `403 Forbidden` as a policy failure aborted on it and
  // told the user to widen a network policy that was already correct.
  assert.equal(
    classify(
      "unexpected status from GET request to https://d123.cloudfront.net/v2/blob: 403 Forbidden",
    ),
    "unknown",
    "a bare 403 must not be treated as a fatal allowlist rejection",
  );
  assert.equal(
    classify("Get https://public.ecr.aws/v2/: 403 Host not in allowlist"),
    "policy",
    "the proxy's own marker must still be fatal",
  );
});

test("classification survives a realistically large capture", () => {
  // Regression for a silent, size-dependent failure: the tests were `printf ... | grep -q`, and
  // grep -q exits at the first match, SIGPIPEing the printf behind it. Under the callers'
  // `set -o pipefail` the pipeline then reports 141 and the matching branch is SKIPPED. Below
  // ~64KiB it never reproduces, and every real `supabase start` log is far bigger — so the
  // fail-fast half degraded to `unknown` exactly where it mattered. Small fixtures cannot catch
  // this; the size is the test.
  const noise = "a1b2c3d4: Downloading [====>   ] 128.5MB/1.2GB\n".repeat(8000);
  assert.ok(
    noise.length > 300_000,
    "fixture must exceed the ~64KiB SIGPIPE threshold",
  );
  assert.equal(
    classify(
      `Get https://public.ecr.aws/v2/: 403 Host not in allowlist\n${noise}`,
    ),
    "policy",
  );
  assert.equal(
    classify(`${noise}\ntoomanyrequests: pull rate limit exceeded`),
    "ratelimit",
  );
  assert.equal(
    classify(`${noise}\nfailed to pull: 503 Service Unavailable`),
    "transient",
  );
});

test("deterministic local failures are fatal rather than retried", () => {
  // Each of these already has a row in CLOUD_SANDBOX.md's symptom table. Retrying one just reruns
  // a ~90s start to reach the same error and then reports "no known pattern" — losing a diagnosis
  // the repo already had written down.
  for (const [label, text] of Object.entries({
    "edge-runtime rlimit":
      "failed to start docker container: error setting rlimit type 7: operation not permitted",
    "port conflict": "Error starting userland proxy: port is already allocated",
    "dockerd down":
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
    "poisoned volume": "FATAL: database files are incompatible with server",
  })) {
    assert.equal(classify(text), "deterministic", label);
  }
});

test("unrecognised output and a missing capture file fall back to unknown", () => {
  assert.equal(classify("something nobody has ever seen before"), "unknown");
  assert.equal(classify(""), "unknown");
  assert.equal(
    bash("cs_classify_failure /nonexistent/path").stdout.trim(),
    "unknown",
  );
  assert.equal(bash("cs_classify_failure").stdout.trim(), "unknown");
});

test("every class carries a non-empty, actionable hint", () => {
  // `deterministic` and `dependencies` are listed here too. Both were previously absent, and
  // `dependencies` is the one that most needs pinning: it is the only class NOT produced by
  // cs_classify_failure — cloud-sandbox-up.sh raises it by name at the call site — so a rename
  // on either side falls through to the `*)` arm and the sentinel silently degrades to "the
  // failure did not match any known pattern", with nothing red.
  for (const cls of [
    "policy",
    "ratelimit",
    "transient",
    "deterministic",
    "toolchain",
    "dependencies",
    "wat",
  ]) {
    const hint = bash(`cs_failure_hint ${cls}`).stdout.trim();
    assert.ok(hint.length > 20, `${cls} hint is too short to act on: ${hint}`);
  }
  // The fixable classes must name the actual remedy — this string is what lands in
  // .cloud-sandbox-up.failed and is the only thing a polling agent reads.
  assert.match(
    bash("cs_failure_hint policy").stdout,
    /Network = Full|public\.ecr\.aws/,
  );
  assert.match(bash("cs_failure_hint ratelimit").stdout, /DOCKERHUB_TOKEN/);
  assert.match(bash("cs_failure_hint dependencies").stdout, /npm ci/);
  // The class name must survive verbatim from the call site into the hint lookup.
  const up = readFileSync(
    fileURLToPath(new URL("../../cloud-sandbox-up.sh", import.meta.url)),
    "utf8",
  );
  assert.match(
    up,
    /cs_failure_hint dependencies/,
    "cloud-sandbox-up.sh must raise the `dependencies` class by that exact name",
  );
});

// ─── cs_retry ─────────────────────────────────────────────────────────────────────────────

// The retried command runs on the left-hand side of a pipeline (it is piped into `tee`), so it
// executes in a SUBSHELL and cannot report attempt counts through a shell variable. Count via a
// file instead — the same reason the production caller keeps no state in the retried command.
function retryHarness({ script, env = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-retry-"));
  const counter = path.join(dir, "attempts");
  writeFileSync(counter, "0");
  try {
    // A private TMPDIR per run is what makes `leaked` below meaningful: cs_retry mktemps its
    // per-attempt capture file there, so anything left over is a leak this run caused.
    const res = bash(
      `COUNTER='${counter}'
       bump() { printf '%s' "$(( $(cat "$COUNTER") + 1 ))" >"$COUNTER"; cat "$COUNTER"; }
       ${script}`,
      { TMPDIR: dir, ...env },
    );
    const leaked = readdirSync(dir).filter((f) =>
      f.startsWith("cloud-sandbox-retry."),
    );
    return { res, attempts: Number(readFileSync(counter, "utf8")), leaked };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("retries a transient failure and reports success once it recovers", () => {
  const { res, attempts } = retryHarness({
    script: `
      flaky() {
        n=$(bump)
        [ "$n" -lt 3 ] && { echo "503 Service Unavailable"; return 1; }
        echo "Started supabase local development setup."; return 0
      }
      cs_retry "flaky" "" flaky >/dev/null 2>&1
      echo "rc=$? class=[\${CS_RETRY_CLASS}]"`,
  });
  assert.equal(attempts, 3, "should have kept trying until it recovered");
  assert.match(res.stdout, /rc=0/);
  // A recovered call must not leave failure state behind for the caller to misread as a failure.
  assert.match(res.stdout, /class=\[\]/, "class must be cleared on success");
});

test("stops at the attempt budget when the failure never clears", () => {
  const { res, attempts } = retryHarness({
    script: `
      never() { bump >/dev/null; echo "connection reset by peer"; return 1; }
      cs_retry "never" "" never >/dev/null 2>&1
      echo "rc=$? class=\${CS_RETRY_CLASS}"`,
  });
  assert.equal(attempts, 3, "default budget is 3 attempts");
  assert.match(res.stdout, /rc=1/);
  assert.match(res.stdout, /class=transient/);
});

test("FRAPP_SANDBOX_START_RETRIES changes the budget", () => {
  const { attempts } = retryHarness({
    script: `never() { bump >/dev/null; echo 503; return 1; }
             cs_retry "never" "" never >/dev/null 2>&1`,
    env: { FRAPP_SANDBOX_START_RETRIES: "5" },
  });
  assert.equal(attempts, 5);
});

test("fatal classifications fail fast after exactly one attempt", () => {
  // This is the "no wasted retries" half of the fix. Each of these costs ~90s per wasted attempt
  // against a problem no retry can solve.
  for (const [label, output, expected] of [
    ["allowlist", "403 Host not in allowlist", "policy"],
    ["rate limit", "toomanyrequests: rate exceeded", "ratelimit"],
  ]) {
    const { res, attempts } = retryHarness({
      script: `fatal() { bump >/dev/null; echo "${output}"; return 1; }
               cs_retry "fatal" "" fatal >/dev/null 2>&1
               echo "class=\${CS_RETRY_CLASS}|hint=\${CS_RETRY_HINT}"`,
    });
    assert.equal(attempts, 1, `${label} must not be retried`);
    assert.match(
      res.stdout,
      new RegExp(`class=${expected}\\|hint=.+`),
      `${label} must carry a hint`,
    );
  }
});

test("the per-attempt capture file never leaks, on any return path", () => {
  // It is mktemp'd once per cs_retry call; the SessionStart hook relaunches bringup on every
  // resume, so a persistently failing environment would otherwise drip one orphan per cycle onto
  // a disk shared with the Docker image cache.
  const cases = {
    success: `ok() { bump >/dev/null; echo fine; return 0; }; cs_retry x "" ok`,
    "budget exhausted": `t() { bump >/dev/null; echo "503 Service Unavailable"; return 1; }; cs_retry x "" t`,
    "fatal policy": `p() { bump >/dev/null; echo "Host not in allowlist"; return 1; }; cs_retry x "" p`,
    "fatal deterministic": `d() { bump >/dev/null; echo "error setting rlimit type 7"; return 1; }; cs_retry x "" d`,
    toolchain: `b() { bump >/dev/null; echo nope; return 127; }; cs_retry x "" b`,
  };
  for (const [label, script] of Object.entries(cases)) {
    const { leaked } = retryHarness({ script: `${script} >/dev/null 2>&1` });
    assert.deepEqual(
      leaked,
      [],
      `${label} leaked a capture file: ${leaked.join(", ")}`,
    );
  }
});

test("an unusable TMPDIR fails loudly instead of silently classifying everything unknown", () => {
  // Unchecked, the empty mktemp result made cs_classify_failure hit its unreadable-file guard and
  // answer `unknown` for every attempt — so policy and ratelimit stopped being detected at all and
  // were retried to exhaustion, while `tee ''` sprayed errors naming the wrong file.
  const res = bash(
    `p() { echo "Host not in allowlist"; return 1; }
     cs_retry x "" p >/dev/null
     echo "rc=$? class=\${CS_RETRY_CLASS}"`,
    { TMPDIR: "/nonexistent-tmpdir-for-tests" },
  );
  assert.match(res.stdout, /rc=1/);
  assert.match(
    res.stdout,
    /class=toolchain/,
    "must report the real problem, not misclassify",
  );
  assert.match(res.stderr, /cannot create a capture file/);
});

test("a toolchain failure (exit 127) is never retried", () => {
  // cs_supabase returns 127 for its own install failures — a bad version pin or a blocked npm
  // registry. Retrying only repeats a failing `npm install`. Note the fixture ALSO contains a 503,
  // to prove the exit code is checked before the output is classified.
  const { res, attempts } = retryHarness({
    script: `broken() { bump >/dev/null; echo "503 Service Unavailable"; return 127; }
             cs_retry "broken" "" broken >/dev/null 2>&1
             echo "rc=$? class=\${CS_RETRY_CLASS}"`,
  });
  assert.equal(attempts, 1);
  assert.match(res.stdout, /rc=127/);
  assert.match(res.stdout, /class=toolchain/);
});

test("the cleanup command runs between attempts, but not after the last one", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-cleanup-"));
  const marks = path.join(dir, "cleanups");
  writeFileSync(marks, "");
  try {
    // Without this, a retried `supabase start` runs over the half-created containers the failed
    // attempt left behind and fails for a different reason than the one being retried.
    bash(`stub_cleanup() { printf 'x' >>'${marks}'; }
          never() { echo "503 Service Unavailable"; return 1; }
          cs_retry "never" "stub_cleanup" never >/dev/null 2>&1`);
    assert.equal(
      readFileSync(marks, "utf8").length,
      2,
      "3 attempts means 2 gaps — a cleanup after the final failure would be wasted work",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-integer retry knobs fall back to defaults instead of aborting the shell", () => {
  // Both knobs feed $(( )), which kills the shell on a non-integer — that would turn a tuning
  // variable into a way to break bringup outright.
  const res = bash(
    "echo attempts=$CS_RETRY_ATTEMPTS delay=$CS_RETRY_BASE_DELAY",
    {
      FRAPP_SANDBOX_START_RETRIES: "abc",
      FRAPP_SANDBOX_RETRY_BASE_DELAY: "-5s",
    },
  );
  assert.equal(res.status, 0, `sourcing should not fail: ${res.stderr}`);
  assert.match(res.stdout, /attempts=3 delay=10/);

  const zero = bash("echo attempts=$CS_RETRY_ATTEMPTS", {
    FRAPP_SANDBOX_START_RETRIES: "0",
  });
  assert.match(
    zero.stdout,
    /attempts=1/,
    "0 attempts would run nothing at all; floor it at 1",
  );
});

// ─── wiring the call sites depend on ──────────────────────────────────────────────────────

test("CLI telemetry is disabled by sourcing the lib", () => {
  // Seeded with CONTRADICTING values, because merely reading them back proves nothing: if the
  // parent environment already had them set, the assertion would pass with the exports deleted.
  const res = bash("echo t=$SUPABASE_TELEMETRY_DISABLED d=$DO_NOT_TRACK", {
    SUPABASE_TELEMETRY_DISABLED: "0",
    DO_NOT_TRACK: "0",
  });
  assert.match(
    res.stdout,
    /t=1 d=1/,
    "the lib must override, not merely inherit",
  );

  // And they must be exported, not just set — cs_supabase's `npm install` is a child process.
  const exported = bash(
    "bash -c 'echo child=$SUPABASE_TELEMETRY_DISABLED$DO_NOT_TRACK'",
  );
  assert.match(exported.stdout, /child=11/);
});

test("retry knobs are sanitised, including the shapes a digit test lets through", () => {
  // "08" is all digits, so `*[!0-9]*` accepts it — and then `$(( ))` reads it as OCTAL and raises
  // "value too great for base", which aborts the enclosing AND-OR list. At the real call site that
  // means `cs_retry ... || fail ...` never runs its `fail`, and bringup marches on to `db push`
  // against a stack that never started.
  const octal = bash("echo d=$CS_RETRY_BASE_DELAY", {
    FRAPP_SANDBOX_RETRY_BASE_DELAY: "08",
  });
  assert.equal(octal.status, 0, `sourcing must not fail: ${octal.stderr}`);
  assert.match(octal.stdout, /d=8/, "08 must be 8, not an octal parse error");
  assert.match(
    bash("echo d=$CS_RETRY_BASE_DELAY", {
      FRAPP_SANDBOX_RETRY_BASE_DELAY: "030",
    }).stdout,
    /d=30/,
  );

  // Out-of-range values must not survive: past ~61 attempts the backoff shift overflows int64 to a
  // NEGATIVE delay that a `-gt 300` cap cannot catch, and `sleep -692...` then fails outright.
  assert.match(
    bash("echo a=$CS_RETRY_ATTEMPTS", { FRAPP_SANDBOX_START_RETRIES: "999" })
      .stdout,
    /a=3/,
  );
  assert.match(
    bash("echo a=$CS_RETRY_ATTEMPTS", { FRAPP_SANDBOX_START_RETRIES: "08" })
      .stdout,
    /a=8/,
  );

  // The backoff itself must never emit a non-positive sleep, whatever the attempt number.
  const sweep = bash(
    `for attempt in $(seq 1 70); do
       if [ "$attempt" -gt 16 ]; then d=300; else d=$((CS_RETRY_BASE_DELAY * (1 << (attempt - 1)))); [ "$d" -gt 300 ] && d=300; fi
       [ "$d" -lt 0 ] && echo "NEGATIVE at $attempt"
     done; echo swept`,
    { FRAPP_SANDBOX_RETRY_BASE_DELAY: "10" },
  );
  assert.doesNotMatch(sweep.stdout, /NEGATIVE/, sweep.stdout);
  assert.match(sweep.stdout, /swept/);
});

test("both call sites pass the start args unquoted", () => {
  // Quoting $CS_SUPABASE_START_ARGS collapses `-x edge-runtime` into a single argument, silently
  // un-doing the exclusion — which aborts `supabase start` outright in this sandbox. It is a
  // one-character regression with no local symptom, so pin it here.
  //
  // Matched against whitespace-normalised source rather than the raw text: an earlier version of
  // this assertion keyed on exact layout, so wrapping the call across lines with a `\` — which
  // `bash -n` accepts and which changes nothing — failed the test, while the thing it exists to
  // catch is a pair of quote characters.
  for (const script of ["cloud-sandbox-up.sh", "cloud-sandbox-setup.sh"]) {
    const raw = readFileSync(
      fileURLToPath(new URL(`../../${script}`, import.meta.url)),
      "utf8",
    );
    const flat = raw.replace(/\\\n/g, " ").replace(/[ \t]+/g, " ");

    assert.match(
      flat,
      /# shellcheck disable=SC2086\ncs_retry "[^"]+" "cs_supabase stop" cs_supabase start \$CS_SUPABASE_START_ARGS(\s|$)/,
      `${script}: 'supabase start' must go through cs_retry, with a stop between attempts, an ` +
        `unquoted $CS_SUPABASE_START_ARGS, and its SC2086 directive kept`,
    );
    // The inverse, so the check cannot pass on a file that ALSO quotes it somewhere.
    assert.doesNotMatch(
      flat,
      /"\$CS_SUPABASE_START_ARGS"/,
      `${script}: args must never be quoted`,
    );
  }
});

// ─── cs_node_deps_ok / cs_verify_node_deps ────────────────────────────────────────────────

// Builds a synthetic repo root: a package.json plus a node_modules/.bin/turbo that is a plain
// shell script, not the real binary. No network and no `npm install` — `npm ls --depth=0` reads
// the tree's metadata, so a fixture tree exercises it exactly as a real one would, and the
// turbo probe only cares whether the file runs.
function depsFixture({ turbo = "ok", declaresMissingDep = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "cs-deps-"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "deps-fixture",
      private: true,
      ...(declaresMissingDep
        ? { dependencies: { "not-installed-on-purpose": "^1.0.0" } }
        : {}),
    }),
  );
  mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
  const bin = path.join(dir, "node_modules", ".bin", "turbo");
  if (turbo !== "absent") {
    // "broken" is present, executable, and exits non-zero — the case a `-x` stat cannot see.
    writeFileSync(
      bin,
      turbo === "ok" ? "#!/bin/sh\necho 9.9.9\n" : "#!/bin/sh\nexit 1\n",
    );
    chmodSync(bin, 0o755);
  }
  return dir;
}

// Returns { status, why } for one fixture. `set -uo pipefail` (no -e) means a non-zero
// cs_node_deps_ok does not abort the shell, which is what the production caller relies on.
function depsCheck(dir) {
  const res = bash(
    `cs_node_deps_ok '${dir}'; printf '%s|%s' "$?" "\${CS_NODE_DEPS_WHY}"`,
  );
  const [status, why] = res.stdout.trim().split("|");
  return { status: Number(status), why };
}

test("a usable tree passes, and reports no reason", () => {
  const dir = depsFixture();
  try {
    assert.deepEqual(depsCheck(dir), { status: 0, why: "" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("turbo absent, and turbo present-but-not-running, are both the fatal signal", () => {
  // The second case is the whole reason the check RUNS turbo instead of stat-ing it: `-x`
  // follows symlinks, so it already covers absent and dangling, but not a target that exists
  // and does not work. Losing the `--version` call would silently pass a broken toolchain.
  for (const turbo of ["absent", "broken"]) {
    const dir = depsFixture({ turbo });
    try {
      assert.deepEqual(
        depsCheck(dir),
        { status: 1, why: "turbo" },
        `turbo=${turbo}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("a declared dependency that is not installed is the half-populated signal", () => {
  // AC #4 of #1631: a `-d node_modules` test passes on a tree the harness killed mid-`npm ci`,
  // so npm — the only thing that knows what was declared — is what sees the gap.
  const dir = depsFixture({ declaresMissingDep: true });
  try {
    assert.deepEqual(depsCheck(dir), { status: 1, why: "incomplete" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the two signals get different severities, and the softer one does not fail bringup", () => {
  // This asymmetry is load-bearing. cloud-sandbox-up.sh turns a non-zero return into fail(),
  // which writes .cloud-sandbox-up.failed instead of .done. A missing turbo genuinely means no
  // check-types, no lint and no workspace test, so it earns that. `npm ls` disagreeing while
  // turbo runs is npm's stricter opinion about a tree that may well work, and letting it fail a
  // session would make this precondition more dangerous than the bug it guards against.
  const incomplete = depsFixture({ declaresMissingDep: true });
  const fatal = depsFixture({ turbo: "absent" });
  try {
    const soft = bash(`cs_verify_node_deps '${incomplete}'; printf '%s' "$?"`);
    assert.equal(
      soft.stdout.trim(),
      "0",
      "an incomplete tree must warn, not fail bringup",
    );
    assert.match(soft.stderr, /missing declared dependency/);

    const hard = bash(`cs_verify_node_deps '${fatal}'; printf '%s' "$?"`);
    assert.equal(
      hard.stdout.trim(),
      "1",
      "an unusable turbo must fail bringup",
    );
  } finally {
    rmSync(incomplete, { recursive: true, force: true });
    rmSync(fatal, { recursive: true, force: true });
  }
});

test("bringup never writes to node_modules, and checks it only after the stack is up", () => {
  // Two properties that are one-line regressions with no local symptom, so pin both.
  //
  // 1. No install from bringup. It runs backgrounded via `nohup` while the agent is already
  //    working, so an `npm ci` here races the session over one node_modules with no lock — and
  //    `npm ci` DELETES the tree first, which turns a merely incomplete tree into a destroyed
  //    one whenever the install then fails.
  // 2. The check runs LAST. npm and Docker fail independently; gating the stack on npm means a
  //    blocked npm registry costs the database, and this repo's own `policy` remedy allowlists
  //    ECR and CloudFront without registry.npmjs.org, so that configuration is reachable.
  // Strip comment lines and cs_log strings before matching. Both deliberately MENTION `npm ci`
  // — the whole point is telling the reader to run it — so a naive grep for the words matches
  // the remedy text and can never fail, which is a test that only looks like one.
  const executable = (src) =>
    src
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .map((l) => l.replace(/cs_log\s+"[^"]*"/g, "cs_log <msg>"))
      .join("\n");

  const up = readFileSync(
    fileURLToPath(new URL("../../cloud-sandbox-up.sh", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(
    executable(up),
    /\bnpm (ci|install)\b/,
    "bringup must not install dependencies — the session owns its node_modules",
  );

  const lib = readFileSync(
    fileURLToPath(
      new URL("../../lib/cloud-sandbox-common.sh", import.meta.url),
    ),
    "utf8",
  );
  const verifyBody = lib.slice(lib.indexOf("cs_verify_node_deps()"));
  assert.doesNotMatch(
    executable(verifyBody.slice(0, verifyBody.indexOf("\n}\n"))),
    /\bnpm (ci|install)\b/,
    "cs_verify_node_deps must detect only",
  );

  assert.ok(
    up.indexOf("cs_verify_node_deps") >
      up.indexOf("frapp_load_chapter_directory"),
    "the toolchain check must run after the stack is up, so a broken npm never costs the database",
  );
  assert.ok(
    up.indexOf("cs_verify_node_deps") < up.indexOf('>"$DONE_SENTINEL"'),
    "...but before the success sentinel, so .done never lies about the toolchain",
  );
});
