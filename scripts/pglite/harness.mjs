// The state every PGlite gate module shares: the one database, the repo root,
// and the count of failed assertions that `run.mjs` turns into the exit code.

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
// PGlite 0.5 unbundled the non-contrib extensions into their own packages —
// `./vector`, `./age`, `./pg_uuidv7` and friends all disappeared from the
// `exports` map, so this import is `@electric-sql/pglite-pgvector` now. The
// registration below is unchanged: same `vector` export, same constructor
// slot. That package peer-depends on an exact `@electric-sql/pglite`, so the
// two versions move together or `npm ci` says so.
import { vector } from "@electric-sql/pglite-pgvector";

export const REPO_ROOT = process.cwd();

// `vector` is registered ahead of any migration needing it (FRA-308). PGlite
// only makes a bundled extension *available*; `create extension vector` still
// has to be written in a migration, exactly like `pgcrypto`. Registering it
// adds no cost this gate can measure until then (the bundle is a lazily-unpacked
// tarball, not a running extension; wall-clock is unchanged within run-to-run
// noise) — and it is what lets the AI corpus migrations (ADR-13 §13) replay
// here instead of forcing a carve-out out of this gate. See the `pg_available_
// extensions` landmark in `landmarks.mjs`, which fails if this registration is ever dropped.
export const db = new PGlite({ extensions: { pgcrypto, vector } });
await db.waitReady;

export let missing = 0;

export async function runOne(lm) {
  try {
    const res = await db.query(lm.sql);
    if (lm.ok(res.rows)) {
      console.log(`OK    ${lm.name}`);
    } else {
      missing += 1;
      console.log(
        `MISS  ${lm.name}\n        ↳ rows=${JSON.stringify(res.rows).slice(0, 200)}`,
      );
    }
  } catch (e) {
    missing += 1;
    console.log(
      `ERR   ${lm.name}\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
    );
  }
}

export async function runAssertions(title, list) {
  console.log(`\n=== ${title} ===`);
  for (const lm of list) await runOne(lm);
}

// Count one failed assertion. Modules outside this one can read `missing` but
// not assign it (an imported binding is read-only), so they call this instead.
export function miss() {
  missing += 1;
}
