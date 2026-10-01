import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import * as opsDocs from "../lib/ops-docs.mjs";
import { REPO_ROOT } from "./helpers/doc-sections.mjs";

// Every path here is printed to an operator by a gate, an alert or a migration
// script, and nothing else checks it: lychee reads markdown links, not strings in
// a script. A doc that moves without its constant must fail here.
test("every ops doc a script names is a tracked file", () => {
  const paths = Object.entries(opsDocs);
  assert.ok(paths.length >= 5, "expected the ops-docs constants to be exported");
  for (const [name, path] of paths) {
    const tracked = execFileSync("git", ["ls-files", "--error-unmatch", path], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    assert.equal(tracked, path, `${name} names ${path}, which git does not track`);
  }
});
