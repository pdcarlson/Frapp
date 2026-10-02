// agent-infra.md's table of `scripts/ci/lib/` modules is complete (#3011).
//
// The section tells an agent to reach for these before writing a helper, so a
// module missing from it is one the next script copies instead. It listed 6 of
// 17 modules before this test, and nothing noticed. The exports column is
// checked against what each module actually exports, read by importing it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT } from "./helpers/doc-sections.mjs";

const LIB_DIR = join(REPO_ROOT, "scripts", "ci", "lib");
const DOC = join(REPO_ROOT, "docs", "ci-cd", "agent-infra.md");
const HEADING = "## Shared CI script library (`scripts/ci/lib/`)";

/** `{ module: Set<export> }` from the section's table rows. */
function documentedModules() {
  const text = readFileSync(DOC, "utf8");
  const start = text.indexOf(HEADING);
  assert.ok(start >= 0, `agent-infra.md has no "${HEADING}" section`);
  const rest = text.slice(start + HEADING.length);
  const next = rest.search(/^## /m);
  const section = next < 0 ? rest : rest.slice(0, next);
  const rows = new Map();
  for (const line of section.split("\n")) {
    const row = /^\| `scripts\/ci\/lib\/([^`]+)` \| ([^|]*) \|/.exec(line);
    if (!row) continue;
    assert.ok(!rows.has(row[1]), `${row[1]} has two rows`);
    rows.set(
      row[1],
      new Set([...row[2].matchAll(/`([^`]+)`/g)].map((m) => m[1])),
    );
  }
  return rows;
}

const libModules = () =>
  readdirSync(LIB_DIR)
    .filter((name) => name.endsWith(".mjs"))
    .sort();

test("every scripts/ci/lib module has a row, and every row is a module", () => {
  const documented = [...documentedModules().keys()].sort();
  assert.ok(documented.length > 0, "the table was read");
  assert.deepEqual(documented, libModules());
});

test("each row lists exactly what its module exports", async () => {
  const documented = documentedModules();
  for (const name of libModules()) {
    const module = await import(pathToFileURL(join(LIB_DIR, name)).href);
    assert.deepEqual(
      [...(documented.get(name) ?? [])].sort(),
      Object.keys(module).sort(),
      `${name}'s row in agent-infra.md`,
    );
  }
});
