import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACTION_DIR,
  actionFiles,
  nodeSetupInstall,
  USES_NODE_SETUP,
  WORKFLOW_DIR,
  workflowFiles,
  workflowJobs,
  workflowSteps,
  workspaceTrust,
} from "./helpers/workflow-yaml.mjs";

// Pins the Node preamble cutover (#1541): `actions/setup-node` and the
// `npm ci` after it were hand-written in 37 places, each with its own copy of
// `node-version`. Node 20 → 24 was a 39-line edit with nothing to say a copy
// had been missed, and a missed one fails silently: that job runs whatever
// Node the runner ships, and still reports green.
//
// What has to hold for the extraction to be worth anything, each asserted
// below:
//
//   * The copies stay gone, in workflows and in the other composite actions.
//   * The two jobs that can't call a local action (they check out another
//     commit first, so `./.github/actions/node-setup` would load from THAT
//     tree) stay pinned to the same version, and stay exceptions only while
//     the reason holds.
//   * The action does exactly what its contract says and nothing more. Most
//     call sites are scheduled or dispatch-only, so a PR never runs them, and
//     the per-job guards (the cold-build jobs, mobile-validate's bundle order,
//     the watchdogs' "no npm ci") read only the job, not the action it calls:
//     a step added inside the action would reach every one of them unseen.
//   * No job holding a secret installs dependencies through it.
//
// Where each call may run is the other half, and lives in
// `infisical-secrets-action.test.mjs` § "local actions resolve at every call
// site", which covers every local action, this one included, and the
// path-filter rule for jobs that call one.

