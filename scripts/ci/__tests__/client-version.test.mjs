// Pins `scripts/ci/lib/client-version.mjs` (#3123) to the API's own rule.
//
// The deploy's config check judges `MOBILE_MIN_VERSION_*` with a copy of the
// API's parse and comparison, because the trusted copy it runs from can't
// import the API. This loads the API's module itself through Node's type
// stripping (it is erasable TypeScript with no imports) and holds the copy to
// the same answer on every case below. A change to the API's rule fails here
// until the copy follows.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as copy from "../lib/client-version.mjs";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const api = await import(
  join(
    REPO_ROOT,
    "apps",
    "api",
    "src",
    "domain",
    "constants",
    "client-version.ts",
  )
);
const VERSIONS = [
  "0.9.0",
  "0.9.0+14",
  "0.9",
  "1",
  "1+2",
  " 0.9.0 ",
  "0.9.0+0",
  "0.09.0",
  "00.9.0",
  "0.9.0+014",
  "0.9.0-beta.1",
  "0.9.0.1",
  "v0.9.0",
  "",
  "+14",
  "0.9.0+",
  "999999999.0.0",
  "1000000000.0.0",
  "0.9.0+999999999",
  "0.9.0+1000000000",
  "abc",
];

const HEADERS = [
  "ios/0.9.0+14",
  "android/0.9.0+7",
  "IOS/0.9.0",
  " ios /0.9.0",
  "ios/ 0.9.0",
  "web/0.9.0",
  "ios",
  "ios/",
  "/0.9.0",
  "ios/0.9.0+1000000000",
  "ios/0.09.0",
  `ios/0.9.0+${"1".repeat(60)}`,
  `ios/${"0.".repeat(40)}0`,
  "android/1.0",
];

describe("lib/client-version.mjs: the API's client-version rule, copied", () => {
  it("parses every version as the API does", () => {
    for (const raw of VERSIONS) {
      assert.deepEqual(
        copy.parseVersionWithBuild(raw),
        api.parseVersionWithBuild(raw),
        JSON.stringify(raw),
      );
    }
  });

  it("parses every header as the API does", () => {
    for (const raw of [...HEADERS, undefined, ["ios/0.9.0"]]) {
      assert.deepEqual(
        copy.parseClientVersionHeader(raw),
        api.parseClientVersionHeader(raw),
        JSON.stringify(raw),
      );
    }
    assert.deepEqual(copy.CLIENT_PLATFORMS, [...api.CLIENT_PLATFORMS]);
  });

  it("compares every pair as the API does, builds and missing builds included", () => {
    const parsed = VERSIONS.map((raw) => api.parseVersionWithBuild(raw)).filter(
      Boolean,
    );
    assert.ok(parsed.length >= 8, `only ${parsed.length} versions parse`);
    for (const client of parsed) {
      for (const minimum of parsed) {
        assert.equal(
          copy.isBelowMinimum(client, minimum),
          api.isBelowMinimum(client, minimum),
          `${JSON.stringify(client)} below ${JSON.stringify(minimum)}`,
        );
      }
    }
  });

  it("decides update_required as resolveClientPolicy does, for every header and minimum", () => {
    // `resolveClientPolicy` itself sits in a Nest service, which plain Node
    // can't load (decorators aren't erasable), so its three lines are restated
    // from `client-policy.service.ts` over the API's own parse and compare:
    // a trimmed, non-blank minimum that parses, and a header that parses.
    const decide = (header, minimum) => {
      const client = api.parseClientVersionHeader(header);
      const raw =
        typeof minimum === "string" && minimum.trim() !== ""
          ? minimum.trim()
          : undefined;
      const parsed = raw === undefined ? null : api.parseVersionWithBuild(raw);
      return (
        client !== null && parsed !== null && api.isBelowMinimum(client, parsed)
      );
    };
    for (const header of HEADERS) {
      for (const minimum of [...VERSIONS, undefined, "  "]) {
        assert.equal(
          copy.wouldRequireUpdate(header, minimum),
          decide(header, minimum),
          `${header} under ${JSON.stringify(minimum)}`,
        );
      }
    }
  });

  it("covers the cases the issue names", () => {
    const below = (header, minimum) => copy.wouldRequireUpdate(header, minimum);
    assert.equal(
      below("ios/0.9.0", "0.9.0+14"),
      false,
      "no build on an equal version passes",
    );
    assert.equal(
      below("ios/0.9.0+1000000000", "0.9.1"),
      false,
      "a build past nine digits doesn't parse, so it passes",
    );
    assert.equal(
      below("ios/0.09.0", "9.9.9"),
      false,
      "a leading zero doesn't parse, so it passes",
    );
    assert.equal(
      below("ios/0.9.0+14", "0.09.1"),
      false,
      "a minimum with a leading zero is no minimum",
    );
    assert.equal(below("ios/0.9.0+14", "0.9.1"), true);
    assert.equal(below("ios/0.9.0+14", "0.9.0+15"), true);
    assert.equal(below("ios/0.9.0+14", "0.9.0+14"), false);
  });
});
