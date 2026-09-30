import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// check-expo-sdk-line.mjs is a general-purpose gate under scripts/ (a peer of
// the other check-*.mjs gates); its test lives here so the `test:ci-scripts`
// glob runs it — hence the ../../ reach up.
import { workflowSteps } from "./helpers/workflow-yaml.mjs";
import {
  declaredPackages,
  dependabotIgnoreNames,
  lockfileCopies,
  main,
  parseVersion,
  rosterViolations,
  satisfies,
  sdkLineViolations,
} from "../../check-expo-sdk-line.mjs";

// Most cases here are ways the gate could pass while checking nothing. The
// break it exists for (#2218: expo-apple-authentication 58.0.0 on SDK 57)
// passed every other check CI runs, so a disarmed gate restores that silence.

// ── satisfies ────────────────────────────────────────────────────────────────

test("the #2218 bump is outside the SDK 57 line", () => {
  assert.equal(satisfies("58.0.0", "~57.0.1"), false);
  assert.equal(satisfies("57.0.2", "~57.0.1"), true);
});

test("tilde fixes major and minor, and refuses a version below the floor", () => {
  assert.equal(satisfies("57.0.19", "~57.0.10"), true);
  assert.equal(satisfies("57.0.9", "~57.0.10"), false);
  assert.equal(satisfies("57.1.0", "~57.0.10"), false);
});

test("caret fixes the leftmost non-zero part", () => {
  assert.equal(satisfies("15.1.1", "^15.0.2"), true);
  assert.equal(satisfies("16.0.0", "^15.0.2"), false);
  assert.equal(satisfies("0.64.9", "^0.64.0"), true);
  assert.equal(satisfies("0.65.0", "^0.64.0"), false);
  assert.equal(satisfies("0.0.3", "^0.0.3"), true);
  assert.equal(satisfies("0.0.4", "^0.0.3"), false);
});

test("an exact range admits only that version", () => {
  assert.equal(satisfies("0.64.0", "0.64.0"), true);
  assert.equal(satisfies("0.64.1", "0.64.0"), false);
});

test("a prerelease install fails closed, even against its own release", () => {
  assert.equal(satisfies("57.0.3-canary-1", "~57.0.1"), false);
  assert.equal(satisfies("57.0.3-canary-1", "57.0.3"), false);
});

test("a range form it can't read throws rather than guessing", () => {
  for (const range of [">=57.0.0", "57.x", "*", "~57.0", "latest", "^57.0.0 || ^58.0.0"]) {
    assert.throws(() => satisfies("57.0.1", range), /unsupported range/, range);
  }
  assert.throws(() => satisfies("not-a-version", "~57.0.1"), /not a semver version/);
});

test("parseVersion drops build metadata and keeps the prerelease", () => {
  assert.deepEqual(parseVersion("57.0.2+abc"), [57, 0, 2, null]);
  assert.deepEqual(parseVersion("57.0.2-beta.1"), [57, 0, 2, "beta.1"]);
  assert.equal(parseVersion("57.0"), null);
});

// ── declaredPackages / lockfileCopies ────────────────────────────────────────

test("a package declared in any section counts as declared", () => {
  assert.deepEqual(
    Object.keys(
      declaredPackages({
        dependencies: { expo: "~57.0.13" },
        devDependencies: { "expo-dev-client": "~57.0.1" },
        optionalDependencies: { "expo-haptics": "~57.0.1" },
      }),
    ).sort(),
    ["expo", "expo-dev-client", "expo-haptics"],
  );
});

test("lockfileCopies lists hoisted and nested copies, and skips links and the root", () => {
  assert.deepEqual(
    lockfileCopies({
      packages: {
        "": { name: "root" },
        "apps/mobile": { version: "1.0.0" },
        "node_modules/mobile": { link: true, resolved: "apps/mobile" },
        "node_modules/expo-camera": { version: "57.0.4" },
        "node_modules/some-lib/node_modules/@expo/ui": { version: "58.0.0" },
      },
    }),
    [
      { path: "node_modules/expo-camera", name: "expo-camera", version: "57.0.4" },
      { path: "node_modules/some-lib/node_modules/@expo/ui", name: "@expo/ui", version: "58.0.0" },
    ],
  );
  assert.throws(() => lockfileCopies({ packages: { "": {} } }), /lists no installed packages/);
});

