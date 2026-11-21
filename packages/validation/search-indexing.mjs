/*
 * The switch that hides Frapp from search engines while it is in testing
 * (#4758, asked by Shawn 2026-11-13). Flip it to `true` at public launch and
 * both sites follow: the landing and the web app read it in their root layout
 * (`robots` metadata), their `next.config.js` (`X-Robots-Tag` header), and the
 * landing's `robots.ts` (sitemap line). Nothing else needs to change.
 *
 * Off means every page says `noindex, nofollow` twice over: in its robots meta
 * tag, and in an `X-Robots-Tag` response header that also covers what has no
 * `<head>` (images, PDFs, the share card). Pages stay reachable by direct link:
 * the store listings link /privacy, /terms and /support.
 *
 * Plain JavaScript, not TypeScript under `src/`, because `next.config.js`
 * imports it and Node loads that file without a TypeScript step (the package's
 * "import" condition points at `src/*.ts`). Types: `search-indexing.d.mts`.
 */
export const SEARCH_INDEXING_ENABLED = false;

/**
 * The root layout's `robots` metadata. Next merges metadata by top-level key
 * and no route sets `robots`, so this reaches every page below the layout.
 */
export const SEARCH_ROBOTS_METADATA = SEARCH_INDEXING_ENABLED
  ? undefined
  : Object.freeze({ index: false, follow: false });

/** `next.config.js` `headers()` entries: an `X-Robots-Tag` on every path. */
export function searchIndexingHeaders() {
  return SEARCH_INDEXING_ENABLED
    ? []
    : [
        {
          source: "/:path*",
          headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
        },
      ];
}
