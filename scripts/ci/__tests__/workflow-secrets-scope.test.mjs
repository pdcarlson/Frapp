import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2518: every secret this repo holds must be reachable only by code merged to
// `main`.
//
// For a same-repository pull request, and for a push or dispatch on any
// branch, GitHub runs the workflow definitions from that branch. A repository
// secret is therefore readable by anyone who can push a branch: they edit a
// workflow, or add one. Agent sessions push branches, and they read public,
// untrusted issue text. The boundary that holds is a GitHub ENVIRONMENT whose
// deployment-branch policy admits `main` only. GitHub matches that policy
// against the run's ref and releases the environment's secrets only to a job
// that passed it. So the secrets belong there, and every consumer names one of
// those environments. The owner's #2583 set the policies and moved the secrets;
// the live state is in AGENT_INFRA.md § No repository secrets.
//
// This file cannot check the live settings (the policies, and whether the
// repository-level copies are gone). They are an owner step, and the doc
// below says how to verify them. What it pins is the half that lives in the
// repo, without which the owner's move would break a consumer or tempt a
// secret back into repository scope:
//
//   A. Nothing a pull request triggers references a secret. "A pull request"
//      means every trigger that runs definitions the PR's branch controls, not
//      only `pull_request` (PR_TRIGGERS).
//   B. Every job that references a secret names one of CREDENTIAL_ENVIRONMENTS
//      as a literal. A computed name could select an unprotected environment,
//      and a workflow that names an environment that doesn't exist makes GitHub
//      create it with no rules. One exception, for the shared deploy job
//      (`_deploy.yml`, #2804): `${{ inputs.environment }}` in a workflow whose
//      only trigger is `workflow_call`, when every caller in this repo passes
//      a literal CREDENTIAL_ENVIRONMENTS name, so the name is still a literal,
//      one call away.
//   C. No secret is referenced outside a job. A workflow-level `env:` may read
//      `secrets` and hands the value to every job, and no environment can gate
//      it, because environment secrets exist only inside a job that named one.
//   D. A job that references a secret runs third-party actions only by commit
//      SHA, including inside the local composite actions it calls (#2647). A
//      tag or branch is the publisher's to move, and the moved code would run
//      with the job's credentials without any review in this repo seeing it.
//
// "References a secret" includes the dynamic forms, `secrets['NAME']` and
// `toJSON(secrets)`, which dump what a name would have picked out.
//
// `secrets.GITHUB_TOKEN` is exempt: it is the job's own token, minted per run,
// scoped by `permissions:`, and not a stored secret.
//
// Environments and their policies: docs/internal/ci-cd/AGENT_INFRA.md
// § GitHub environments and bootstrap secrets.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOWS = join(REPO, ".github", "workflows");

/** Owners whose actions are GitHub's own, and so held to no SHA rule here. */
const FIRST_PARTY_OWNERS = ["actions", "github"];

/**
 * The environments secrets may live in. Each admits `main` only (the owner's
 * #2583, set 2026-09-23). A new one gets that rule before its first secret.
 */
export const CREDENTIAL_ENVIRONMENTS = ["automation", "production", "production-backup", "staging"];

// Every trigger whose run executes workflow definitions a PR's branch
// controls: its merge ref (the review events run on it too), or, for
// `merge_group`, the queue branch that carries the PR's changes.
// `pull_request_target` runs the base branch's copy, but a job there that
// checks out the head is the classic injection, so it holds no secret either.
const PR_TRIGGERS = [
  "pull_request",
  "pull_request_target",
  "pull_request_review",
  "pull_request_review_comment",
  "merge_group",
];

/**
 * Comment-only lines blanked, so prose about a secret is not a reference to one.
 * Trailing comments are kept: stripping `\s+#.*` would also cut
 * `echo "#1" ${{ secrets.X }}` and hide the reference. Key parsers below
 * tolerate a trailing comment instead.
 */
