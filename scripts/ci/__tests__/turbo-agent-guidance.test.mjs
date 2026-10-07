import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// When turbo detects an AI agent it appends a managed `turborepo-agent-rules`
// block to the root AGENTS.md before every repository-scoped command, leaving
// each agent session with an uncommitted change (#3188). CI runs with no agent
// detected, so dropping the opt-out would turn nothing here red but this.
test("root turbo.json opts out of turbo's AGENTS.md agent guidance", () => {
  const config = JSON.parse(readFileSync(join(REPO, "turbo.json"), "utf8"));
  assert.equal(config.agentGuidance, false);
});
