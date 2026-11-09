import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  planMobileReleases,
  TAG_PREFIX,
  uploadedBuilds,
} from "../mint-mobile-release-tags.mjs";

const repo = "pdcarlson/Frapp";
const A = "a".repeat(40);
const B = "b".repeat(40);

describe("planMobileReleases", () => {
  it("makes one mobile-v tag per store version, oldest first, on the first recorded commit", () => {
    const plan = planMobileReleases(
      {
        builds: [
          {
            platform: "android",
            version: "0.10.0",
            build: "5",
            sha: B,
            recorded: "2026-11-06",
          },
          {
            platform: "ios",
            version: "0.9.2",
            build: "9",
            sha: A,
            recorded: "2026-11-05",
          },
          {
            platform: "ios",
            version: "0.10.0",
            build: "10",
            sha: A,
            recorded: "2026-11-06",
          },
        ],
      },
      { repo },
    );
    assert.deepEqual(
      plan.map((r) => [r.tag, r.sha]),
      [
        ["mobile-v0.9.2", A],
        ["mobile-v0.10.0", B],
      ],
    );
    assert.equal(
      plan[1].title,
      "Mobile 0.10.0 (Android build 5, iOS build 10)",
    );
    assert.match(
      plan[1].body,
      /compare\/mobile-v0\.9\.2\.\.\.mobile-v0\.10\.0/,
    );
    assert.doesNotMatch(plan[0].body, /Changes since/);
  });

  it("never yields a tag the deploy workflows' `v*` glob would pick up", () => {
    assert.ok(!TAG_PREFIX.startsWith("v"));
  });

  it("refuses an entry without a full SHA or an X.Y.Z version", () => {
    assert.throws(() =>
      planMobileReleases(
        { builds: [{ platform: "ios", version: "0.1", build: "1", sha: A }] },
        { repo },
      ),
    );
    assert.throws(() =>
      planMobileReleases(
        {
          builds: [
            { platform: "ios", version: "0.1.0", build: "1", sha: "abc" },
          ],
        },
        { repo },
      ),
    );
  });

  it("plans every version in the real registry", () => {
    const registry = JSON.parse(
      readFileSync(
        new URL(
          "../../../apps/mobile/store/shipped-builds.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const versions = new Set(registry.builds.map((b) => b.version));
    assert.equal(planMobileReleases(registry, { repo }).length, versions.size);
  });
});

describe("mobile-release-tags.yml", () => {
  const workflow = readFileSync(
    new URL(
      "../../../.github/workflows/mobile-release-tags.yml",
      import.meta.url,
    ),
    "utf8",
  );

  it("runs on main when the registry changes, in the automation environment", () => {
    assert.match(workflow, /branches: \[main\]/);
    assert.match(workflow, /apps\/mobile\/store\/shipped-builds\.json/);
    assert.match(workflow, /name: automation/);
    assert.match(workflow, /RELEASE_GITHUB_TOKEN/);
  });
});

describe("uploadedBuilds (#3783)", () => {
  const entry = (platform, build, recorded, extra = {}) => ({
    platform,
    version: "0.9.1",
    build,
    sha: A,
    recorded,
    ...extra,
  });
  it("keeps a dropped build in its version's Release, in recorded order", () => {
    const ios = entry("ios", "8", "2026-11-05");
    const android = entry("android", "3", "2026-11-05");
    const later = entry("ios", "9", "2026-11-06");
    const dropped = { ...ios, dropped: "2026-12-01", reason: "minimum raised" };
    const text = JSON.stringify({ builds: [android, later], dropped: [dropped] });
    assert.deepEqual(
      uploadedBuilds(text).map((b) => `${b.platform}+${b.build}`),
      ["android+3", "ios+8", "ios+9"],
    );
  });
  it("refuses a key repeated inside one entry instead of tagging the value JSON.parse kept", () => {
    const spliced = '{"builds":[{"platform":"ios","version":"0.9.1","build":"8","version":"0.9.2","sha":"' + A + '","recorded":"2026-11-05"}]}';
    assert.throws(() => uploadedBuilds(spliced), /repeats the key `version`/);
  });
});

