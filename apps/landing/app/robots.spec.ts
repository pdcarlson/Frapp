import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SEARCH_INDEXING_ENABLED,
  SEARCH_ROBOTS_METADATA,
  searchIndexingHeaders,
} from "@repo/validation/search-indexing";
import { describe, expect, it } from "vitest";
import robots from "./robots";

/**
 * Hidden from search while Frapp is in testing (#4758). One switch,
 * `SEARCH_INDEXING_ENABLED`, drives the landing and the web app.
 */
describe("search indexing switch", () => {
  it("is off while Frapp is in testing", () => {
    expect(SEARCH_INDEXING_ENABLED).toBe(false);
    expect(SEARCH_ROBOTS_METADATA).toEqual({ index: false, follow: false });
  });

  it("lets crawlers fetch every page, so they can read its noindex", () => {
    const { rules } = robots();
    expect(rules).toEqual([{ userAgent: "*", allow: "/" }]);
  });

  it("sends X-Robots-Tag on every path, files without a <head> included", () => {
    expect(searchIndexingHeaders()).toEqual([
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ]);
  });

  it.each([["landing"], ["web"]])(
    "the %s next.config.js serves those headers",
    async (app) => {
      const path = join(__dirname, "..", "..", app, "next.config.js");
      const config = (await import(path)).default;
      expect(await config.headers()).toEqual(searchIndexingHeaders());
    },
  );

  it("stops advertising the sitemap", () => {
    expect(robots().sitemap).toBeUndefined();
  });

  it.each([
    ["landing", "app/layout.tsx"],
    ["web", "../web/app/layout.tsx"],
  ])(
    "puts the robots meta on every %s page from the root layout",
    (_, path) => {
      // The layouts load CSS and local fonts, so read the source rather than
      // importing it. Next merges `robots` down to every route below the layout.
      const source = readFileSync(join(__dirname, "..", path), "utf8");
      expect(source).toMatch(/^\s*robots: SEARCH_ROBOTS_METADATA,$/m);
    },
  );
});
