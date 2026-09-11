/**
 * Routes that own their own frame instead of sitting inside the shell's inset.
 *
 * `<main>` gives every route `px-4 py-4 sm:px-6` and its own `overflow-y-auto`.
 * That is right for a page of stacked cards and wrong for chat, which the
 * framework board draws as "three flush columns, 100vh, independent scroll"
 * (`1b`): the channels column has to sit flush against the nav's right border
 * with no gutter between them, and the composer has to be pinned to the bottom
 * of the viewport rather than to the bottom of a document that scrolls.
 *
 * A full-bleed route therefore gets a `<main>` with no padding and no scroll of
 * its own, and takes responsibility for both. It is still the same `<main>`
 * landmark, still `#main-content`, still the skip-link target.
 *
 * This is a list rather than a prop because the shell is a client component
 * that already knows the pathname at first paint. A prop would have to be
 * threaded from a server layout, and a context would only be readable after an
 * effect — which is a frame of padded chat before it snaps flush.
 */
const FULL_BLEED_ROUTES = ["/chat"];

export function isFullBleedRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return FULL_BLEED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