function codeLines(text) {
  return text.split("\n").map((l) => (/^\s*#/.test(l) ? "" : l));
}

const TRAILING_COMMENT = /\s+#.*$/;

/** The workflow's trigger names, from any of `on: x`, `on: [x, y]` or an `on:` block. */
function triggersOf(lines) {
  const at = lines.findIndex((l) => /^on:/.test(l));
  assert.ok(at !== -1, "every workflow has a top-level on:");
  const inline = lines[at].replace(/^on:\s*/, "").replace(TRAILING_COMMENT, "").trim();
  if (inline) return inline.replace(/[[\]]/g, "").split(",").map((t) => t.trim()).filter(Boolean);
  const triggers = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;
    const m = line.match(/^ {2}([a-z_]+):?\s*$/) ?? line.match(/^ {2}([a-z_]+):/);
    if (m) triggers.push(m[1]);
  }
  return triggers;
}

/** `[{ id, body }]` for every job, where `body` is its lines below the key. */
function jobsOf(lines) {
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.ok(at !== -1, "every workflow has a top-level jobs:");
  const jobs = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;
    const key = line.replace(TRAILING_COMMENT, "").match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (key) jobs.push({ id: key[1], body: [] });
    else if (jobs.length > 0) jobs.at(-1).body.push(line);
  }
  return jobs;
}

