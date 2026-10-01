import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { workflowFiles, workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

// Pins the Node preamble cutover (#1541): `actions/setup-node` and the
// `npm ci` after it were hand-written in 37 places, each with its own copy of
// `node-version`. Node 20 → 24 was a 39-line edit with nothing to say a copy
// had been missed, and a missed one fails silently: that job runs whatever
// Node the runner ships, and still reports green.
//
// Three things have to hold for the extraction to be worth anything, and each
// is asserted below:
//
//   * The copies stay gone, in workflows and in the other composite actions.
//   * The two jobs that can't call a local action (they check out another
//     commit first, so `./.github/actions/node-setup` would load from THAT
//     tree) stay pinned to the same version, and stay exceptions only while
//     the reason holds.
//   * The action's own contract (the `install` input and what each mode runs)
//     doesn't drift. Most call sites are scheduled or dispatch-only, so a PR
//     never runs them: a renamed input or a dropped mode would first fail on a
//     production watchdog's next run.
//
// Where each call may run is the other half, and lives in
// `infisical-secrets-action.test.mjs` § "local actions resolve at every call
// site", which covers every local action, this one included.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOWS = join(REPO, ".github", "workflows");
const ACTIONS = join(REPO, ".github", "actions");
const ACTION_DIR = "node-setup";
const ACTION = join(ACTIONS, ACTION_DIR, "action.yml");

// Each checks out a commit other than the workflow's own before Node is set
// up: `_deploy.yml` the commit being deployed, `release.yml` the one being
// tagged. Asserted to still do so below, so the list can't outlive its reason.
const EXCEPTIONS = ["_deploy.yml", "release.yml"];

const INSTALL_MODES = ["ci", "none", "omit-dev"];

const codeLines = (text) => text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l));

/** A YAML scalar with its trailing comment and surrounding quotes removed. */
const scalar = (raw) =>
  raw
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");

// Tolerant on purpose: these drive NEGATIVE assertions, and a regex that is
// too tight fails open. Any ref (`@v4`, `@<sha>`), quoted or not, name-less
// `- uses:` or not.
const SETUP_NODE_RE = /^\s*(-\s+)?uses:\s*["']?actions\/setup-node@/;
const USES_NODE_SETUP_RE =
  /^\s*(-\s+)?uses:\s*["']?\.\/\.github\/actions\/node-setup\/?["']?\s*(#.*)?$/;
const NODE_VERSION_RE = /^\s*node-version:\s*(.+)$/;
const CHECKOUT_RE = /^\s*(-\s+)?uses:\s*["']?actions\/checkout@/;

/**
 * Whether a line runs a dependency install the action owns: any spelling of
 * `npm ci`, or an `npm install` that names no package (which installs the
 * lockfile, the same job). `npm install --global vercel@x` installs a tool and
 * is not one.
 */
export function runsInstall(line) {
  const command = /(?:^|[\s;&|(`])npm\s+([a-z-]+)((?:\s+[^\s;&|)`]+)*)/g;
  for (const m of line.matchAll(command)) {
    const [, verb, rest] = m;
    if (["ci", "clean-install", "ic", "install-clean", "isntall-clean"].includes(verb)) return true;
    if (["install", "i", "in", "add", "isntall"].includes(verb)) {
      const packages = rest.trim().split(/\s+/).filter((t) => t && !t.startsWith("-"));
      if (packages.length === 0) return true;
    }
  }
  return false;
}

/** `{ name, text }` for every composite action except node-setup itself. */
function otherActions() {
  return readdirSync(ACTIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== ACTION_DIR)
    .flatMap((e) =>
      ["action.yml", "action.yaml"]
        .map((f) => join(ACTIONS, e.name, f))
        .filter((p) => existsSync(p))
        .map((p) => ({ name: `.github/actions/${e.name}/${p.split("/").at(-1)}`, text: readFileSync(p, "utf8") })),
    );
}

const workflows = () =>
  workflowFiles().map((name) => ({ name, text: readFileSync(join(WORKFLOWS, name), "utf8") }));

/** The steps under a composite action's `runs.steps`, as raw text chunks. */
function compositeSteps(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^ {2}steps:\s*$/.test(l));
  assert.ok(start !== -1, "node-setup must declare runs.steps");
  const steps = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (/^ {4}-\s/.test(line)) steps.push([]);
    if (steps.length && !/^\s*#/.test(line)) steps.at(-1).push(line);
  }
  return steps.map((s) => s.join("\n"));
}

/** The `install:` a node-setup step passes, or null when it passes none. */
function installOf(stepText) {
  const m = stepText.match(/^\s+install:\s*(.*)$/m);
  return m ? scalar(m[1]) : null;
}

/** `{ <filter>: [paths] }` for ci.yml's dorny/paths-filter block. */
function ciPathFilters(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s+filters:\s*\|\s*$/.test(l));
  assert.ok(start !== -1, "ci.yml must still define its paths-filter block");
  const filters = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    if (!/^ {12}/.test(line)) break;
    const name = line.match(/^ {12}([\w-]+):\s*$/);
    if (name) {
      current = name[1];
      filters[current] = [];
      continue;
    }
    const item = line.match(/^ {14}-\s*(.+)$/);
    if (item && current) filters[current].push(scalar(item[1]));
  }
  return filters;
}