const NAME = "node-setup";
const ACTION = join(ACTION_DIR, NAME, "action.yml");

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
// `- uses:` or not, and any case: GitHub resolves `owner/repo` case-insensitively.
const SETUP_NODE_RE = /^\s*(-\s+)?uses:\s*["']?actions\/setup-node@/i;
const NODE_VERSION_RE = /^\s*node-version:\s*(.+)$/;

// npm flags that take their value as the NEXT word; that word is not a package
// name (`npm install --prefix ../..` installs the lockfile). A flag missing
// here makes its value read as a package, which fails open, so add to it
// rather than trim it.
const VALUE_FLAGS = new Set([
  "--prefix",
  "-C",
  "--workspace",
  "-w",
  "--omit",
  "--include",
  "--install-strategy",
  "--registry",
  "--cache",
  "--userconfig",
  "--loglevel",
  "--tag",
  "--before",
  "--script-shell",
]);
const CI_VERBS = new Set(["ci", "clean-install", "ic", "install-clean", "isntall-clean"]);
const INSTALL_VERBS = new Set([
  "install",
  "i",
  "in",
  "ins",
  "inst",
  "insta",
  "instal",
  "isnt",
  "isnta",
  "isntal",
  "isntall",
  "add",
]);

/**
 * Whether a line runs a dependency install the action owns: any spelling of
 * `npm ci`, or an `npm install` that names no package (which installs the
 * lockfile, the same job). `npm install --global vercel@x` installs a tool and
 * is not one. Global flags may come before the verb (`npm --prefix x ci`), and
 * quotes delimit nothing here (`run: "npm ci"` is `npm ci`).
 */
export function runsInstall(line) {
  const text = line.replace(/["'`]/g, " ");
  for (const command of text.split(/&&|\|\||[;|&()]/)) {
    const tokens = command.trim().split(/\s+/).filter(Boolean);
    const at = tokens.findIndex((t) => t === "npm" || t.endsWith("/npm"));
    if (at === -1) continue;
    let i = at + 1;
    while (i < tokens.length && tokens[i].startsWith("-")) i += VALUE_FLAGS.has(tokens[i]) ? 2 : 1;
    const verb = tokens[i];
    if (CI_VERBS.has(verb)) return true;
    if (!INSTALL_VERBS.has(verb)) continue;
    let packages = 0;
    for (let j = i + 1; j < tokens.length; j++) {
      if (!tokens[j].startsWith("-")) packages += 1;
      else if (VALUE_FLAGS.has(tokens[j])) j += 1;
    }
    if (packages === 0) return true;
  }
  return false;
}

/** Every workflow file, as `{ name, text }`. */
const workflows = () =>
  workflowFiles().map((name) => ({ name, text: readFileSync(join(WORKFLOW_DIR, name), "utf8") }));

/** Every composite action except node-setup itself, as `{ name, text }`. */
const otherActions = () =>
  actionFiles()
    .filter((a) => a.name !== NAME)
    .map((a) => ({ name: `.github/actions/${a.name}/${a.file}`, text: a.text }));

/** Everything that must not hand-write what node-setup owns. */
const guardedFiles = () => [
  ...workflows()
    .filter((w) => !EXCEPTIONS.includes(w.name))
    .map((w) => ({ ...w, name: `.github/workflows/${w.name}` })),
  ...otherActions(),
];

/** The steps under a composite action's `runs.steps`, as code-only text chunks. */
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

  // Every step pinned, in order. The per-job guards can't see inside the
  // action, so an extra step here (an unconditional `npm ci`, a
  // `turbo-packages-build`, an `actions/cache` of node_modules) would reach
  // every caller: `install: none` watchdogs would install, and the cold-build
  // jobs would get a prebuilt dist/. Growing the action means editing this.
  it("runs exactly its four steps: check the mode, set up Node, then each mode's install", () => {
    const steps = compositeSteps(actionText());
    assert.equal(steps.length, 4, "node-setup runs exactly four steps");
    const [check, setup, ci, omitDev] = steps;
    const uses = (step) => step.match(/^\s*(-\s+)?uses:\s*(.+)$/m)?.[2];
    const ifOf = (step) => step.match(/^\s*(-\s+)?if:\s*(.+)$/m)?.[2]?.trim() ?? null;
    const runOf = (step) => step.match(/^\s*(-\s+)?run:\s*(.+)$/m)?.[2]?.trim() ?? null;

    // The runner doesn't enforce `required: true` for a composite action, and a
    // value no `if:` matches would skip the install with the step green.
    assert.equal(uses(check), undefined, "the mode check is a shell step");
    assert.equal(ifOf(check), null, "the mode check always runs");
    assert.match(check, /INSTALL:\s*\$\{\{\s*inputs\.install\s*\}\}/, "the check must read the input");
    assert.match(check, /^\s+case\s+"\$INSTALL"\s+in\s*$/m, "the check must switch on the input");
    const accepted = check.match(/^\s*([a-z-]+(?:\s*\|\s*[a-z-]+)*)\)\s*;;\s*$/m)?.[1];
    assert.ok(accepted, "the check must list the accepted modes as one case arm");
    assert.deepEqual(accepted.split("|").map((s) => s.trim()).sort(), INSTALL_MODES);
    assert.match(check, /\*\)[\s\S]*exit 1/, "anything else must fail the step");

    assert.match(uses(setup) ?? "", /^actions\/setup-node@/, "the second step sets up Node");
    assert.equal(ifOf(setup), null, "Node is always set up");
    assert.equal(runOf(setup), null);
    assert.match(
      setup,
      /^\s+cache:\s*\$\{\{\s*inputs\.install != 'none' && 'npm' \|\| '' \}\}\s*$/m,
      "the npm download cache follows the install: on for ci and omit-dev, off for none",
    );

    for (const [step, mode, command] of [
      [ci, "ci", "npm ci"],
      [omitDev, "omit-dev", "npm ci --omit=dev"],
    ]) {
      assert.equal(uses(step), undefined, `install: ${mode} is a shell step`);
      assert.equal(ifOf(step), `inputs.install == '${mode}'`, `the ${command} step runs only for install: ${mode}`);
      assert.equal(runOf(step), command);
    }
  });
});

