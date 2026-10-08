import { ChatProofSection } from "../components/home/chat-proof-section";
import { ClosingSection } from "../components/home/closing-section";
import { EventsProofSection } from "../components/home/events-proof-section";
import { HeroSection } from "../components/home/hero-section";
import { OfficersSection } from "../components/home/officers-section";
import { PricingSection } from "../components/home/pricing-section";
import { SiteFooter } from "../components/home/site-footer";
import { SiteHeader } from "../components/home/site-header";
import { FOCUS_RING } from "../components/home/styles";
import { buildAuthUrls } from "../lib/auth-urls";

/*
 * The storefront, rebuilt to the reskin boards (#2367).
 *
 * Read `spec/ui/landing/README.md` before editing: it carries decisions D1 to
 * D9, the marketing copy rules and the marketing type roles. The composition is
 * the Spec sheet's section map, §1 of
 * `spec/ui/landing/reference/canvas/Spec.dc.html`; the fold is `HeroB.dc.html`
 * (D9); everything below the fold is `Main.dc.html` at 1440 and `Phone.dc.html`
 * at 390.
 *
 * This file composes that map; each section, and the two product frames, live
 * in `components/home/`, one file apiece, with the class strings they share in
 * `components/home/styles.ts`.
 *
 * Four rules the page and its sections are easy to break by accident:
 *
 *  1. **Only what ships may be claimed.** Pre-event RSVP is not modelled
 *     (`spec/behavior/events.md`), the dues chat card is a stub renderer and
 *     the Ask affordance cannot answer anything (`spec/behavior/ai.md`). So:
 *     Check in and never RSVP, no Going / Can't-make-it control, no Ask pill,
 *     and the sentence about the conversation names events, check-in and points
 *     and stops there. Behaviour spec beats the reference boards on what the
 *     product does.
 *  2. **No figure that is not a commitment.** $0, $149, 14 days and day 15 are
 *     the only marketing numbers on this page. The member and chapter counts
 *     that used to run here had no source behind them. Numbers inside the two
 *     frames are demo data and each frame says so in its own caption.
 *  3. **No em dashes in rendered copy**, and sentence case on every control and
 *     link (D5). Both are landing copy rules. `page.spec.ts` guards the em
 *     dashes; it does NOT guard case, and never has — sentence case here is a
 *     review rule, so read the labels rather than trusting the suite. The CTA
 *     half is house-wide since slice 3 amended `writing.md` §2.
 *  4. **Nothing above the fold animates.** The H1 is the LCP element and it,
 *     the lead and the primary CTA never move. There is no image request above
 *     the fold either: the crest is an inline path and the frames are JSX.
 *
 * Every gold reads through the accent-slot roles (`--primary`,
 * `--primary-hover`, `--accent-border`, `--accent-text`), so D1 stays a
 * one-token flip. The crest is the exception and carries a literal instead:
 * the mark is locked and never takes the slot. Its geometry and fill live in
 * `components/signet-crest.tsx`, which is the one home for both.
 */

export default function Home() {
  const { signupUrl, loginUrl } = buildAuthUrls(
    process.env.NEXT_PUBLIC_APP_URL,
    { vercelEnv: process.env.VERCEL_ENV },
  );

  /*
   * The invite CTA points at this origin's own `/join`, which is what the
   * routes contract (Spec sheet §5) specifies and not an oversight. That route
   * calls `buildJoinUrl` itself and forwards to the app with the invite query
   * intact. Calling the builder here instead would move its throw on a
   * misconfigured `NEXT_PUBLIC_APP_URL` from one redirect route onto the
   * homepage, which is the 500 that `lib/auth-urls.ts` explains it avoids.
   */
  const joinUrl = "/join";

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Frapp",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    url: "https://frapp.live",
    description:
      "Frapp is chat first. Free covers unlimited chat, members and chapters with no card; Chapter Pro adds events with check-in, the points ledger and dues invoicing for one flat price per chapter.",
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        priceCurrency: "USD",
        price: "0",
        description:
          "Unlimited chat, members and chapters. No credit card required.",
      },
      {
        "@type": "Offer",
        name: "Chapter Pro",
        priceCurrency: "USD",
        price: "149",
        description:
          "Flat monthly chapter plan. Events with check-in, points ledger, dues invoicing, backwork library, reports and exports.",
      },
    ],
    brand: { "@type": "Brand", name: "Frapp" },
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

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

      <SiteHeader signupUrl={signupUrl} loginUrl={loginUrl} />

      <main id="top" tabIndex={-1} className="focus:outline-none">
        <HeroSection signupUrl={signupUrl} joinUrl={joinUrl} />
        <OfficersSection />
        <ChatProofSection />
        <EventsProofSection />
        <PricingSection signupUrl={signupUrl} />
        <ClosingSection signupUrl={signupUrl} loginUrl={loginUrl} />
      </main>

      <SiteFooter loginUrl={loginUrl} />
    </div>
  );
}