/** The environment a job names: `{ name, literal }`, or null. */
function environmentOf(body) {
  const at = body.findIndex((l) => /^ {4}environment:/.test(l));
  if (at === -1) return null;
  const inline = body[at].replace(/^ {4}environment:\s*/, "").replace(TRAILING_COMMENT, "").trim();
  const raw =
    inline ||
    body
      .slice(at + 1)
      .find((l) => /^ {6}name:/.test(l))
      ?.replace(/^ {6}name:\s*/, "")
      .replace(TRAILING_COMMENT, "")
      .trim();
  if (!raw) return { name: null, literal: false };
  const name = raw.replace(/^["']|["']$/g, "");
  return { name, literal: !name.includes("${{") };
}

function secretsOf(body) {
  const names = new Set();
  for (const line of body) {
    // The `secrets` context, not a word ending in it: `scan-secrets.mjs` is a file.
    for (const m of line.matchAll(/(?<![\w.-])secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (m[1] !== "GITHUB_TOKEN") names.add(m[1]);
    }
    // `secrets['X']` and `toJSON(secrets)` name no secret, and can read any.
    if (/(?<![\w.-])secrets\s*\[/.test(line) || /\(\s*secrets\s*\)/.test(line)) names.add("(dynamic)");
    if (/^\s+secrets:\s*inherit\s*$/.test(line)) names.add("(inherit)");
  }
  return [...names];
}

/** The lines above `jobs:`: triggers, workflow-level `env:`, `concurrency:`. */
function preambleOf(lines) {
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  return at === -1 ? lines : lines.slice(0, at);
}

/**
 * The workflow file a job calls, or null: its job-level `uses:`, with a
 * trailing comment and quotes removed, as `./.github/workflows/<file>` or
 * `<owner>/<repo>/.github/workflows/<file>@<ref>`. The second form is read as
 * a call to this repo's file of that name whatever the owner, which errs
 * toward holding the caller to the rules: a caller the parser missed would
 * escape them (#2804 review).
 */
function reusableCallOf(body) {
  for (const line of body) {
    const m = line.replace(TRAILING_COMMENT, "").match(/^ {4}uses:\s*["']?([^"'\s]+)["']?\s*$/);
    if (!m) continue;
    const call = m[1].match(/^(?:\.|[^/\s]+\/[^/\s]+)\/\.github\/workflows\/([^@/\s]+)(?:@\S+)?$/);
    return call ? call[1] : null;
  }
  return null;
}

/** The value a calling job passes for `key` under its `with:`, or null. */
function withValueOf(body, key) {
  const at = body.findIndex((l) => /^ {4}with:\s*$/.test(l));
  if (at === -1) return null;
  for (const line of body.slice(at + 1)) {
    if (/^ {0,5}\S/.test(line)) break;
    const m = line.replace(TRAILING_COMMENT, "").match(new RegExp(`^ {6}${key}:\\s*(.*)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

/** Every job in the repo that calls `file`, as `{ at, body, triggers }`. */
function callersOf(file) {
  return workflows.flatMap((other) =>
    other.jobs
      .filter((j) => reusableCallOf(j.body) === file)
      .map((j) => ({ at: `${other.name} / ${j.id}`, body: j.body, triggers: other.triggers })),
  );
}

/**
 * Why a called workflow's `${{ inputs.environment }}` is NOT held to a literal
 * main-only environment, or [] when it is: it must be callable only, and every
 * caller in this repo must pass a literal from CREDENTIAL_ENVIRONMENTS and run
 * on no pull-request trigger (rule A's reach, one call away).
 */
function inputEnvironmentProblems(wf) {
  const problems = [];
  if (wf.triggers.join(",") !== "workflow_call") {
    problems.push(`its triggers are ${wf.triggers.join(", ")}, not workflow_call alone`);
  }
  const callers = callersOf(wf.name);
  if (callers.length === 0) problems.push("no workflow in this repo calls it");
  for (const { at, body, triggers } of callers) {
    const pr = triggers.filter((t) => PR_TRIGGERS.includes(t));
    if (pr.length > 0) problems.push(`${at} runs on ${pr.join(", ")}`);
    const passed = withValueOf(body, "environment");
    if (!passed || passed.includes("${{") || !CREDENTIAL_ENVIRONMENTS.includes(passed)) {
      problems.push(`${at} passes environment ${passed ? `"${passed}"` : "(none)"}, not a literal main-only environment`);
    }
  }
  return problems;
}

/**
 * Every `uses:` value in these lines: a step's (`- uses:`), a job's, or one in a
 * flow mapping (`- { uses: x@v1 }`). A block scalar (`uses: >-`) yields `>-`,
 * which no rule treats as pinned, so it fails loudly rather than being skipped.
 */
function usesOf(lines) {
  return lines.flatMap((l) =>
    [...l.replace(TRAILING_COMMENT, "").matchAll(/(?:^|[\s{,])uses:\s*["']?([^"'\s,}]+)/g)].map((m) => m[1]),
  );
}

/** A Docker action's `runs.image`, when it names a registry image rather than a Dockerfile. */
function dockerImagesOf(lines) {
  return lines
    .map((l) => l.replace(TRAILING_COMMENT, "").match(/^\s+image:\s*["']?(docker:\/\/[^"'\s]+)/)?.[1])
    .filter(Boolean);
}

/**
 * How a `uses:` value is held: `local` (this repo, reviewed here), `first-party`
 * (GitHub's own), or `pinned` / `unpinned` for a third party. A third party is
 * pinned only by a full commit SHA, or, for a container, an image digest.
 */
function pinningOf(ref) {
  if (ref.startsWith("./")) return "local";
  if (ref.startsWith("docker://")) return /@sha256:[0-9a-f]{64}$/.test(ref) ? "pinned" : "unpinned";
  const [path, version = ""] = ref.split("@");
  if (FIRST_PARTY_OWNERS.includes(path.split("/")[0])) return "first-party";
  return /^[0-9a-f]{40}$/.test(version) ? "pinned" : "unpinned";
}

/**
 * The non-local refs a job runs: its `uses:` values, following every local
 * action it calls (any `./<path>` except a reusable workflow, which rule D
 * checks as its own jobs) into that action's own steps and Docker image,
 * however deep. `via` names the local action a ref was reached through.
 */
function actionRefsOf(lines, via = "", seen = new Set()) {
  const refs = [];
  for (const ref of usesOf(lines)) {
    if (ref.startsWith("./.github/workflows/")) continue;
    if (ref.startsWith("./")) {
      const dir = ref.replace(/\/+$/, "");
      if (seen.has(dir)) continue;
      seen.add(dir);
      const file = ["action.yml", "action.yaml"]
        .map((f) => join(REPO, dir, f))
        .find((f) => existsSync(f));
      assert.ok(file, `${ref} names a local action with no action.yml`);
      const action = codeLines(readFileSync(file, "utf8"));
      for (const image of dockerImagesOf(action)) refs.push({ ref: image, via: ` (via ${ref})` });
      refs.push(...actionRefsOf(action, ` (via ${ref})`, seen));
    } else {
      refs.push({ ref, via });
    }
  }
  return refs;
}

const workflows = readdirSync(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort()
  .map((name) => {
    const lines = codeLines(readFileSync(join(WORKFLOWS, name), "utf8"));
    return { name, triggers: triggersOf(lines), jobs: jobsOf(lines), preamble: preambleOf(lines) };
  });

const byName = new Map(workflows.map((w) => [w.name, w]));

describe("workflow secrets scope (#2518)", () => {
  it("parses the workflow set it is meant to guard", () => {
    // Non-vacuity. A parser that found no PR workflow, or no secret consumer,
    // would pass both rules below having checked nothing.
    const gate = byName.get("migration-drift-gate.yml");
    assert.ok(gate, "migration-drift-gate.yml must be parsed");
    assert.ok(gate.triggers.includes("pull_request"), "its pull_request trigger must be seen");
    assert.deepEqual(
      gate.jobs.map((j) => j.id).sort(),
      ["migration-drift", "migration-order", "migration-replay"],
    );

    const deploy = byName.get("deploy-production.yml")?.jobs.find((j) => j.id === "deploy");
    assert.ok(deploy, "deploy-production.yml's deploy job must be parsed");
    assert.ok(secretsOf(deploy.body).includes("RENDER_API_KEY"));
    assert.equal(environmentOf(deploy.body)?.name, "production");

    // The one expression-named environment rule B admits, and its caller.
    const shared = byName.get("_deploy.yml")?.jobs.find((j) => j.id === "deploy");
    assert.ok(shared, "_deploy.yml's deploy job must be parsed");
    assert.ok(secretsOf(shared.body).includes("RENDER_API_KEY"));
    assert.deepEqual(environmentOf(shared.body), { name: "${{ inputs.environment }}", literal: false });
    const caller = byName.get("deploy-staging.yml")?.jobs.find((j) => j.id === "deploy");
    assert.equal(reusableCallOf(caller.body), "_deploy.yml");
    assert.equal(withValueOf(caller.body, "environment"), "staging");
    // Rule E requires it: without it the called job reads its secrets empty.
    assert.deepEqual(secretsOf(caller.body), ["(inherit)"]);

    const publish = byName.get("migration-snapshot.yml")?.jobs.find((j) => j.id === "publish");
    assert.ok(publish, "migration-snapshot.yml's publish job must be parsed");
    assert.equal(environmentOf(publish.body)?.name, "automation");
  });

  it("A: nothing a pull request triggers references a secret", () => {
    const offenders = [];
    for (const wf of workflows) {
      if (!wf.triggers.some((t) => PR_TRIGGERS.includes(t))) continue;
      for (const job of wf.jobs) {
        const secrets = secretsOf(job.body);
        if (secrets.length > 0) offenders.push(`${wf.name} / ${job.id}: ${secrets.join(", ")}`);
        // A call reaches the called workflow's secrets without naming one here
        // (`_deploy.yml` reads its environment's own, #2804), inherit or not.
        const called = reusableCallOf(job.body);
        const reached = (byName.get(called)?.jobs ?? []).flatMap((j) => secretsOf(j.body));
        if (reached.length > 0) offenders.push(`${wf.name} / ${job.id}: calls ${called}, which reads ${[...new Set(reached)].join(", ")}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "A job in a pull_request-triggered workflow references a secret. A same-repository PR runs " +
        "its own branch's copy of the workflow, so the secret is readable from any branch. Read " +
        "what the job needs from something a main-only job published instead (the migration " +
        "gates read migration-snapshot.yml's artifact).",
    );
  });

  it("C: no secret is referenced outside a job", () => {
    const offenders = workflows
      .map((wf) => [wf.name, secretsOf(wf.preamble)])
      .filter(([, secrets]) => secrets.length > 0)
      .map(([name, secrets]) => `${name}: ${secrets.join(", ")}`);
    assert.deepEqual(
      offenders,
      [],
      "A workflow-level reference to a secret reaches every job, and no environment can gate it. " +
        "Move it into the job that needs it, which then names a main-only environment (rule B).",
    );
  });

  it("B: every job that references a secret names a main-only environment, literally", () => {
    const offenders = [];
    for (const wf of workflows) {
      for (const job of wf.jobs) {
        const secrets = secretsOf(job.body);
        if (secrets.length === 0) continue;

        // A caller of a reusable workflow cannot name an environment; the
        // called workflow's jobs do, and GitHub prefers their environment's
        // secret over the one passed in. Hold the called file to rule B.
        const called = reusableCallOf(job.body);
        if (called) {
          // A secret the caller names can only be a repository copy, since
          // the caller has no environment, and #2518 allows none. `inherit`
          // names nothing; it is what releases the environment's (rule E).
          const named = secrets.filter((s) => s !== "(inherit)");
          if (named.length > 0) {
            offenders.push(`${wf.name} / ${job.id}: names ${named.join(", ")} for ${called}, which only a repository secret could fill`);
          }
          const target = byName.get(called);
          // `_deploy.yml`'s `${{ inputs.environment }}` passes on the same
          // terms as below: callable only, every caller literal and off PRs.
          const unscoped = (target?.jobs ?? []).filter((j) => {
            const env = environmentOf(j.body);
            if (env?.literal) return !CREDENTIAL_ENVIRONMENTS.includes(env.name);
            return !(env?.name === "${{ inputs.environment }}" && inputEnvironmentProblems(target).length === 0);
          });
          if (!target || unscoped.length > 0) {
            offenders.push(`${wf.name} / ${job.id}: passes ${secrets.join(", ")} to ${called}, whose jobs do not all name a main-only environment`);
          }
          continue;
        }

        const env = environmentOf(job.body);
        if (!env) {
          offenders.push(`${wf.name} / ${job.id}: ${secrets.join(", ")} with no environment`);
        } else if (!env.literal) {
          const problems = env.name === "${{ inputs.environment }}" ? inputEnvironmentProblems(wf) : ["is not inputs.environment"];
          for (const problem of problems) offenders.push(`${wf.name} / ${job.id}: environment name is an expression, and ${problem}`);
        } else if (!CREDENTIAL_ENVIRONMENTS.includes(env.name)) {
          offenders.push(`${wf.name} / ${job.id}: environment "${env.name}" is not one of ${CREDENTIAL_ENVIRONMENTS.join(", ")}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "Every secret belongs in a GitHub environment restricted to main, so every job that reads one " +
        "must name that environment. Add `environment: { name: <one of the list>, deployment: " +
        "false }` to the job, or, for a new environment, have the owner create it with a main-only " +
        "branch policy first and then add it to CREDENTIAL_ENVIRONMENTS.",
    );
  });

  // Run 36479856561: the staging secrets read empty in `_deploy.yml`'s called
  // job, which names `environment: staging`, because the caller passed no
  // `secrets:`. GitHub releases an environment's secrets to a called job only
  // when the caller passes `secrets: inherit` (actions/runner#4453), and
  // v1.3.0's tag shows `release.yml` had lost its PAT the same way. It fails
  // safe (empty secrets), but only at run time, after merge.
  it("E: every call into a workflow that reads secrets passes `secrets: inherit`", () => {
    const offenders = [];
    let calls = 0;
    for (const wf of workflows) {
      for (const job of wf.jobs) {
        const called = reusableCallOf(job.body);
        if (!called) continue;
        const reads = (byName.get(called)?.jobs ?? []).flatMap((j) => secretsOf(j.body));
        if (reads.length === 0) continue;
        calls += 1;
        if (!secretsOf(job.body).includes("(inherit)")) {
          offenders.push(`${wf.name} / ${job.id}: calls ${called}, which reads ${[...new Set(reads)].join(", ")}, without secrets: inherit`);
        }
      }
    }
    // Non-vacuity: deploy-staging.yml's call into _deploy.yml and
    // deploy-production.yml's into release.yml.
    assert.ok(calls >= 2, `expected at least two calls into secret-reading workflows, saw ${calls}`);
    assert.deepEqual(
      offenders,
      [],
      "A called job gets none of its environment's secrets unless its caller passes `secrets: " +
        "inherit`; every one reads empty, even with the called job's `environment:` set. Add " +
        "`secrets: inherit` to the calling job.",
    );
  });

  it("D: a job that references a secret runs third-party actions only by commit SHA (#2647)", () => {
    const offenders = [];
    const seen = new Set();
    for (const wf of workflows) {
      for (const job of wf.jobs) {
        if (secretsOf(job.body).length === 0) continue;
        for (const { ref, via } of actionRefsOf(job.body)) {
          seen.add(ref.split("@")[0]);
          if (pinningOf(ref) === "unpinned") offenders.push(`${wf.name} / ${job.id}${via}: ${ref}`);
        }
      }
    }
    // Non-vacuity: the two actions #2647 pinned sit inside credential jobs, one
    // level down in a local composite action, so the walk must reach them.
    assert.ok(seen.has("Infisical/secrets-action"), "the Infisical inject must be seen in a credential job");
    assert.ok(seen.has("supabase/setup-cli"), "setup-cli must be seen in a credential job");
    assert.deepEqual(
      offenders,
      [],
      "A job that holds credentials runs a third-party action by a tag or branch, which its " +
        "publisher can move to new code that then runs with those credentials, unreviewed. Pin " +
        "the full commit SHA with the version in a trailing comment " +
        "(`uses: owner/action@<40-hex sha> # v1.2.3`), resolved with " +
        "`git ls-remote https://github.com/<owner>/<action> refs/tags/<tag>` (take the `^{}` " +
        "line for an annotated tag).",
    );
  });

  it("the parser reads the shapes it relies on", () => {
    const lines = codeLines(
      [
        "on:",
        "  pull_request:",
        "    branches: [main]",
        "  push:",
        "jobs:",
        "  a:",
        "    runs-on: ubuntu-latest",
        "    environment:",
        "      name: automation",
        "      deployment: false",
        "    steps:",
        "      - run: echo ${{ secrets.X }} ${{ secrets.GITHUB_TOKEN }}",
        "      - run: node scripts/scan-secrets.mjs",
        '      - run: echo "#1" ${{ secrets.AFTER_A_HASH }}',
        "      - run: echo '${{ toJSON(secrets) }}' ${{ secrets['BRACKETED'] }}",
        "      # ${{ secrets.IN_A_COMMENT }}",
        "  b:",
        "    environment: ${{ github.ref_name }}",
        "    uses: ./.github/workflows/release.yml",
        "    secrets: inherit",
      ].join("\n"),
    );
    assert.deepEqual(triggersOf(lines), ["pull_request", "push"]);
    const [a, b] = jobsOf(lines);
    assert.deepEqual(secretsOf(a.body), ["X", "AFTER_A_HASH", "(dynamic)"]);
    assert.deepEqual(environmentOf(a.body), { name: "automation", literal: true });
    assert.deepEqual(secretsOf(b.body), ["(inherit)"]);
    assert.equal(environmentOf(b.body).literal, false);
    assert.equal(reusableCallOf(b.body), "release.yml");
    // Every shape a caller could be written in counts as a call (#2804 review):
    // a trailing comment, quotes, and the owner/repo@ref form.
    for (const uses of [
      "./.github/workflows/_deploy.yml",
      "./.github/workflows/_deploy.yml # the shared job",
      '"./.github/workflows/_deploy.yml"',
      "'./.github/workflows/_deploy.yml'",
      "pdcarlson/Frapp/.github/workflows/_deploy.yml@main",
      "someone/Fork/.github/workflows/_deploy.yml@0123456789abcdef0123456789abcdef01234567",
    ]) {
      assert.equal(reusableCallOf([`    uses: ${uses}`]), "_deploy.yml", uses);
    }
    assert.equal(reusableCallOf(["    uses: actions/checkout@v4"]), null);
    assert.equal(withValueOf(["    with:", "      environment: staging # the one", "      sha: x"], "environment"), "staging");
    assert.deepEqual(triggersOf(codeLines("on: [push, pull_request]\njobs:\n")), ["push", "pull_request"]);
    const withEnv = codeLines("on: push\nenv:\n  T: ${{ secrets.WORKFLOW_LEVEL }}\njobs:\n  a:\n    runs-on: x\n");
    assert.deepEqual(secretsOf(preambleOf(withEnv)), ["WORKFLOW_LEVEL"]);
    assert.deepEqual(secretsOf(jobsOf(withEnv)[0].body), []);

    const steps = codeLines(
      [
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: Owner/action@v1.0.12",
        '      - uses: "owner/action/sub@0123456789abcdef0123456789abcdef01234567" # v2',
        "      - uses: ./.github/actions/local-thing",
        "      # - uses: commented/out@v1",
        "      - name: x",
        "        uses: docker://alpine:3",
        "      - { name: flow, uses: flow/style@v1 }",
        "      - uses: >-",
      ].join("\n"),
    );
    assert.deepEqual(usesOf(steps), [
      "actions/checkout@v4",
      "Owner/action@v1.0.12",
      "owner/action/sub@0123456789abcdef0123456789abcdef01234567",
      "./.github/actions/local-thing",
      "docker://alpine:3",
      "flow/style@v1",
      ">-",
    ]);
    assert.deepEqual(usesOf(steps).map(pinningOf), [
      "first-party",
      "unpinned",
      "pinned",
      "local",
      "unpinned",
      "unpinned",
      "unpinned",
    ]);
    assert.deepEqual(dockerImagesOf(codeLines("runs:\n  using: docker\n  image: docker://foo:latest\n")), [
      "docker://foo:latest",
    ]);
    assert.deepEqual(dockerImagesOf(codeLines("runs:\n  using: docker\n  image: Dockerfile\n")), []);
    assert.equal(pinningOf("github/codeql-action/init@v3"), "first-party");
    assert.equal(pinningOf(`docker://alpine@sha256:${"a".repeat(64)}`), "pinned");
    assert.equal(pinningOf("owner/action@0123456"), "unpinned", "a short SHA is not a pin");
  });
});
