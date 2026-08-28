// Minimal `.env` reader for the repo's root-level Node scripts.
//
// Hand-rolled rather than pulling in `dotenv`, which is deliberately not a
// dependency of this workspace — the same call `apps/api/test/integration/stack.ts`
// documents for its own copy ("a test harness is a poor reason to add a runtime
// dependency"). A one-file governance script is an even poorer one.
//
// Secrets here still come from Infisical on the primary path
// (`docs/internal/environment/SECRETS_MANAGEMENT.md` § Key Design Principles).
// This covers the documented fallback — and the operator credentials that were
// never Infisical-managed to begin with, `GITHUB_PAT` being the one that
// motivated this file (`docs/internal/environment/AGENT_CREDENTIALS.md`).

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Matches a POSIX-ish env var name. Anything else in the key position is a
// malformed line, not a variable, and is skipped rather than imported as junk.
const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

// An unquoted value ends at the first ` #` — dotenv's rule. Anything needing a
// literal ` #` has to be quoted, which is also dotenv's answer.
const TRAILING_COMMENT = /\s+#.*$/;

/**
 * Parse `KEY=value` pairs out of `.env`-shaped text.
 *
 * Supported, because these are the shapes people actually write:
 *   - blank lines and `#` comments
 *   - a leading `export ` (the branch-protection runbook spells the token out as
 *     `export GITHUB_PAT=<token>`, so a `.env` built by pasting from it has one)
 *   - single- or double-quoted values, with `\n` unescaped inside double quotes
 *   - trailing inline comments on unquoted values
 *
 * NOT supported: values spanning multiple lines. No secret this reads is
 * multi-line, and the lookahead needed to do it correctly is not worth carrying.
 *
 * Malformed lines are skipped rather than thrown on: a stray line in a local
 * file should not take down a script that may not even need the value.
 */
export function parseEnvFile(contents) {
  const out = {};

  for (const rawLine of contents.split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("export ")) line = line.slice("export ".length).trim();

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!VALID_KEY.test(key)) continue;

    let value = line.slice(eq + 1).trim();

    const quote = value[0];
    if (
      (quote === '"' || quote === "'") &&
      value.length > 1 &&
      value.endsWith(quote)
    ) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      value = value.replace(TRAILING_COMMENT, "");
    }

    out[key] = value;
  }

  return out;
}

/**
 * Load env files into `env` (default `process.env`) without clobbering anything
 * already set.
 *
 * Two precedence rules, both inherited rather than invented:
 *
 *   1. An already-set variable always wins over a file. Exporting in the shell
 *      overrides the file, and a hosted agent VM — which injects `GITHUB_PAT`
 *      into the environment directly — is unaffected by a stale `.env` sitting
 *      in the checkout. Same rule as `stack.ts`'s `loadLocalEnv()` and as
 *      `ConfigModule.forRoot({ envFilePath })` in `apps/api/src/app.module.ts`.
 *   2. Earlier files in `files` win over later ones, so the default
 *      `.env.local` → `.env` order matches that same `envFilePath` array and
 *      what `docs/internal/environment/LOCAL_DEV.md` tells developers to expect.
 *
 * A missing file is a normal state, not an error — most runs have neither.
 *
 * @returns {string[]} the files that were read, in the order they were applied.
 */
export function loadEnvFiles({
  dir,
  files = [".env.local", ".env"],
  env = process.env,
} = {}) {
  const loaded = [];

  for (const file of files) {
    let contents;
    try {
      contents = readFileSync(join(dir, file), "utf8");
    } catch {
      continue; // absent, or unreadable — either way there is nothing to apply
    }

    loaded.push(file);
    for (const [key, value] of Object.entries(parseEnvFile(contents))) {
      if (env[key] === undefined) env[key] = value;
    }
  }

  return loaded;
}