const actionText = () => readFileSync(ACTION, "utf8");

/** The single `node-version` the action pins. */
function actionVersion() {
  const versions = codeLines(actionText())
    .map((l) => l.match(NODE_VERSION_RE)?.[1])
    .filter(Boolean)
    .map(scalar);
  assert.equal(versions.length, 1, "node-setup must write `node-version` exactly once");
  return versions[0];
}

describe("node-setup composite action", () => {
  it("exists, is composite, and pins one Node version", () => {
    assert.ok(existsSync(ACTION), `${ACTION} is missing`);
    assert.match(actionText(), /^\s*using:\s*composite\s*$/m, "action must declare `using: composite`");
    assert.match(actionVersion(), /^\d+$/, "pin a major, as every call site did before the extraction");
  });

  // A default would let a call site that forgets `install:` get one silently;
  // a rename leaves every caller passing an input nothing reads, which the
  // runner only warns about.
  it("keeps a required `install` input with no default", () => {
    const lines = actionText().split(/\r?\n/);
    const start = lines.findIndex((l) => /^inputs:\s*$/.test(l));
    assert.ok(start !== -1, "node-setup must declare inputs");
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) {
        end = i;
        break;
      }
    }
    const inputs = codeLines(lines.slice(start + 1, end).join("\n"));
    const names = inputs.map((l) => l.match(/^ {2}([\w-]+):\s*$/)?.[1]).filter(Boolean);
    assert.deepEqual(names, ["install"], "node-setup takes exactly one input, `install`");
    assert.ok(inputs.some((l) => /^ {4}required:\s*true\s*$/.test(l)), "`install` must be required");
    assert.ok(!inputs.some((l) => /^ {4}default:/.test(l)), "`install` must have no default");
  });

  // The runner doesn't enforce `required: true` for a composite action, and a
  // value no `if:` matches would skip the install with the step green.
  it("refuses an unknown mode before it sets anything up", () => {
    const steps = compositeSteps(actionText());
    const check = steps.findIndex((s) => /^\s+case\s+"\$INSTALL"\s+in\s*$/m.test(s));
    const setup = steps.findIndex((s) => SETUP_NODE_RE.test(s.split("\n").find((l) => /uses:/.test(l)) ?? ""));
    assert.ok(check !== -1, "node-setup must validate `install`");
    assert.ok(setup !== -1, "node-setup must run actions/setup-node");
    assert.ok(check < setup, "the mode check must run before Node is set up");
    assert.match(steps[check], /INSTALL:\s*\$\{\{\s*inputs\.install\s*\}\}/, "the check must read the input");
    const accepted = steps[check].match(/^\s*([a-z-]+(?:\s*\|\s*[a-z-]+)*)\)\s*;;\s*$/m)?.[1];
    assert.ok(accepted, "the check must list the accepted modes as one case arm");
    assert.deepEqual(accepted.split("|").map((s) => s.trim()).sort(), INSTALL_MODES);
    assert.match(steps[check], /\*\)[\s\S]*exit 1/, "anything else must fail the step");
  });

  it("installs exactly what each mode names, and caches only when it installs", () => {
    const steps = compositeSteps(actionText());
    const runFor = (mode) => {
      const step = steps.filter((s) => new RegExp(`^\\s+if:\\s*inputs\\.install == '${mode}'\\s*$`, "m").test(s));
      assert.equal(step.length, 1, `exactly one step must run for install: ${mode}`);
      return step[0].match(/^\s+run:\s*(.+)$/m)?.[1].trim();
    };
    assert.equal(runFor("ci"), "npm ci");
    assert.equal(runFor("omit-dev"), "npm ci --omit=dev");
    assert.ok(
      !steps.some((s) => /^\s+if:\s*inputs\.install == 'none'/m.test(s)),
      "`none` installs nothing",
    );
    const setup = steps.find((s) => /uses:\s*actions\/setup-node@/.test(s));
    assert.match(
      setup,
      /^\s+cache:\s*\$\{\{\s*inputs\.install != 'none' && 'npm' \|\| '' \}\}\s*$/m,
      "the npm download cache follows the install: on for ci and omit-dev, off for none",
    );
  });
});

