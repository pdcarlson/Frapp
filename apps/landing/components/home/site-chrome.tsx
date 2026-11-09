import { FOCUS_RING } from "./styles";
import { SiteFooter } from "./site-footer";
import { SiteHeader, type AnchorBase } from "./site-header";

/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

/*
 * The storefront's page chrome: the skip link, the sticky header, the `main`
 * landmark and the footer. The homepage and the storefront pages below it
 * (`/about`, `/changelog`, through `components/site-page.tsx`) all draw it from
 * here, so a change to any of the four lands on every page at once (#3817).
 *
 * `anchorBase` is `""` on the homepage and `"/"` everywhere else. The homepage
 * keeps bare `#pricing` anchors because next/link resolves those against the
 * current URL: a visitor on `/?utm_source=ig` scrolls and keeps the query. A
 * rooted `/#pricing` there would drop the query and navigate instead.
 */
export function SiteChrome({
  signupUrl,
  loginUrl,
  anchorBase,
  children,
}: {
  signupUrl: string;
  loginUrl: string;
  anchorBase: AnchorBase;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/*
        The skip link is the first thing in the tab order and targets the
        landmark itself rather than a heading inside it, so a screen reader
        lands on `main` with the nav already behind it.
      */}
      <a
        href="#top"
        className={`sr-only focus:not-sr-only focus:absolute focus:left-5 focus:top-5 focus:z-50 focus:inline-flex focus:h-11 focus:items-center focus:rounded-md focus:bg-primary focus:px-4 focus:text-label focus:font-bold focus:text-primary-foreground ${FOCUS_RING}`}
      >
        Skip to content
      </a>

      <SiteHeader
        signupUrl={signupUrl}
        loginUrl={loginUrl}
        anchorBase={anchorBase}
      />

      <main id="top" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>

      <SiteFooter loginUrl={loginUrl} anchorBase={anchorBase} />
    </div>
  );
}
