import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACTION_DIR,
  actionFiles,
  nodeSetupInstall,
  runsInstall,
  shellLines,
  usesLocalAction,
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
//   * The jobs that can't call a local action (they check out another commit
//     first, so `./.github/actions/node-setup` would load from THAT tree; the
//     three files in EXCEPTIONS) stay pinned to the same step (the setup-node
//     ref, Node version and cache opt-out), and stay exceptions only while the
//     reason holds.
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
// tagged, `_mobile-build.yml` the one being built for the stores (#3111).
// Asserted to still do so below, so the list can't outlive its reason.
const EXCEPTIONS = ["_deploy.yml", "release.yml", "_mobile-build.yml"];

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
// `- uses:` or not, a whole step in flow form (`- { uses: actions/setup-node@v4,
// with: { node-version: 22 } }`), and any case: GitHub resolves `owner/repo`
// case-insensitively.
const SETUP_NODE_RE = /(?:^|[\s{,-])uses:\s*["']?actions\/setup-node@/i;
const SETUP_NODE_REF_RE = /actions\/setup-node@([^\s"'},]+)/i;
const NODE_VERSION_RE = /^\s*node-version:\s*(.+)$/;
// Every setup-node site opts out of its automatic npm cache, so `cache:` stays
// the only switch; the comment on node-setup's Setup Node step says why.
const NO_AUTO_CACHE_RE = /^\s+package-manager-cache:\s*false\s*$/m;

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

/** A step's `run: |` block, de-indented, trailing blank lines dropped. */
function scriptOf(step) {
  const lines = step.split("\n");
  const at = lines.findIndex((l) => /^\s*(-\s+)?run:\s*\|\s*$/.test(l));
  if (at === -1) return null;
  const body = lines.slice(at + 1);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
  return body
    .map((l) => l.slice(indent))
    .join("\n")
    .replace(/\s+$/, "");
}

// The mode check, whole. Its accepted modes are INSTALL_MODES.
const CHECK_SCRIPT = [
  'case "$INSTALL" in',
  "  ci | omit-dev | none) ;;",
  "  *)",
  `    echo "::error::node-setup: install must be ci, omit-dev or none (got '$INSTALL')"`,
  "    exit 1",
  "    ;;",
  "esac",
].join("\n");

/** The single `node-version` the action pins. */
function actionVersion() {
  const versions = codeLines(actionText())
    .map((l) => l.match(NODE_VERSION_RE)?.[1])
    .filter(Boolean)
    .map(scalar);
  assert.equal(versions.length, 1, "node-setup must write `node-version` exactly once");
  return versions[0];
}

/** The `actions/setup-node` ref on each setup-node line of `text`. */
const setupNodeRefs = (text) =>
  codeLines(text)
    .filter((l) => SETUP_NODE_RE.test(l))
    .map((l) => l.match(SETUP_NODE_REF_RE)?.[1]);

/** The single `actions/setup-node` ref the action uses. */
function actionRef() {
  const refs = setupNodeRefs(actionText());
  assert.equal(refs.length, 1, "node-setup must use actions/setup-node exactly once");
  return refs[0];
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
    // A custom `shell:` template runs its own command line around the script.
    for (const step of [check, ci, omitDev]) {
      assert.equal(step.match(/^\s*(-\s+)?shell:\s*(.+)$/m)?.[2]?.trim(), "bash", "shell steps use plain bash");
    }

    // The runner doesn't enforce `required: true` for a composite action, and a
    // value no `if:` matches would skip the install with the step green. Its
    // script is pinned whole: a line added to it runs for every caller too.
    assert.equal(uses(check), undefined, "the mode check is a shell step");
    assert.equal(ifOf(check), null, "the mode check always runs");
    assert.match(check, /INSTALL:\s*\$\{\{\s*inputs\.install\s*\}\}/, "the check must read the input");
    assert.equal(scriptOf(check), CHECK_SCRIPT, "the mode check runs exactly its case statement");

    assert.match(uses(setup) ?? "", /^actions\/setup-node@/, "the second step sets up Node");
    assert.equal(ifOf(setup), null, "Node is always set up");
    assert.equal(runOf(setup), null);
    assert.match(
      setup,
      /^\s+cache:\s*\$\{\{\s*inputs\.install != 'none' && 'npm' \|\| '' \}\}\s*$/m,
      "the npm download cache follows the install: on for ci and omit-dev, off for none",
    );
    assert.match(
      codeLines(setup).join("\n"),
      NO_AUTO_CACHE_RE,
      "without `package-manager-cache: false`, setup-node caches npm for install: none too",
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

  it("each exception still checks out another commit first, and pins node-setup's step", () => {
    const version = actionVersion();
    const ref = actionRef();
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
        // A runtime bump (#3108) moves all three together, or one copy keeps
        // running on the deprecated Node the others left.
        assert.deepEqual(
          setupNodeRefs(setup.body),
          [ref],
          `${file} (${setup.jobId}) must use actions/setup-node@${ref}, node-setup's`,
        );
        // Both jobs hold secrets; setup-node's README asks privileged jobs to
        // turn its automatic cache off.
        assert.match(
          codeLines(setup.body).join("\n"),
          NO_AUTO_CACHE_RE,
          `${file} (${setup.jobId}) must set package-manager-cache: false, as node-setup does`,
        );
      }
      // The same workspace reading the local-action guard uses, so the two can't
      // disagree about a job: `untrusted` is the reason this is an exception.
      // A path-limited overlay (`git checkout <ref> -- <paths>`, release.yml's
      // classifier) doesn't count here: it leaves `.github/actions` where it
      // was, so it alone would not stop node-setup from loading.
      const withoutOverlays = text.replace(/^.*\bgit\b.*\bcheckout\b.*\s--(?:\s.*)?$/gm, "");
      for (const call of workspaceTrust(withoutOverlays, (line) => SETUP_NODE_RE.test(line))) {
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
      shellLines(f.text)
        .filter(runsInstall)
        .map((l) => `${f.name}: ${l.trim()}`),
    );
    assert.deepEqual(offenders, [], "install through ./.github/actions/node-setup's `install:` input");
  });

  // An exception covers the job that moved the tree, not the whole file: a job
  // beside it on the trusted ref (`_mobile-build.yml`'s `record` and
  // `snapshot`, which go on to hold the base-sync App token and `actions:
  // write`) installs through node-setup like any other.
  it("in an exception file, only a job on another commit hand-writes the install or setup-node", () => {
    const offenders = EXCEPTIONS.flatMap((file) => {
      const text = readFileSync(join(WORKFLOW_DIR, file), "utf8");
      // As in the exception test above: a path-limited overlay leaves
      // `.github/actions` where it was, so it doesn't make a job an exception.
      const withoutOverlays = text.replace(/^.*\bgit\b.*\bcheckout\b.*\s--(?:\s.*)?$/gm, "");
      return workspaceTrust(withoutOverlays, (line) => runsInstall(line) || SETUP_NODE_RE.test(line))
        .filter((call) => call.state !== "untrusted")
        .map((call) => `${file}:${call.line}`);
    });
    assert.deepEqual(offenders, [], "set up Node and install through ./.github/actions/node-setup in a trusted-ref job");
  });

  /** `{ where, install, holdsSecrets }` for every node-setup call. */
  function calls() {
    const secretCallers = [];
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
      secretCallers.push(...steps.filter((s) => secretJobs.has(s.jobId) || environments.has(s.jobId)));
      return steps
        .filter((s) => s.body.split("\n").some((l) => USES_NODE_SETUP.test(l)))
        .map((s) => ({
          where: `${file} (${s.jobId})`,
          install: nodeSetupInstall(s.body),
          holdsSecrets: secretJobs.has(s.jobId) || environments.has(s.jobId),
        }));
    });
    // A composite action runs in its caller's job, so it holds whatever the
    // callers hold, through any depth of nesting.
    const actions = actionFiles().filter((a) => a.name !== NAME);
    const callsAction = (text, name) => text.split("\n").some((l) => usesLocalAction(name).test(l));
    const holding = new Set(
      actions.filter((a) => secretCallers.some((step) => callsAction(step.body, a.name))).map((a) => a.name),
    );
    for (let grew = true; grew; ) {
      grew = false;
      for (const a of actions) {
        if (holding.has(a.name)) continue;
        if (actions.some((b) => holding.has(b.name) && callsAction(b.text, a.name))) {
          holding.add(a.name);
          grew = true;
        }
      }
    }
    const fromActions = actions.flatMap((a) =>
      a.text
        .split(/^(?= {4}- )/m)
        .filter((s) => s.split("\n").some((l) => USES_NODE_SETUP.test(l)))
        .map((s) => ({
          where: `.github/actions/${a.name}/${a.file}`,
          install: nodeSetupInstall(codeLines(s).join("\n")),
          holdsSecrets: holding.has(a.name),
        })),
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
  // may switch to an installing mode. `_deploy.yml` and `_mobile-build.yml`
  // install before any step uses their secrets (the Infisical injection, the
  // EXPO_TOKEN steps), and are hand-written, outside this rule; #2824 and
  // #3125 track isolating them.
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
      "        run: npm cit",
      "        run: npm install-ci-test",
      "        run: npm it",
      "        run: npm ci>/dev/null",
      "        run: npm --fetch-retries 5 ci",
      "        run: npm --globalconfig x ci",
      "        run: npm install --location project",
      "        run: npm install --cpu x64",
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
      "        run: npm run ci",
      "        run: npm exec -- ci",
      "        - name: Use npm and ci tooling",
    ]) {
      assert.ok(!runsInstall(line), line);
    }
  });
});
