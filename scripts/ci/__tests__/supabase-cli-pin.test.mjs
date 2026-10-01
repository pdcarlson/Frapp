import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SUPABASE_CLI_SH,
  chooseSupabaseCli,
  parseSupabaseCliPin,
  readSupabaseCliPin,
  resolveSupabaseCli,
} from "../lib/supabase-cli-pin.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const action = (version) =>
  [
    "runs:",
    "  using: composite",
    "  steps:",
    "    # version: 1.0.0 in a comment is not a pin",
    "    - uses: supabase/setup-cli@abc # v2.1.2",
    "      with:",
    `        version: ${version}`,
  ].join("\n");

const DELEGATE = ["-c", '. "$0" && frapp_supabase "$@"', SUPABASE_CLI_SH];
const picked = ({ command, prefixArgs }) => ({ command, prefixArgs });

test("reads the one exact version the action declares", () => {
  assert.equal(parseSupabaseCliPin(action("2.117.0")), "2.117.0");
  assert.match(readSupabaseCliPin(), /^\d+\.\d+\.\d+$/, "the real action parses");
});

// An empty or non-exact answer would reach the CLI install as `undefined` or a range,
// which is the unpinned `latest` this module exists to end.
test("refuses a missing, non-exact or duplicated pin rather than guessing", () => {
  assert.throws(() => parseSupabaseCliPin("runs:\n  using: composite\n"), /found none/);
  assert.throws(() => parseSupabaseCliPin(action("latest")), /found latest/);
  assert.throws(() => parseSupabaseCliPin(action("^2.117.0")), /exact/);
  assert.throws(() => parseSupabaseCliPin(`${action("2.117.0")}\n        version: 2.118.0`), /2\.117\.0, 2\.118\.0/);
});

test("outside CI, the CLI on PATH is used only when it is the pin", () => {
  assert.deepEqual(picked(chooseSupabaseCli({ pin: "2.117.0", pathVersionOutput: "2.117.0\n" })), {
    command: "supabase",
    prefixArgs: [],
  });
});

test("outside CI with no CLI on PATH, the pin runs through the shared shell resolver, never npx", () => {
  const chosen = chooseSupabaseCli({ pin: "2.117.0", pathVersionOutput: null });
  assert.deepEqual(picked(chosen), { command: "bash", prefixArgs: DELEGATE });
  assert.match(chosen.note, /No Supabase CLI on PATH/);
});

test("outside CI, another version on PATH is passed over for the pin, and the log says which it was", () => {
  const chosen = chooseSupabaseCli({ pin: "2.117.0", pathVersionOutput: "2.119.0\n" });
  assert.deepEqual(picked(chosen), { command: "bash", prefixArgs: DELEGATE });
  assert.match(chosen.note, /on PATH is 2\.119\.0, not the pinned 2\.117\.0/);
});

// The trust split (_deploy.yml): CI installs the CLI from the TRUSTED ref, and the production
// rehearsal runs that binary. A deploy of an older commit reads an older pin from its own
// tree. Obeying it would apply production DDL with a different CLI from the rehearsal's.
test("in CI the CLI on PATH wins even when the deployed tree pins another version", () => {
  const chosen = chooseSupabaseCli({ pin: "2.117.0", pathVersionOutput: "2.120.0\n", inCi: true });
  assert.deepEqual(picked(chosen), { command: "supabase", prefixArgs: [] });
  assert.match(chosen.note, /2\.120\.0.*trusted ref.*this tree pins 2\.117\.0/);
  // With nothing on PATH, CI still gets the pin, not `latest`.
  assert.deepEqual(picked(chooseSupabaseCli({ pin: "2.117.0", pathVersionOutput: null, inCi: true })), {
    command: "bash",
    prefixArgs: DELEGATE,
  });
});

