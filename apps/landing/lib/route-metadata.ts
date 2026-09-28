import type { Metadata } from "next";

/*
 * The `<head>` of a route below the homepage.
 *
 * Next merges metadata by top-level key, so a route that sets only `title`
 * still inherits the root layout's whole `openGraph` and `twitter` objects:
 * a shared `/privacy` link would preview with the homepage's title and an
 * `og:url` of `/`. Setting `openGraph` replaces the layout's object outright,
 * so the share image and card type are restated here too, matching
 * `app/layout.tsx`.
 */
const SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Frapp. Ask your chapter anything.",
};

export function routeMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: path,
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SHARE_IMAGE.url],
    },
  };
}