// ── sdkLineViolations ────────────────────────────────────────────────────────

const copiesOf = (versions) =>
  Object.entries(versions).map(([name, version]) => ({ path: `node_modules/${name}`, name, version }));

test("flags a package off the line, and only that one", () => {
  const violations = sdkLineViolations({
    declared: {
      "expo-apple-authentication": "58.0.0",
      "expo-camera": "~57.0.4",
      "@expo/vector-icons": "^15.0.3",
      react: "19.2.3",
    },
    bundled: {
      "expo-apple-authentication": "~57.0.1",
      "expo-camera": "~57.0.3",
      "@expo/vector-icons": "^15.0.2",
      react: "19.2.0",
    },
    copies: copiesOf({
      "expo-apple-authentication": "58.0.0",
      "expo-camera": "57.0.4",
      "@expo/vector-icons": "15.1.1",
      react: "19.2.3",
    }),
  });
  assert.deepEqual(violations, [
    "expo-apple-authentication@58.0.0 is outside this SDK's line: expected ~57.0.1",
  ]);
});

test("checks the installed version, not the declared range", () => {
  // A caret in package.json can resolve past the line; the lockfile's pick is
  // what ships.
  const violations = sdkLineViolations({
    declared: { "expo-localization": "^57.0.1" },
    bundled: { "expo-localization": "~57.0.1" },
    copies: copiesOf({ "expo-localization": "58.0.0" }),
  });
  assert.equal(violations.length, 1);
});

test("checks transitive and nested copies, which apps/mobile never declares", () => {
  // expo-modules-core is the other side of the #2218 break, and only ever
  // arrives transitively.
  const violations = sdkLineViolations({
    declared: { expo: "~57.0.13" },
    bundled: { "expo-modules-core": "~57.0.11", "@expo/ui": "~57.0.11" },
    copies: [
      { path: "node_modules/expo-modules-core", name: "expo-modules-core", version: "58.0.0" },
      { path: "node_modules/@expo/ui", name: "@expo/ui", version: "57.0.11" },
      { path: "node_modules/some-lib/node_modules/@expo/ui", name: "@expo/ui", version: "58.0.2" },
    ],
  });
  assert.deepEqual(violations, [
    "expo-modules-core@58.0.0 is outside this SDK's line: expected ~57.0.11",
    "@expo/ui@58.0.2 (at node_modules/some-lib/node_modules/@expo/ui) is outside this SDK's line: expected ~57.0.11",
  ]);
});

test("an Expo package the SDK's map doesn't know fails instead of passing unchecked", () => {
  const violations = sdkLineViolations({
    declared: { "expo-something-new": "~1.0.0" },
    bundled: {},
    copies: copiesOf({ "expo-something-new": "1.0.0" }),
  });
  assert.match(violations[0], /has no entry for it/);
});

test("a declared package the lockfile doesn't install fails", () => {
  const violations = sdkLineViolations({
    declared: { "expo-camera": "~57.0.4" },
    bundled: { "expo-camera": "~57.0.3" },
    copies: copiesOf({ react: "19.2.3" }),
  });
  assert.match(violations[0], /not in package-lock.json/);
});

test("leaves Sentry and Stripe to #2336, though the map lists them", () => {
  const violations = sdkLineViolations({
    declared: { "@sentry/react-native": "^8.28.0", "@stripe/stripe-react-native": "0.78.0" },
    bundled: { "@sentry/react-native": "~7.11.0", "@stripe/stripe-react-native": "0.64.0" },
    copies: copiesOf({
      "@sentry/react-native": "8.28.0",
      "@stripe/stripe-react-native": "0.78.0",
    }),
  });
  assert.deepEqual(violations, []);
});

// ── dependabotIgnoreNames ────────────────────────────────────────────────────

const DEPENDABOT = `version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    groups:
      minor-and-patch:
        patterns:
          - "expo-not-an-ignore"
    ignore:
      - dependency-name: "react"
      # a comment between entries
      - dependency-name: "expo-camera"

      - dependency-name: 'expo-crypto' # trailing comment
      - dependency-name: expo-device
        update-types: ["version-update:semver-major"]
    labels:
      - dependency-name-lookalike
  - package-ecosystem: github-actions
    directory: "/"
    ignore:
      - dependency-name: "expo-from-the-wrong-entry"
`;