test("resolveSupabaseCli reads CI from the environment and the pin from the action", () => {
  const pin = readSupabaseCliPin();
  const probe = () => "9.9.9\n";
  assert.equal(resolveSupabaseCli({ env: { CI: "true" }, probe }).command, "supabase");
  assert.equal(resolveSupabaseCli({ env: {}, probe }).command, "bash");
  assert.equal(resolveSupabaseCli({ env: {}, probe: () => `${pin}\n` }).command, "supabase");
});

// The CLI can announce a newer release next to its own version. Reading the first version
// anywhere in the output would mistake the announcement for what is installed.
test("an update notice naming another version does not pass for the installed one", () => {
  const out = "A new version of Supabase CLI is available: v2.119.0 (currently installed v2.117.0)\n2.117.0\n";
  assert.equal(chooseSupabaseCli({ pin: "2.117.0", pathVersionOutput: out }).command, "supabase");
  const stale = "A new version of Supabase CLI is available: v2.117.0\n2.77.0\n";
  assert.equal(chooseSupabaseCli({ pin: "2.117.0", pathVersionOutput: stale }).command, "bash");
});

// ── No script runs an unpinned CLI (#723) ───────────────────────────────────
//
// Bare `npx supabase` resolves whatever `latest` is that day. #723 removed it from
// local-dev-setup.sh, run-migration.mjs and check-migration-replay.mjs; nothing else would
// notice it coming back, because their own tests inject the CLI. Comments are skipped: they
// name the old form to explain why it is gone.

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(sh|mjs|js)$/.test(name)) out.push(path);
  }
  return out;
}

const UNPINNED_SHELL = /\bnpx\s+(?:--yes\s+|-y\s+)?supabase(?![@\w-])/;
// An argument list that starts with a bare "supabase" package name, as `npx` would take it.
const UNPINNED_ARGS = /\[\s*(?:["']--yes["']\s*,\s*)?["']supabase["']\s*[,\]]/;

test("no script under scripts/ runs `npx supabase` without a version", () => {
  const offenders = [];
  for (const file of sourceFiles(join(REPO, "scripts"))) {
    const shell = file.endsWith(".sh");
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(#|\/\/|\*|\/\*)/.test(line)) return;
        if (UNPINNED_SHELL.test(line) || (!shell && UNPINNED_ARGS.test(line))) {
          offenders.push(`${relative(REPO, file)}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(offenders, [], "run the pinned CLI (scripts/lib/supabase-cli.sh or resolveSupabaseCli)");
});

test("the scan itself catches each unpinned form", () => {
  for (const line of ["npx supabase start", "  npx --yes supabase db push --local", 'x "$ROOT" npx supabase; then']) {
    assert.match(line, UNPINNED_SHELL, line);
  }
  for (const line of ['prefixArgs: ["supabase"] }', 'supabaseArgs = ["--yes", "supabase"],']) {
    assert.match(line, UNPINNED_ARGS, line);
  }
  for (const line of ['SUPABASE="npx --yes supabase@${V}"', "frapp_supabase start", '["--yes", `supabase@${pin}`]']) {
    assert.doesNotMatch(line, UNPINNED_SHELL, line);
    assert.doesNotMatch(line, UNPINNED_ARGS, line);
  }
});

// Which resolver each local-run script goes through. A script that went back to "whatever
// `supabase` is on PATH" would pass the scan above.
test("the local-run scripts resolve the CLI through the pinned resolvers", () => {
  const read = (path) => readFileSync(join(REPO, path), "utf8");
  for (const path of ["scripts/local-dev-setup.sh", "scripts/db-restore-rehearsal.sh"]) {
    const text = read(path);
    assert.match(text, /^\. "\$ROOT\/scripts\/lib\/supabase-cli\.sh"$/m, `${path} must source the shared resolver`);
    assert.match(text, /frapp_supabase/, `${path} must run the CLI through frapp_supabase`);
  }
  for (const path of ["scripts/run-migration.mjs", "scripts/ci/check-migration-replay.mjs"]) {
    assert.match(read(path), /resolveSupabaseCli\(/, `${path} must pick its CLI through resolveSupabaseCli`);
  }
});