describe("node-setup call sites", () => {
  it("nothing outside the action and the moved-tree exceptions hand-writes actions/setup-node", () => {
    const offenders = guardedFiles()
      .filter((f) => codeLines(f.text).some((l) => SETUP_NODE_RE.test(l)))
      .map((f) => f.name);
    assert.deepEqual(offenders, [], "set up Node through ./.github/actions/node-setup");
  });

  it("each exception still checks out another commit first, and pins node-setup's version", () => {
    const version = actionVersion();
    for (const file of EXCEPTIONS) {
      const text = readFileSync(join(WORKFLOW_DIR, file), "utf8");
      const setups = workflowSteps(join(WORKFLOW_DIR, file)).filter((s) =>
        codeLines(s.body).some((l) => SETUP_NODE_RE.test(l)),
      );
      assert.ok(setups.length > 0, `${file} no longer hand-writes setup-node; drop it from EXCEPTIONS`);
      for (const setup of setups) {
        const versions = codeLines(setup.body)
          .map((l) => l.match(NODE_VERSION_RE)?.[1])
          .filter(Boolean)
          .map(scalar);
        assert.deepEqual(versions, [version], `${file} (${setup.jobId}) must pin node-version ${version}, node-setup's`);
        assert.doesNotMatch(setup.body, /node-version-file:/, `${file} must pin the version, not read it from a file`);
      }
      // The same workspace reading the local-action guard uses, so the two can't
      // disagree about a job: `untrusted` is the reason this is an exception.
      for (const call of workspaceTrust(text, (line) => SETUP_NODE_RE.test(line))) {
        assert.equal(
          call.state,
          "untrusted",
          `${file}:${call.line} sets up Node in the workflow's own workspace, so it can call ` +
            "./.github/actions/node-setup like everything else: convert it and drop it from EXCEPTIONS",
        );
      }
    }
  });

  it("nothing outside the action and the exceptions hand-writes the install", () => {
    const offenders = guardedFiles().flatMap((f) =>
      codeLines(f.text)
        .filter(runsInstall)
        .map((l) => `${f.name}: ${l.trim()}`),
    );
    assert.deepEqual(offenders, [], "install through ./.github/actions/node-setup's `install:` input");
  });

  /** `{ where, install, holdsSecrets }` for every node-setup call. */
  function calls() {
    const fromWorkflows = workflowFiles().flatMap((file) => {
      const path = join(WORKFLOW_DIR, file);
      const steps = workflowSteps(path);
      const environments = new Set(
        workflowJobs(path)
          .filter((job) => job.keys.has("environment"))
          .map((job) => job.jobId),
      );
      const secretJobs = new Set(
        steps
          .filter((s) => /\bsecrets\./.test(s.body) || [...s.env.values()].some((v) => /\bsecrets\./.test(v)))
          .map((s) => s.jobId),
      );
      return steps
        .filter((s) => s.body.split("\n").some((l) => USES_NODE_SETUP.test(l)))
        .map((s) => ({
          where: `${file} (${s.jobId})`,
          install: nodeSetupInstall(s.body),
          holdsSecrets: secretJobs.has(s.jobId) || environments.has(s.jobId),
        }));
    });
    const fromActions = otherActions().flatMap((a) =>
      a.text
        .split(/^(?= {4}- )/m)
        .filter((s) => s.split("\n").some((l) => USES_NODE_SETUP.test(l)))
        .map((s) => ({ where: a.name, install: nodeSetupInstall(codeLines(s).join("\n")), holdsSecrets: null })),
    );
    return [...fromWorkflows, ...fromActions];
  }

  it("every call passes a mode the action accepts", () => {
    const all = calls();
    // 37 when the action landed. Far fewer means the step reader broke.
    assert.ok(all.length >= 30, `expected every node-setup call site, saw ${all.length}`);
    const bad = all.filter((c) => !INSTALL_MODES.includes(c.install)).map(({ where, install }) => ({ where, install }));
    assert.deepEqual(
      bad,
      [],
      `pass \`install:\` as one of ${INSTALL_MODES.join(", ")}; the action fails at run time otherwise, ` +
        "and most of these jobs never run on a pull request",
    );
  });

  // `npm ci` runs every dependency's lifecycle scripts. The jobs that hold a
  // credential (the production watchdogs, the snapshot publisher, the drift
  // and quota checks) run dependency-free scripts on purpose, so none of them
  // may switch to an installing mode. `_deploy.yml` installs before its secrets
  // are injected, and is hand-written, outside this rule.
  it("no job holding a secret installs through it", () => {
    const offenders = calls()
      .filter((c) => c.holdsSecrets && c.install !== "none")
      .map((c) => `${c.where}: install: ${c.install}`);
    assert.deepEqual(offenders, [], "a job that holds a secret calls node-setup with `install: none`");
    assert.ok(
      calls().filter((c) => c.holdsSecrets).length >= 10,
      "expected the secret-bearing call sites (the production watchdogs among them); the secret reader broke",
    );
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
      '        run: "npm ci"',
      "      - run: 'npm ci'",
      "        run: npm --prefix apps/web ci",
      "        run: npm -w apps/mobile install",
      "        run: npm install --prefix ../..",
      "        run: npm i --omit dev",
      "        run: npm i -w apps/web",
    ]) {
      assert.ok(runsInstall(line), line);
    }
  });

  it("leaves tool installs and other npm commands alone", () => {
    for (const line of [
      "        run: npm install --global vercel@59.11.7",
      "        run: npm i -g eas-cli@16",
      "        run: npm run ci-check",
      "        run: npm run test:ci-scripts",
      "        install: ci",
      "        run: npx npm-check",
    ]) {
      assert.ok(!runsInstall(line), line);
    }
  });
});
