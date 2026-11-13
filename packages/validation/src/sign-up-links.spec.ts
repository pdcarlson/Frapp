import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signUpLinkKind } from "./sign-up-links";

const shared = JSON.parse(
  readFileSync(join(__dirname, "../sign-up-link-fixtures.json"), "utf8"),
) as { fixtures: { url: string; kind: string | null }[] };

describe("signUpLinkKind (#4215)", () => {
  // The same URLs the PGlite `activity-links` tier runs through
  // `activity_action_links`, so the two copies of the list can't drift.
  it.each(shared.fixtures.map((f) => [f.url, f.kind] as const))(
    "%s is %s",
    (url, kind) => {
      const parsed = new URL(url);
      expect(signUpLinkKind(parsed.hostname, parsed.pathname)).toBe(kind);
    },
  );
});
