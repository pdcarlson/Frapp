import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
// those environments. Moving them and setting the policies is the owner's #2583;
// until then they are repository secrets and this boundary does not exist yet.
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
//      create it with no rules.
//   C. No secret is referenced outside a job. A workflow-level `env:` may read
//      `secrets` and hands the value to every job, and no environment can gate
//      it, because environment secrets exist only inside a job that named one.
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

/**
 * The environments secrets may live in. Each must admit `main` only, which is
 * the owner's #2583 (not yet done on 2026-09-23). A new one gets that rule
 * before its first secret.
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

/** A job that calls a reusable workflow in this repo: `./.github/workflows/<file>`. */
function reusableCallOf(body) {
  const m = body.map((l) => l.match(/^ {4}uses:\s*\.\/\.github\/workflows\/(\S+)\s*$/)).find(Boolean);
  return m ? m[1] : null;
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
          const target = byName.get(called);
          const unscoped = (target?.jobs ?? []).filter((j) => {
            const env = environmentOf(j.body);
            return !env?.literal || !CREDENTIAL_ENVIRONMENTS.includes(env.name);
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
          offenders.push(`${wf.name} / ${job.id}: environment name is an expression`);
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
    assert.deepEqual(triggersOf(codeLines("on: [push, pull_request]\njobs:\n")), ["push", "pull_request"]);
    const withEnv = codeLines("on: push\nenv:\n  T: ${{ secrets.WORKFLOW_LEVEL }}\njobs:\n  a:\n    runs-on: x\n");
    assert.deepEqual(secretsOf(preambleOf(withEnv)), ["WORKFLOW_LEVEL"]);
    assert.deepEqual(secretsOf(jobsOf(withEnv)[0].body), []);
  });
});
