import { test } from "node:test";
import assert from "node:assert/strict";

import { chooseSupabaseCli, parseSupabaseCliPin, readSupabaseCliPin } from "../lib/supabase-cli-pin.mjs";

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

test("reads the one exact version the action declares", () => {
  assert.equal(parseSupabaseCliPin(action("2.110.0")), "2.110.0");
  assert.match(readSupabaseCliPin(), /^\d+\.\d+\.\d+$/, "the real action parses");
});

// An empty or non-exact answer would reach `npx supabase@…` as `undefined` or a range,
// which is the unpinned `latest` this module exists to end.
test("refuses a missing, non-exact or duplicated pin rather than guessing", () => {
  assert.throws(() => parseSupabaseCliPin("runs:\n  using: composite\n"), /found none/);
  assert.throws(() => parseSupabaseCliPin(action("latest")), /found latest/);
  assert.throws(() => parseSupabaseCliPin(action("^2.110.0")), /exact/);
  assert.throws(() => parseSupabaseCliPin(`${action("2.110.0")}\n        version: 2.111.0`), /2\.110\.0, 2\.111\.0/);
});

test("the CLI on PATH is used only when it is the pin", () => {
  assert.deepEqual(
    (({ command, prefixArgs }) => ({ command, prefixArgs }))(
      chooseSupabaseCli({ pin: "2.110.0", pathVersionOutput: "2.110.0\n" }),
    ),
    { command: "supabase", prefixArgs: [] },
  );
});

test("no CLI on PATH runs the pin through npx, never bare `npx supabase`", () => {
  const chosen = chooseSupabaseCli({ pin: "2.110.0", pathVersionOutput: null });
  assert.equal(chosen.command, "npx");
  assert.deepEqual(chosen.prefixArgs, ["--yes", "supabase@2.110.0"]);
  assert.match(chosen.note, /No Supabase CLI on PATH/);
});

test("another version on PATH is passed over for the pin, and the log says which it was", () => {
  const chosen = chooseSupabaseCli({ pin: "2.110.0", pathVersionOutput: "2.119.0\n" });
  assert.deepEqual(chosen.prefixArgs, ["--yes", "supabase@2.110.0"]);
  assert.match(chosen.note, /on PATH is 2\.119\.0, not the pinned 2\.110\.0/);
});

// The CLI can announce a newer release next to its own version. Reading the first version
// anywhere in the output would mistake the announcement for what is installed.
test("an update notice naming another version does not pass for the installed one", () => {
  const out = "A new version of Supabase CLI is available: v2.119.0 (currently installed v2.110.0)\n2.110.0\n";
  assert.equal(chooseSupabaseCli({ pin: "2.110.0", pathVersionOutput: out }).command, "supabase");
  const stale = "A new version of Supabase CLI is available: v2.110.0\n2.77.0\n";
  assert.equal(chooseSupabaseCli({ pin: "2.110.0", pathVersionOutput: stale }).command, "npx");
});