test("reads the npm root entry's ignore list, and nothing else", () => {
  assert.deepEqual(dependabotIgnoreNames(DEPENDABOT), [
    "react",
    "expo-camera",
    "expo-crypto",
    "expo-device",
  ]);
});

test("stops at the ignore list's end, so a following allow: list isn't read as ignored", () => {
  const withAllow = DEPENDABOT.replace(
    "    labels:\n",
    '    allow:\n      - dependency-name: "expo-allowed"\n    labels:\n',
  );
  assert.ok(withAllow.includes("expo-allowed"));
  assert.ok(!dependabotIgnoreNames(withAllow).includes("expo-allowed"));
});

test("a restructured file fails loudly instead of reading as an empty roster", () => {
  assert.throws(
    () => dependabotIgnoreNames(DEPENDABOT.replace("package-ecosystem: npm", "package-ecosystem: pip")),
    /no npm entry/,
  );
  assert.throws(
    () => dependabotIgnoreNames(DEPENDABOT.replace("    ignore:\n      - dependency-name: \"react\"", "    ignored:")),
    /no ignore list/,
  );
  assert.throws(
    () =>
      dependabotIgnoreNames(`updates:
  - package-ecosystem: npm
    directory: "/"
    ignore:
    labels:
      - x
`),
    /names nothing/,
  );
});

test("reads the repo's real dependabot.yml", () => {
  const names = dependabotIgnoreNames(readFileSync(".github/dependabot.yml", "utf8"));
  assert.ok(names.includes("expo-apple-authentication"));
  assert.ok(names.includes("@expo/*"));
  assert.ok(!names.includes("expo-server-sdk"));
});

// ── rosterViolations ─────────────────────────────────────────────────────────

const FULL_ROSTER = ["expo", "@expo/*"];

