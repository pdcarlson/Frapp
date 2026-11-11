// Pins `scripts/ci/lib/client-version.mjs` (#3123) to the API's own rule.
//
// The deploy's config check judges `MOBILE_MIN_VERSION_*` with a copy of the
// API's parse, comparison and policy decision, because the trusted copy it
// runs from can't import the API. This loads the API's own code through Node's
// type stripping (`client-version.ts` as it is, and `resolveClientPolicy` from
// its service as `loadPolicyService` describes) and holds the copy to the same
// answer on every case below. A change to the API's rule fails here until the
// copy follows.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/**
 * The API's `resolveClientPolicy`, loaded from its source. It sits in a Nest
 * service, which plain Node can't load as written: `@Injectable()` is not
 * erasable syntax and `#domain/...` resolves through Nest's build. So the
 * test loads a copy with exactly those two things changed, the decorator and
 * its import dropped and the alias pointed at the file. If the service grows
 * another import this can't follow, this fails loudly rather than skipping.
 */
async function loadPolicyService() {
  const path = join(
    REPO_ROOT,
    "apps",
    "api",
    "src",
    "application",
    "services",
    "client-policy.service.ts",
  );
  const source = readFileSync(path, "utf8");
  // The service's `#domain/...` imports, each pointed at its file.
  const domainFile = (...parts) =>
    JSON.stringify(
      pathToFileURL(join(REPO_ROOT, "apps", "api", "src", "domain", ...parts))
        .href,
    );
  const rewritten = source
    .replace(/^import \{ Injectable \} from '@nestjs\/common';\n/m, "")
    .replace(/^@Injectable\(\)\n/m, "")
    .replace(
      "'#domain/constants/client-version'",
      domainFile("constants", "client-version.ts"),
    )
    .replace("'#domain/utils/env-value'", domainFile("utils", "env-value.ts"));
  const imports = [
    ...rewritten.matchAll(/^import[^;]*?from\s+['"]([^'"]+)['"]/gms),
  ].map((m) => m[1]);
  assert.deepEqual(
    imports.filter((spec) => !spec.startsWith("file:")),
    [],
    `${path} imports something this test can't load; teach loadPolicyService about it`,
  );
  const dir = mkdtempSync(join(tmpdir(), "client-policy-"));
  const copyPath = join(dir, "client-policy.service.mts");
  writeFileSync(copyPath, rewritten);
  try {
    return await import(pathToFileURL(copyPath).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const service = await loadPolicyService();

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
    for (const header of HEADERS) {
      const platform = api.parseClientVersionHeader(header)?.platform ?? "ios";
      for (const minimum of [...VERSIONS, undefined, "  ", 9]) {
        const env = { [service.MINIMUM_VERSION_ENV[platform]]: minimum };
        assert.equal(
          copy.wouldRequireUpdate(header, minimum),
          service.resolveClientPolicy(header, env).updateRequired,
          `${header} under ${JSON.stringify(minimum)}`,
        );
      }
    }
  });

  it("refuses an over-long header that would otherwise parse, as the API does", () => {
    const padded = `ios/${" ".repeat(61)}0.9.0`;
    assert.ok(padded.length > 64);
    assert.notEqual(
      api.parseVersionWithBuild(padded.slice(4)),
      null,
      "the version alone parses",
    );
    assert.equal(api.parseClientVersionHeader(padded), null);
    assert.equal(copy.parseClientVersionHeader(padded), null);
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
