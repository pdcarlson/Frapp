import Link from "next/link";
import { SignetCrest } from "../signet-crest";
import { TrackedCta } from "../tracked-cta";
import { LINK_QUIET, SHELL } from "./styles";

/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

/*
 * Eight links in the board's order, with the one tracked control sitting third
 * where the board puts it. Split around it rather than hoisted to the front: on
 * a surface whose footer is a single row, the order IS the design.
 */
const footerLinksBeforeSignIn = [
  { label: "Product", href: "#product" },
  { label: "Pricing", href: "#pricing" },
];

const footerLinksAfterSignIn = [
  { label: "Support", href: "/support" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "FERPA", href: "/ferpa" },
  { label: "team@frapp.live", href: "mailto:team@frapp.live" },
];

/*
 * 7 · Footer.
 *
 * One row, eight links. The "Documentation" link is gone (D7): it pointed
 * at the GitHub `docs/guides` tree, which is contributor documentation.
 */
export function SiteFooter({ loginUrl }: { loginUrl: string }) {
  return (
    <footer className="border-t border-border">
      <div
        className={`${SHELL} flex flex-col gap-6 py-7 sm:flex-row sm:items-center sm:justify-between`}
      >
        <p className="flex items-center gap-3 text-label text-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xs bg-surface-1"
          >
            <SignetCrest className="h-5 w-5" />
          </span>
          <span>© {new Date().getFullYear()} Frapp</span>
        </p>

        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6">
          {footerLinksBeforeSignIn.map((link) => (
            <Link key={link.label} href={link.href} className={LINK_QUIET}>
              {link.label}
            </Link>
          ))}
          <TrackedCta
            cta="log-in"
            surface="footer"
            href={loginUrl}
            className={LINK_QUIET}
          >
            Sign in
          </TrackedCta>
          {footerLinksAfterSignIn.map((link) => (
            <Link key={link.label} href={link.href} className={LINK_QUIET}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
