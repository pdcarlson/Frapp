import Link from "next/link";
import { FrappLockup } from "../frapp-lockup";
import { TrackedCta } from "../tracked-cta";
import { BUTTON_PRIMARY_NAV, LINK_QUIET, SHELL } from "./styles";

/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

export function SiteHeader({
  signupUrl,
  loginUrl,
}: {
  signupUrl: string;
  loginUrl: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className={`${SHELL} flex h-16 items-center justify-between sm:h-18`}>
        <FrappLockup />

        {/* The phone board draws no menu: lockup, Sign in, Get started. */}
        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          <Link href="#product" className={LINK_QUIET}>
            Product
          </Link>
          <Link href="#pricing" className={LINK_QUIET}>
            Pricing
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
