import { buildAuthUrls } from "../lib/auth-urls";
import { SiteFooter } from "./home/site-footer";
import { SiteHeader } from "./home/site-header";
import { FOCUS_RING, SHELL } from "./home/styles";

/*
 * The storefront's header and footer around a page that is not the homepage:
 * `/about` and `/changelog` (#3817). They are part of the storefront, so a
 * visitor who lands on one can still reach Product, Pricing and Get started.
 * The legal routes keep their own narrower shell (`app/components/legal-document.tsx`).
 *
 * The four rules at the top of `app/page.tsx` bind what this draws too: no em
 * dashes, sentence case on every link, only what ships, no figure that is not
 * a commitment. The skip link and `main` landmark repeat the homepage's.
 */
export function SitePage({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  const { signupUrl, loginUrl } = buildAuthUrls(
    process.env.NEXT_PUBLIC_APP_URL,
    { vercelEnv: process.env.VERCEL_ENV },
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#top"
        className={`sr-only focus:not-sr-only focus:absolute focus:left-5 focus:top-5 focus:z-50 focus:inline-flex focus:h-11 focus:items-center focus:rounded-md focus:bg-primary focus:px-4 focus:text-label focus:font-bold focus:text-primary-foreground ${FOCUS_RING}`}
      >
        Skip to content
      </a>

      <SiteHeader signupUrl={signupUrl} loginUrl={loginUrl} />

      <main id="top" tabIndex={-1} className="focus:outline-none">
        {/*
          A document, so the locked six type roles (foundations.md §7), not
          the storefront's marketing three: `--text-hero` and `--text-lead`
          are scoped to the homepage's hero and closing.
        */}
        <div className={`${SHELL} pb-24 pt-14 sm:pt-20`}>
          <div className="max-w-3xl">
            <h1 className="text-display text-balance">{title}</h1>
            <p className="mt-4 text-body text-muted-foreground">{lead}</p>
            <div className="mt-12">{children}</div>
          </div>
        </div>
      </main>

      <SiteFooter loginUrl={loginUrl} />
    </div>
  );
}
