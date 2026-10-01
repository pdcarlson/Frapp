/**
 * The repo's pinned Supabase CLI version, read from the one place it is written:
 * `.github/actions/supabase-cli/action.yml`, the setup step every CI job that needs the CLI
 * calls.
 *
 * For the scripts that also run outside CI, where nothing put the pinned CLI on PATH: a laptop
 * driving `run-migration.mjs`, or a local `check-migration-replay.mjs`. Their fallback used to be
 * bare `npx supabase`, i.e. whatever `latest` was that day, which for
 * `run-migration.mjs --env production` meant production DDL applied by an unpinned CLI (#723).
 *
 * The shell scripts that need the version (`scripts/lib/supabase-cli.sh`, `scripts/db-backup.sh`,
 * `scripts/db-restore-rehearsal.sh`) keep a literal instead, held equal to this one by
 * `infisical-secrets-action.test.mjs`: an empty parse there would install `latest` silently.
 */
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

/**
 * Which CLI to run: the one on PATH only when it IS the pinned version, otherwise the pinned
 * version through npx.
 *
 * `pathVersionOutput` is what `supabase --version` printed, or `null` when there is no
 * `supabase` on PATH. In CI the action put the pin there, so CI keeps using it. On a laptop a
 * global install of any other version is passed over rather than trusted, because "the
 * migration that ran was applied by the same CLI the rehearsal used" is only true if both are
 * the pin.
 */
export function chooseSupabaseCli({ pin, pathVersionOutput }) {
  // A line that is only the version: the CLI can also print "A new version of Supabase CLI is
  // available: v2.119.0", and a first-match parse would read that as what is installed.
  const onPath = pathVersionOutput?.match(/^\s*v?(\d+\.\d+\.\d+)\s*$/m)?.[1] ?? null;
  if (onPath === pin) {
    return { command: "supabase", prefixArgs: [], note: `Using the pinned Supabase CLI ${pin} from PATH.` };
  }
  const why =
    pathVersionOutput == null
      ? "No Supabase CLI on PATH"
      : `The Supabase CLI on PATH is ${onPath ?? "an unrecognised version"}, not the pinned ${pin}`;
  return {
    command: "npx",
    prefixArgs: ["--yes", `supabase@${pin}`],
    note: `${why}; running the pinned ${pin} through npx.`,
  };
}
