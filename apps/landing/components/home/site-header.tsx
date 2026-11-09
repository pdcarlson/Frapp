import Link from "next/link";
import { FrappLockup } from "../frapp-lockup";
import { TrackedCta } from "../tracked-cta";
import { BUTTON_PRIMARY_NAV, LINK_QUIET, SHELL } from "./styles";

/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

/*
 * Where the in-page anchors resolve: `""` on the homepage, `"/"` on a page
 * below it. Why the homepage keeps bare anchors is in `site-chrome.tsx`.
 */
export type AnchorBase = "" | "/";

export function SiteHeader({
  signupUrl,
  loginUrl,
  anchorBase,
}: {
  signupUrl: string;
  loginUrl: string;
  anchorBase: AnchorBase;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className={`${SHELL} flex h-16 items-center justify-between sm:h-18`}>
        <FrappLockup />

        {/*
          The phone board draws no menu: lockup, Sign in, Get started. With
          About and Changelog the nav is four links, so it closes up to 20
          between 768 and 1024, where 32 left Changelog touching Sign in.
        */}
        <nav aria-label="Primary" className="hidden items-center gap-5 md:flex lg:gap-8">
          <Link href={`${anchorBase}#product`} className={LINK_QUIET}>
            Product
          </Link>
          <Link href={`${anchorBase}#pricing`} className={LINK_QUIET}>
            Pricing
          </Link>
          <Link href="/about" className={LINK_QUIET}>
            About
          </Link>
          <Link href="/changelog" className={LINK_QUIET}>
            Changelog
          </Link>
        </nav>

        <div className="flex items-center gap-4 sm:gap-6">
          <TrackedCta
            cta="log-in"
            surface="header"
            href={loginUrl}
            className={`${LINK_QUIET} text-foreground hover:text-foreground`}
          >
            Sign in
          </TrackedCta>
          <TrackedCta
            cta="get-started"
            surface="header"
            href={signupUrl}
            className={BUTTON_PRIMARY_NAV}
          >
            Get started
          </TrackedCta>
        </div>
      </div>
    </header>
  );
}
