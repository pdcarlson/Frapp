import type { MetadataRoute } from "next";
import { SEARCH_INDEXING_ENABLED } from "@repo/validation/search-indexing";

/*
 * Crawling stays allowed even while Frapp is hidden from search (#4758,
 * `SEARCH_INDEXING_ENABLED`). The hiding is the `noindex` robots meta tag the
 * root layout puts on every page, and a crawler only reads that tag on a page
 * it may fetch: a disallow here would keep any page already in the index
 * listed, as a bare URL, until someone files a removal by hand.
 *
 * While hidden, the sitemap is not advertised. `sitemap.xml` itself still
 * builds, so the list is ready at launch and Search Console can still be
 * pointed at it to get the noindexed pages recrawled sooner.
 *
 * No dynamic API is read, so Next prerenders this at build time.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    ...(SEARCH_INDEXING_ENABLED
      ? { sitemap: "https://frapp.live/sitemap.xml" }
      : {}),
  };
}
