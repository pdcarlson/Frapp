import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Pins the install-deps retry AND dropping GitHub's unused chrome apt
// source. That source Hash-Sum-mismatches and reds required
// `web-responsive-floor` before the 375px suite runs. The watchdog will
// not auto-requeue: the failed step is repo-defined. Do not skip apt
// hash checks and do not pin Chrome apt. The workflow step itself landed
// on main with #2015; this lock is what keeps it from drifting.

const WORKFLOWS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".github",
  "workflows",
);
const CI_YML = join(WORKFLOWS, "ci.yml");
const INSTALL_DEPS = "npx playwright install-deps chromium";
const HASH_CHECK_DISABLE = /Check-Valid-Until\s*=\s*false|Acquire::https::Verify-Peer\s*=\s*false|--allow-unauthenticated|APT::Get::AllowUnauthenticated/i;

function jobBlock(text, jobId) {
  const lines = text.split("\n");
  const key = (l) => l.replace(/\s+$/, "");
  const isHeader = (l) => /^ {2}["']?[a-zA-Z0-9_-]+["']?:(\s*#.*)?$/.test(key(l));
  const start = lines.findIndex(
    (l) =>
      key(l)
        .replace(/\s*#.*$/, "")
        .replace(/^( {2})["'](.+)["']:$/, "$1$2:") === `  ${jobId}:`,
  );
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeader(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function dropsChromeSourceAndRetries(text) {
  return (
    /google-chrome\.list/.test(text) &&
    /for i in 1 2 3;/.test(text) &&
    /\bsleep 20\b/.test(text) &&
    text.includes(INSTALL_DEPS)
  );
}

describe("playwright install-deps retries apt Hash Sum mismatch", () => {
  it("retries install-deps in web-responsive-floor and still runs the floor suite", () => {
    const text = readFileSync(CI_YML, "utf8");
    const block = jobBlock(text, "web-responsive-floor");
    assert.ok(block, "ci.yml must still define web-responsive-floor");
    assert.ok(
      dropsChromeSourceAndRetries(block),
      "web-responsive-floor must drop google-chrome.list and retry install-deps 3 times",
    );
    const depsAt = block.indexOf(INSTALL_DEPS);
    const floorAt = block.indexOf("npm run test:floor -w apps/web");
    assert.notEqual(floorAt, -1, "the 375px floor assertion must still run");
    assert.ok(
      depsAt < floorAt,
      "install-deps must still precede test:floor so a successful retry measures routes",
    );
    assert.doesNotMatch(
      block,
      HASH_CHECK_DISABLE,
      "do not skip apt hash checks or pin Chrome apt",
    );
    assert.doesNotMatch(
      block,
      /install-deps chromium\s*\|\|\s*true/,
      "a failed install-deps must fail the job, not be swallowed",
    );
  });

  it("retries every workflow install-deps, or has none besides the floor job", () => {
    const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"));
    const hits = [];
    for (const name of files) {
      const text = readFileSync(join(WORKFLOWS, name), "utf8");
      if (!text.includes(INSTALL_DEPS)) continue;
      hits.push(name);
      assert.ok(
        dropsChromeSourceAndRetries(text),
        `${name} runs install-deps and must drop chrome-stable then retry`,
      );
    }
    assert.deepEqual(
      hits,
      ["ci.yml"],
      "unexpected extra install-deps consumer — give it the retry or drop it",
    );
  });
});
