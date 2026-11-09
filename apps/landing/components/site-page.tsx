import { landingAuthUrls } from "../lib/auth-urls";
import { SiteChrome } from "./home/site-chrome";
import { SHELL } from "./home/styles";

/*
 * A storefront page below the homepage: `/about` and `/changelog` (#3817).
 * It draws inside the homepage's own chrome, so a visitor who lands here can
 * still reach Product, Pricing and Get started. The legal routes keep their
 * own narrower shell (`app/components/legal-document.tsx`).
 *
 * The four rules at the top of `app/page.tsx` bind what this draws too.
 *
 * A document, so the locked six type roles (foundations.md §7), not the
 * storefront's marketing three: `--text-hero` and `--text-lead` are scoped to
 * the homepage's hero and closing.
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
  const { signupUrl, loginUrl } = landingAuthUrls();

  return (
    <SiteChrome signupUrl={signupUrl} loginUrl={loginUrl} anchorBase="/">
      <div className={`${SHELL} pb-24 pt-14 sm:pt-20`}>
        <div className="max-w-3xl">
          <h1 className="text-display text-balance">{title}</h1>
          <p className="mt-4 text-body text-muted-foreground">{lead}</p>
          <div className="mt-12">{children}</div>
        </div>
      </div>
    </SiteChrome>
  );
}
