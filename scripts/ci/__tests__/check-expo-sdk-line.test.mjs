import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// check-expo-sdk-line.mjs is a general-purpose gate under scripts/ (a peer of
// the other check-*.mjs gates); its test lives here so the `test:ci-scripts`
// glob runs it — hence the ../../ reach up.
import {
  dependabotIgnoreNames,
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

// ── sdkLineViolations ────────────────────────────────────────────────────────

const installedFrom = (versions) => (name) => versions[name] ?? null;

test("flags a package off the line, and only that one", () => {
  const violations = sdkLineViolations({
    dependencies: {
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
    installedVersion: installedFrom({
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
    dependencies: { "expo-localization": "^57.0.1" },
    bundled: { "expo-localization": "~57.0.1" },
    installedVersion: installedFrom({ "expo-localization": "58.0.0" }),
  });
  assert.equal(violations.length, 1);
});

test("an Expo package the SDK's map doesn't know fails instead of passing unchecked", () => {
  const violations = sdkLineViolations({
    dependencies: { "expo-something-new": "~1.0.0" },
    bundled: {},
    installedVersion: installedFrom({ "expo-something-new": "1.0.0" }),
  });
  assert.match(violations[0], /has no entry for it/);
});

test("a declared package that isn't installed fails", () => {
  const violations = sdkLineViolations({
    dependencies: { "expo-camera": "~57.0.4" },
    bundled: { "expo-camera": "~57.0.3" },
    installedVersion: installedFrom({}),
  });
  assert.match(violations[0], /not installed/);
});

test("leaves Sentry and Stripe to #2336, though the map lists them", () => {
  const violations = sdkLineViolations({
    dependencies: { "@sentry/react-native": "^8.28.0", "@stripe/stripe-react-native": "0.78.0" },
    bundled: { "@sentry/react-native": "~7.11.0", "@stripe/stripe-react-native": "0.64.0" },
    installedVersion: installedFrom({
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

test("an expo-* dependency Dependabot may bump is a violation", () => {
  const violations = rosterViolations({
    dependencies: { "expo-camera": "~57.0.4", "expo-crypto": "~57.0.1" },
    ignoreNames: ["expo-camera"],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^expo-crypto: not in/);
});

test("a stale expo-* entry is a violation, a stale non-expo one is not this gate's", () => {
  const violations = rosterViolations({
    dependencies: { "expo-camera": "~57.0.4" },
    ignoreNames: ["expo-camera", "expo-document-picker", "colorjs.io"],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^expo-document-picker: listed .* remove the stale entry/);
});

test("an expo-* glob is refused, because it would freeze expo-server-sdk", () => {
  const violations = rosterViolations({
    dependencies: { "expo-camera": "~57.0.4" },
    ignoreNames: ["expo-*"],
  });
  assert.equal(violations.length, 2);
  assert.match(violations.join("\n"), /expo-camera: not in/);
  assert.match(violations.join("\n"), /expo-\*: a glob/);
});

// ── main, against a fixture tree ─────────────────────────────────────────────

function fixtureTree({ dependencies, installed, bundled, dependabot, bundledIn = "node_modules" }) {
  const root = mkdtempSync(join(tmpdir(), "expo-sdk-line-"));
  const write = (path, value) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
  };
  write("apps/mobile/package.json", { dependencies });
  for (const [name, version] of Object.entries(installed)) {
    write(`node_modules/${name}/package.json`, { name, version });
  }
  if (bundled) write(`${bundledIn}/expo/bundledNativeModules.json`, bundled);
  write(".github/dependabot.yml", dependabot);
  return root;
}

const TREE_DEPENDABOT = `updates:
  - package-ecosystem: npm
    directory: "/"
    ignore:
      - dependency-name: "expo"
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
