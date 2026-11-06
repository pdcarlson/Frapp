import type { MetadataRoute } from "next";

/**
 * The app has nothing to index: every page past sign-in needs a session, and
 * the public pages live on the landing site. Crawlers that do request a page
 * here cost a server render and a proxy run each, billed as Vercel Fluid
 * Active CPU, so they are turned away from all of it.
 *
 * No dynamic API is read, so Next prerenders this at build time and serving it
 * runs no function.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
