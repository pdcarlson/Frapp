/**
 * The repo's pinned Supabase CLI version, read from the one place it is written:
 * `.github/actions/supabase-cli/action.yml`, the setup step every CI job that needs the CLI
 * calls.
 *
 * For the scripts that also run outside CI, where nothing put the pinned CLI on PATH: a laptop
 * driving `run-migration.mjs`, or a local `check-migration-replay.mjs`. Their fallback used to be
 * bare `npx supabase`, i.e. whatever `latest` was that day, which for
 * `run-migration.mjs --env production` meant production DDL applied by an unpinned CLI (#723).
 * `resolveSupabaseCli` below is the one place either decides which CLI to run.
 *
 * The shell scripts that need the version (`scripts/lib/supabase-cli.sh`, `scripts/db-backup.sh`)
 * keep a literal instead, held equal to this one by `infisical-secrets-action.test.mjs`: an
 * empty parse there would install `latest` silently.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SUPABASE_CLI_ACTION = fileURLToPath(
  new URL("../../../.github/actions/supabase-cli/action.yml", import.meta.url),
);

/**
 * The single exact `version:` the action declares. Throws on anything else, rather than
 * returning `undefined`: a caller that interpolated it would ask npx for `supabase@undefined`,
 * and one that dropped the suffix would be back on `latest`.
 */
export function parseSupabaseCliPin(actionYaml) {
  const pins = [...actionYaml.matchAll(/^\s+version:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  if (pins.length !== 1 || !/^\d+\.\d+\.\d+$/.test(pins[0])) {
    throw new Error(
      `expected exactly one exact \`version: x.y.z\` in ${SUPABASE_CLI_ACTION}, found ` +
        (pins.length === 0 ? "none" : pins.join(", ")),
    );
  }
  return pins[0];
}

export function readSupabaseCliPin({ path = SUPABASE_CLI_ACTION, readFile = readFileSync } = {}) {
  return parseSupabaseCliPin(readFile(path, "utf8"));
}

/** The shell resolver the sandbox and laptop bootstraps use, which installs the pin on first use. */
export const SUPABASE_CLI_SH = fileURLToPath(new URL("../../lib/supabase-cli.sh", import.meta.url));

/**
 * Which CLI to run, given what `supabase --version` printed (`pathVersionOutput`, or `null`
 * when there is no `supabase` on PATH).
 *
 * In CI (`inCi`), the CLI on PATH, whatever it reports. CI put it there through
 * `.github/actions/supabase-cli` at the TRUSTED ref, and the production rehearsal runs that same
 * binary. A deploy of an older commit (a rollback, or a green ancestor dispatched after a later
 * bump) carries an older pin in its own tree, and obeying that pin would apply production DDL
 * with a different CLI from the one the rehearsal just used: `_deploy.yml`'s trust split exists
 * to stop exactly that.
 *
 * Outside CI, the CLI on PATH only when it IS the pin: on a laptop, a global install of any
 * other version is passed over, because "applied by the CLI CI deploys with" is only true of
 * the pin. Otherwise the pin through `scripts/lib/supabase-cli.sh`, the resolver both
 * bootstraps use: it installs into the gitignored `.cache/supabase-cli/` once and reuses it.
 * Never `npx`, which re-downloads every session and can cache a tree whose platform binary was
 * skipped (that file's header has the failure).
 */
export function chooseSupabaseCli({ pin, pathVersionOutput, inCi = false }) {
  // A line that is only the version: the CLI can also print "A new version of Supabase CLI is
  // available: v2.119.0", and a first-match parse would read that as what is installed.
  const onPath = pathVersionOutput?.match(/^\s*v?(\d+\.\d+\.\d+)\s*$/m)?.[1] ?? null;
  if (pathVersionOutput != null && (inCi || onPath === pin)) {
    return {
      command: "supabase",
      prefixArgs: [],
      note:
        onPath === pin
          ? `Using the pinned Supabase CLI ${pin} from PATH.`
          : `Using the Supabase CLI on PATH (${onPath ?? "an unrecognised version"}), which CI installed ` +
            `from the trusted ref and the rehearsal also runs; this tree pins ${pin}.`,
    };
  }
  const why =
    pathVersionOutput == null
      ? "No Supabase CLI on PATH"
      : `The Supabase CLI on PATH is ${onPath ?? "an unrecognised version"}, not the pinned ${pin}`;
  return {
    command: "bash",
    prefixArgs: ["-c", '. "$0" && frapp_supabase "$@"', SUPABASE_CLI_SH],
    note: `${why}; running the pinned ${pin} through scripts/lib/supabase-cli.sh (installed into .cache/supabase-cli/ on first use).`,
  };
}

/** What `supabase --version` prints, or `null` when there is no runnable `supabase` on PATH. */
export function probeSupabaseOnPath() {
  try {
    return execFileSync("supabase", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** The CLI to run here and now: `chooseSupabaseCli` over this machine's PATH and the action's pin. */
export function resolveSupabaseCli({ env = process.env, probe = probeSupabaseOnPath } = {}) {
  return chooseSupabaseCli({ pin: readSupabaseCliPin(), pathVersionOutput: probe(), inCi: env.CI === "true" });
}
