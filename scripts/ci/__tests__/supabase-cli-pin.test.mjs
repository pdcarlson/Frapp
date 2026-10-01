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
import { workflowSteps } from "./helpers/workflow-yaml.mjs";

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
// `supabase` is on PATH" would pass the npx scan above, so the code lines (comments and quoted
// strings stripped, since both name the CLI in prose) must hold no bare `supabase <command>`.
function codeOnly(text) {
  const kept = [];
  let heredoc = null; // a heredoc body is text to print, like a quoted string
  for (const line of text.split("\n")) {
    if (heredoc) {
      if (line.trim() === heredoc) heredoc = null;
      continue;
    }
    if (/^\s*#/.test(line)) continue;
    // `<<EOF`, `<<'EOF'`, `<<-SQL`; never `<<<` (a herestring) or a `$(( a << 2 ))` shift.
    heredoc = /\$\(\(/.test(line) ? null : (line.match(/(?<!<)<<-?\s*(['"]?)([A-Za-z_]\w*)\1(?!\w)/)?.[2] ?? null);
    kept.push(line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""'));
  }
  return kept.join("\n");
}
const BARE_CLI = /(^|[\s;|&(!])supabase\s+[a-z]/m;

test("the local-run shell scripts call the CLI only through the pinned resolver", () => {
  for (const path of [
    "scripts/local-dev-setup.sh",
    "scripts/db-restore-rehearsal.sh",
    "scripts/cloud-sandbox-up.sh",
    "scripts/cloud-sandbox-setup.sh",
  ]) {
    const code = codeOnly(readFileSync(join(REPO, path), "utf8"));
    const bare = code.split("\n").filter((line) => BARE_CLI.test(line));
    assert.deepEqual(bare, [], `${path} runs a bare \`supabase\`; use frapp_supabase / cs_supabase`);
  }
  // Raw text here: these calls carry quoted arguments, which codeOnly blanks.
  const setup = readFileSync(join(REPO, "scripts/local-dev-setup.sh"), "utf8");
  assert.match(setup, /^\. "\$ROOT\/scripts\/lib\/supabase-cli\.sh"$/m, "local-dev-setup.sh must source the shared resolver");
  for (const call of [/frapp_supabase start/, /^frapp_supabase db push --local$/m, /frapp_repair_local_acls "\$ROOT" frapp_supabase/]) {
    assert.match(setup, call, `local-dev-setup.sh no longer runs ${call} through the pinned resolver`);
  }
  const rehearsal = readFileSync(join(REPO, "scripts/db-restore-rehearsal.sh"), "utf8");
  assert.match(rehearsal, /^SUPABASE=frapp_supabase$/m, "pass B must run the pinned resolver");
  // Its backup half is db-backup.sh, which takes the `supabase` on PATH: the pinned copy goes first.
  assert.match(rehearsal, /^PINNED_CLI_PATH="\$ROOT\/\.cache\/supabase-cli\/node_modules\/\.bin:\$PATH"$/m);
  assert.match(rehearsal, /^PATH="\$PINNED_CLI_PATH" \.\/scripts\/db-backup\.sh /m, "the backup half must run the pinned CLI");
});

test("the bare-CLI scan sees a call and ignores prose", () => {
  for (const line of ["supabase start", "  supabase db push --local", "x && supabase stop || true"]) {
    assert.match(codeOnly(line), BARE_CLI, line);
  }
  for (const line of [
    "frapp_supabase start",
    "cs_supabase db push --local",
    'log_err "supabase start failed."',
    "# supabase stop --no-backup",
    "$SUPABASE db push --local",
  ]) {
    assert.doesNotMatch(codeOnly(line), BARE_CLI, line);
  }
  assert.doesNotMatch(codeOnly("cat <<'EOF'\n  --reset  Run supabase stop first\nEOF\nfrapp_supabase start"), BARE_CLI);
  // Neither a herestring nor a shift starts a heredoc, so the code after them is still scanned.
  assert.match(codeOnly('grep -q x <<<"$(tail -n 3 "$log")"\nsupabase start'), BARE_CLI);
  assert.match(codeOnly("n=$((1 << n))\nsupabase start"), BARE_CLI);
});

test("the JS scripts pick their CLI through resolveSupabaseCli", () => {
  for (const path of ["scripts/run-migration.mjs", "scripts/ci/check-migration-replay.mjs"]) {
    assert.match(readFileSync(join(REPO, path), "utf8"), /resolveSupabaseCli\(/, `${path} must pick its CLI through resolveSupabaseCli`);
  }
});

// ── The drift gate rehearses a CLI change (#723) ────────────────────────────
// Against production's real state a CLI bump usually finds nothing pending, and the replay then
// runs neither `db reset` nor `migration up` on the new build. The wiring that makes it do so
// lives only in the workflow.
test("a change to the CLI or the replay makes the drift gate run both replay phases", () => {
  const steps = workflowSteps(join(REPO, ".github", "workflows", "migration-drift-gate.yml")).filter(
    (step) => step.jobId === "migration-replay",
  );
  const touched = steps.find((step) => step.name === "Does this change touch migrations?");
  const replay = steps.find((step) => step.name === "Replay pending migrations against production's applied state");
  assert.ok(touched && replay, "the migration-replay job's touched or replay step was renamed or removed");

  const cliPaths = touched.body.match(/CLI_PATHS='([^']+)'/)?.[1];
  assert.ok(cliPaths, "the touched step no longer names the CLI paths");
  const cli = new RegExp(cliPaths);
  for (const path of [
    ".github/actions/supabase-cli/action.yml",
    "scripts/ci/supabase-start-disposable.sh",
    "scripts/ci/check-migration-replay.mjs",
  ]) {
    assert.match(path, cli, `${path} must count as a CLI change`);
  }
  assert.doesNotMatch("supabase/migrations/20260101000000_x.sql", cli);
  assert.match(touched.body, /grep -qE "\$CLI_PATHS" "\$CHANGED"; then\s*\n\s*echo "cli=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(touched.body, /\|\| grep -qE "\$CLI_PATHS" "\$CHANGED"; then\s*\n\s*echo "run=true"/, "a CLI change must start the replay at all");

  assert.equal(replay.env.get("CLI_TOUCHED"), "${{ steps.touched.outputs.cli }}");
  assert.match(
    replay.body,
    /if \[ "\$\{CLI_TOUCHED:-\}" = "true" \]; then[\s\S]*?node scripts\/ci\/check-migration-replay\.mjs --rehearse-newest [1-9]/,
  );
});
