// The tiers `run.mjs` runs, found by filename: every `.mjs` file directly in
// `tiers/`, in filename order. Adding a tier is adding its file; no list names
// it, so two PRs that each add a tier touch no shared line (#4558).
//
// Each tier is a module whose body runs when it is imported. They share one
// database and run one at a time, each awaited before the next starts: two
// sibling static imports with top-level `await` are not guaranteed to finish
// in order, and `run.mjs` reads the failure count and closes the database once
// the last one returns.
//
// Filename order is a plain code-unit sort, not a locale one, so every machine
// runs the same order. No tier depends on running before or after another
// today (every order tried passed the same assertions). A tier that comes to
// need a place in the order gets a sortable prefix, such as `00-`, which sorts
// before every letter. A tier never imports another tier, which
// `pglite-filter-coverage.test.mjs` holds: the import would run the imported
// tier's body at the importer's turn, not its own. Shared setup lives beside
// `harness.mjs`, as `chat-read-enforcement.mjs` does.

import { readdirSync } from "node:fs";

export const TIERS_DIR = new URL("./tiers/", import.meta.url);

/** The tier files in `dir`, by name, in the order they run. */
export function tierFiles(dir = TIERS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .sort();
}

/** Import every tier, in order, each awaited before the next starts. */
export async function runTiers() {
  for (const file of tierFiles()) {
    await import(new URL(file, TIERS_DIR).href);
  }
}