describe("node-setup call sites", () => {
  it("nothing outside the action and the moved-tree exceptions hand-writes actions/setup-node", () => {
    const offenders = [
      ...workflows().filter((w) => !EXCEPTIONS.includes(w.name)).map((w) => ({ ...w, name: `.github/workflows/${w.name}` })),
      ...otherActions(),
    ]
      .filter((f) => codeLines(f.text).some((l) => SETUP_NODE_RE.test(l)))
      .map((f) => f.name);
    assert.deepEqual(offenders, [], "set up Node through ./.github/actions/node-setup");
  });

  it("each exception still checks out another commit first, and pins node-setup's version", () => {
    const version = actionVersion();
    for (const file of EXCEPTIONS) {
      const steps = workflowSteps(join(WORKFLOWS, file));
      const setups = steps.filter((s) => codeLines(s.body).some((l) => SETUP_NODE_RE.test(l)));
      assert.ok(setups.length > 0, `${file} no longer hand-writes setup-node; drop it from EXCEPTIONS`);
      for (const setup of setups) {
        const versions = codeLines(setup.body)
          .map((l) => l.match(NODE_VERSION_RE)?.[1])
          .filter(Boolean)
          .map(scalar);
        assert.deepEqual(versions, [version], `${file} (${setup.jobId}) must pin node-version ${version}, node-setup's`);
        assert.doesNotMatch(setup.body, /node-version-file:/, `${file} must pin the version, not read it from a file`);
        const before = steps.slice(0, steps.indexOf(setup)).filter((s) => s.jobId === setup.jobId);
        const moved = before.some((s) => {
          if (!codeLines(s.body).some((l) => CHECKOUT_RE.test(l))) return false;
          const ref = s.body.match(/^\s+ref:\s*(.+)$/m)?.[1];
          return ref && !/^\$\{\{\s*github\.sha\s*\}\}$/.test(scalar(ref));
        });
        assert.ok(
          moved,
          `${file} (${setup.jobId}) no longer checks out another commit before setup-node, so it can ` +
            "call ./.github/actions/node-setup like everything else: convert it and drop it from EXCEPTIONS",
        );
      }
    }
  });

  it("nothing outside the action and the exceptions hand-writes the install", () => {
    const offenders = [
      ...workflows().filter((w) => !EXCEPTIONS.includes(w.name)).map((w) => ({ ...w, name: `.github/workflows/${w.name}` })),
      ...otherActions(),
    ].flatMap((f) =>
      codeLines(f.text)
        .filter(runsInstall)
        .map((l) => `${f.name}: ${l.trim()}`),
    );
    assert.deepEqual(offenders, [], "install through ./.github/actions/node-setup's `install:` input");
  });

  it("every call passes a mode the action accepts", () => {
    const calls = [
      ...workflowFiles().flatMap((file) =>
        workflowSteps(join(WORKFLOWS, file))
          .filter((s) => s.body.split("\n").some((l) => USES_NODE_SETUP_RE.test(l)))
          .map((s) => ({ where: `${file} (${s.jobId})`, install: installOf(s.body) })),
      ),
      ...otherActions().flatMap((a) =>
        a.text
          .split(/^(?= {4}- )/m)
          .filter((s) => s.split("\n").some((l) => USES_NODE_SETUP_RE.test(l)))
          .map((s) => ({ where: a.name, install: installOf(codeLines(s).join("\n")) })),
      ),
    ];
    // 37 when the action landed. Far fewer means the step reader broke.
    assert.ok(calls.length >= 30, `expected every node-setup call site, saw ${calls.length}`);
    const bad = calls.filter((c) => !INSTALL_MODES.includes(c.install));
    assert.deepEqual(
      bad,
      [],
      `pass \`install:\` as one of ${INSTALL_MODES.join(", ")}; the action fails at run time otherwise, ` +
        "and most of these jobs never run on a pull request",
    );
  });

  // A skipped job reports Success, so a REQUIRED job gated on a filter that
  // lacks the action would pass green on a PR that edits only the action.
  it("every path-gated job that calls it re-runs when the action changes", () => {
    const path = join(WORKFLOWS, "ci.yml");
    const filters = ciPathFilters(readFileSync(path, "utf8"));
    const usesAction = new Set(
      workflowSteps(path)
        .filter((s) => s.body.split("\n").some((l) => USES_NODE_SETUP_RE.test(l)))
        .map((s) => s.jobId),
    );
    const gated = workflowJobs(path).flatMap((job) =>
      [...(job.if ?? "").matchAll(/needs\.changes\.outputs\.([\w-]+)/g)].map((m) => ({ job: job.jobId, filter: m[1] })),
    );
    assert.ok(gated.length > 0, "expected path-gated jobs in ci.yml");
    const missing = gated
      .filter((g) => usesAction.has(g.job))
      .filter((g) => !(filters[g.filter] ?? []).includes(".github/actions/**"))
      .map((g) => `${g.job} (filter \`${g.filter}\`)`);
    assert.deepEqual(missing, [], "add '.github/actions/**' to each of these jobs' paths-filter");
  });
});

describe("runsInstall", () => {
  it("finds every spelling of the lockfile install", () => {
    for (const line of [
      "        run: npm ci",
      "        run: npm ci --omit=dev",
      "          npm  clean-install",
      "        run: cd apps/web && npm ci",
      "        run: npm install",
      "        run: npm i --no-audit",
    ]) {
      assert.ok(runsInstall(line), line);
    }
  });

  it("leaves tool installs and other npm commands alone", () => {
    for (const line of [
      "        run: npm install --global vercel@59.11.7",
      "        run: npm run ci-check",
      "        run: npm run test:ci-scripts",
      "        install: ci",
    ]) {
      assert.ok(!runsInstall(line), line);
    }
  });
});