test("an expo-* package Dependabot may bump is a violation, from any section", () => {
  const violations = rosterViolations({
    declared: { expo: "~57.0.13", "expo-camera": "~57.0.4", "expo-dev-client": "~57.0.1" },
    installedSdkNames: new Set(),
    ignoreNames: [...FULL_ROSTER, "expo-camera"],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^expo-dev-client: not in/);
});

test("expo and the @expo/* glob are required", () => {
  const violations = rosterViolations({
    declared: { expo: "~57.0.13" },
    installedSdkNames: new Set(["@expo/metro-runtime"]),
    ignoreNames: ["expo-camera-unrelated-but-installed"],
  });
  assert.match(violations.join("\n"), /^expo: not in/m);
  assert.match(violations.join("\n"), /^@expo\/\*: not in/m);
});

test("a stale expo-* entry is a violation; a transitive one and a non-expo one are not", () => {
  const violations = rosterViolations({
    declared: { expo: "~57.0.13", "expo-camera": "~57.0.4" },
    installedSdkNames: new Set(["expo-modules-core"]),
    ignoreNames: [...FULL_ROSTER, "expo-camera", "expo-modules-core", "expo-document-picker", "colorjs.io"],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^expo-document-picker: listed .* remove the entry/);
});

test("an entry for another workspace's expo-* package is refused, though it is installed", () => {
  // main() passes only installed packages the SDK's map lists, and
  // expo-server-sdk (apps/api's push client) is not one: listing it would
  // freeze it silently.
  const violations = rosterViolations({
    declared: { expo: "~57.0.13" },
    installedSdkNames: new Set(["expo-modules-core"]),
    ignoreNames: [...FULL_ROSTER, "expo-server-sdk"],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^expo-server-sdk: listed/);
});

test("an expo-* glob is refused, because it would freeze expo-server-sdk", () => {
  const violations = rosterViolations({
    declared: { "expo-camera": "~57.0.4" },
    installedSdkNames: new Set(),
    ignoreNames: ["expo-*"],
  });
  assert.equal(violations.length, 2);
  assert.match(violations.join("\n"), /expo-camera: not in/);
  assert.match(violations.join("\n"), /expo-\*: a glob/);
});

// ── main, against a fixture tree ─────────────────────────────────────────────

function fixtureTree({ dependencies, devDependencies, installed, bundled, dependabot }) {
  const root = mkdtempSync(join(tmpdir(), "expo-sdk-line-"));
  const write = (path, value) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  write("apps/mobile/package.json", { dependencies, devDependencies });
  const packages = { "": { name: "root" } };
  for (const [name, version] of Object.entries(installed)) {
    packages[`node_modules/${name}`] = { version };
  }
  write("package-lock.json", { lockfileVersion: 3, packages });
  if (installed.expo) write("node_modules/expo/package.json", { name: "expo", version: installed.expo });
  if (bundled) write("node_modules/expo/bundledNativeModules.json", bundled);
  write(".github/dependabot.yml", dependabot);
  return root;
}

const TREE_DEPENDABOT = `updates:
  - package-ecosystem: npm
    directory: "/"
    ignore:
      - dependency-name: "expo"
      - dependency-name: "@expo/*"
      - dependency-name: "expo-camera"
`;

test("main is green on a coherent tree and red on a #2218-shaped one", () => {
  const coherent = fixtureTree({
    dependencies: { expo: "~57.0.13", "expo-camera": "~57.0.4" },
    installed: { expo: "57.0.13", "expo-camera": "57.0.4" },
    bundled: { "expo-camera": "~57.0.3" },
    dependabot: TREE_DEPENDABOT,
  });
  const bumped = fixtureTree({
    dependencies: { expo: "~57.0.13", "expo-camera": "58.0.0" },
    installed: { expo: "57.0.13", "expo-camera": "58.0.0" },
    bundled: { "expo-camera": "~57.0.3" },
    dependabot: TREE_DEPENDABOT,
  });
  try {
    const green = main(coherent);
    assert.deepEqual(green.violations, []);
    assert.equal(green.expoVersion, "57.0.13");
    assert.equal(green.checked, 1);
    assert.deepEqual(main(bumped).violations, [
      "expo-camera@58.0.0 is outside this SDK's line: expected ~57.0.3",
    ]);
  } finally {
    rmSync(coherent, { recursive: true, force: true });
    rmSync(bumped, { recursive: true, force: true });
  }
});

test("main fails when expo's map isn't installed, rather than checking nothing", () => {
  const root = fixtureTree({
    dependencies: { expo: "~57.0.13", "expo-camera": "~57.0.4" },
    installed: { "expo-camera": "57.0.4" },
    bundled: null,
    dependabot: TREE_DEPENDABOT,
  });
  try {
    const { violations } = main(root);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /no SDK to check against/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("main reads the map from the copy of expo apps/mobile resolves first", () => {
  // A nested apps/mobile/node_modules/expo shadows the hoisted one for the
  // app, so its map is the SDK that ships.
  const root = fixtureTree({
    dependencies: { expo: "~58.0.0", "expo-camera": "~57.0.4" },
    installed: { expo: "57.0.13", "expo-camera": "57.0.4" },
    bundled: { "expo-camera": "~57.0.3" },
    dependabot: TREE_DEPENDABOT,
  });
  try {
    mkdirSync(join(root, "apps/mobile/node_modules/expo"), { recursive: true });
    writeFileSync(
      join(root, "apps/mobile/node_modules/expo/package.json"),
      JSON.stringify({ name: "expo", version: "58.0.1" }),
    );
    writeFileSync(
      join(root, "apps/mobile/node_modules/expo/bundledNativeModules.json"),
      JSON.stringify({ "expo-camera": "~58.0.0" }),
    );
    const { expoVersion, violations } = main(root);
    assert.equal(expoVersion, "58.0.1");
    assert.deepEqual(violations, ["expo-camera@57.0.4 is outside this SDK's line: expected ~58.0.0"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("main reports roster violations as well as SDK-line ones", () => {
  const root = fixtureTree({
    dependencies: { expo: "~57.0.13", "expo-camera": "~57.0.4", "expo-crypto": "~57.0.1" },
    installed: { expo: "57.0.13", "expo-camera": "57.0.4", "expo-crypto": "57.0.1" },
    bundled: { "expo-camera": "~57.0.3", "expo-crypto": "~57.0.1" },
    dependabot: TREE_DEPENDABOT,
  });
  try {
    const { violations } = main(root);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /^expo-crypto: not in .*ignore list/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The exit code is the only thing CI reads, so the CLI itself is run, from a
// fixture tree as its working directory.
const SCRIPT = resolve("scripts/check-expo-sdk-line.mjs");

test("the CLI exits 1 on a violation and 0 on a coherent tree", () => {
  const coherent = fixtureTree({
    dependencies: { expo: "~57.0.13", "expo-camera": "~57.0.4" },
    installed: { expo: "57.0.13", "expo-camera": "57.0.4" },
    bundled: { "expo-camera": "~57.0.3" },
    dependabot: TREE_DEPENDABOT,
  });
  const bumped = fixtureTree({
    dependencies: { expo: "~57.0.13", "expo-camera": "58.0.0" },
    installed: { expo: "57.0.13", "expo-camera": "58.0.0" },
    bundled: { "expo-camera": "~57.0.3" },
    dependabot: TREE_DEPENDABOT,
  });
  try {
    const green = spawnSync(process.execPath, [SCRIPT], { cwd: coherent, encoding: "utf8" });
    assert.equal(green.status, 0, green.stderr);
    const red = spawnSync(process.execPath, [SCRIPT], { cwd: bumped, encoding: "utf8" });
    assert.equal(red.status, 1, red.stdout);
    assert.match(red.stderr, /expo-camera@58\.0\.0 is outside this SDK's line/);
  } finally {
    rmSync(coherent, { recursive: true, force: true });
    rmSync(bumped, { recursive: true, force: true });
  }
});

test("main refuses an ignore entry for an installed package the SDK's map doesn't list", () => {
  const root = fixtureTree({
    dependencies: { expo: "~57.0.13", "expo-camera": "~57.0.4" },
    installed: { expo: "57.0.13", "expo-camera": "57.0.4", "expo-server-sdk": "7.2.0" },
    bundled: { "expo-camera": "~57.0.3" },
    dependabot: TREE_DEPENDABOT.replace(
      '      - dependency-name: "expo-camera"\n',
      '      - dependency-name: "expo-camera"\n      - dependency-name: "expo-server-sdk"\n',
    ),
  });
  try {
    const { violations } = main(root);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /^expo-server-sdk: listed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("main gates a devDependency and accepts an ignore entry for a transitive SDK package", () => {
  const root = fixtureTree({
    dependencies: { expo: "~57.0.13" },
    devDependencies: { "expo-dev-client": "~57.0.1" },
    installed: { expo: "57.0.13", "expo-dev-client": "58.0.0", "expo-modules-core": "57.0.11" },
    bundled: { "expo-dev-client": "~57.0.1", "expo-modules-core": "~57.0.11" },
    dependabot: TREE_DEPENDABOT.replace(
      '      - dependency-name: "expo-camera"\n',
      '      - dependency-name: "expo-modules-core"\n',
    ),
  });
  try {
    assert.deepEqual(main(root).violations, [
      "expo-dev-client@58.0.0 is outside this SDK's line: expected ~57.0.1",
      "expo-dev-client: not in .github/dependabot.yml's ignore list, so Dependabot can move it off the SDK line",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── the CI step ──────────────────────────────────────────────────────────────

test("mobile-validate runs the gate right after npm ci, before expo export, unconditionally", () => {
  const steps = workflowSteps(".github/workflows/ci.yml").filter(
    (step) => step.jobId === "mobile-validate",
  );
  const at = (re) => steps.findIndex((step) => re.test(step.body));
  const install = at(/^\s*-?\s*run:\s*npm\s+ci\s*$/m);
  const gate = at(/^\s*-?\s*run:\s*npm\s+run\s+check:expo-sdk-line\s*$/m);
  const bundle = at(/\bexpo\s+export\b/);
  assert.ok(gate !== -1, "mobile-validate has no `npm run check:expo-sdk-line` step");
  assert.equal(gate, install + 1, "the gate runs right after npm ci");
  assert.ok(gate < bundle, "the gate runs before expo export, so its diagnosis prints when the bundle breaks too");
  assert.doesNotMatch(steps[gate].body, /^\s*(if|continue-on-error):/m, "the gate must be able to fail the job");
});
