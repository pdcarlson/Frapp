import Link from "next/link";
import { FrappLockup } from "../components/frapp-lockup";
import { RevealOnView } from "../components/reveal-on-view";
import { SignetCrest } from "../components/signet-crest";
import { TrackedCta } from "../components/tracked-cta";
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
 * Four rules this file is easy to break by accident:
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

/*
 * The board's stage, not its content band. Main.dc.html is 1440 wide with
 * `padding:0 80px`, so the twelve-column track the canvas guides draw is 1280.
 * Capping at 1280 here would have made the track 1120 and squeezed every span
 * below. Above 1440 the track stays 1280 and the margins grow, which is the one
 * behaviour the board does not draw and a cap has to invent.
 */
const SHELL = "mx-auto w-full max-w-[1440px] px-5 sm:px-20";

/* Sections start 64 apart on the phone board and 96 on the desktop one. */
const SECTION_GAP = "pt-16 sm:pt-24";

const EYEBROW =
  "text-label uppercase tracking-[0.12em] text-accent-text";

const SECTION_H2 = "text-display-lg text-balance text-foreground";

/*
 * Controls take radius 12 and a 48 box (44 in the nav), per foundations §8 and
 * the System sheet. Focus is §10's: a 3px ring of the accent at 25% with the
 * border going solid accent. `chrome-motion` carries only the timing.
 */
const FOCUS_RING =
  "focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-primary/25 focus-visible:border-primary";

const BUTTON_PRIMARY = `chrome-motion inline-flex h-12 items-center justify-center rounded-md border border-transparent bg-primary px-6 text-body font-bold text-primary-foreground hover:bg-primary-hover ${FOCUS_RING}`;

/* The nav's own primary sits on the 44 touch floor rather than the 48 box. */
const BUTTON_PRIMARY_NAV = `chrome-motion inline-flex h-11 items-center justify-center rounded-md border border-transparent bg-primary px-[18px] text-label font-bold text-primary-foreground hover:bg-primary-hover ${FOCUS_RING}`;

/* Quiet links lift to the foreground; the accent link holds its colour and
 * underlines instead, so the one gold on the page never becomes two. */
const LINK_QUIET = `chrome-motion inline-flex h-11 items-center rounded-xs border border-transparent text-label font-semibold text-muted-foreground hover:text-foreground ${FOCUS_RING}`;

const LINK_ACCENT = `chrome-motion inline-flex h-11 items-center rounded-xs border border-transparent text-body font-semibold text-accent-text hover:underline hover:underline-offset-[3px] ${FOCUS_RING}`;

const PROOF_ROW = "border-b border-border py-4";
const PROOF_TITLE = "text-body font-semibold text-foreground";
const PROOF_BODY = "text-body text-muted-foreground";

const FRAME_CAPTION = "text-caption text-muted-foreground";

const officers = [
  {
    role: "President",
    outcome:
      "Chapter meeting check-in is a QR on the screen. Attendance and points post themselves.",
  },
  {
    role: "Treasurer",
    outcome:
      "Dues invoices go out through Stripe. Paid, open and overdue are one list, not a DM thread.",
  },
  {
    role: "Secretary",
    outcome:
      "Minutes, bylaws and the audit log live where members already look. Nobody asks for the link twice.",
  },
];

const chatProof = [
  {
    title: "Events post as cards.",
    body: "Check in without leaving the thread. Officers watch the count update live.",
  },
  {
    title: "Red means you.",
    body: "Mentions and DMs are red. Channel unread stays neutral.",
  },
  {
    title: "Officer changes are public.",
    body: "Dues, roles and module changes post to #chapter-audit. Every member can read it.",
  },
];

const eventsProof = [
  {
    title: "One check-in, everywhere.",
    body: "Checked in on the card is checked in on the app. Same state, no drift.",
  },
  {
    title: "Points post themselves.",
    body: "Attendance inside the window awards the event's points. Nobody types a number.",
  },
  {
    title: "Past events keep their record.",
    body: "Attendance status stays on every past event, per member.",
  },
];

const freePlan = [
  "Unlimited chat, members and chapters",
  "Announcements and direct messages",
  "Member directory and invites",
  "Chapter settings and the member-visible audit log",
  "No card",
];

/*
 * The AI features are left off deliberately although `positioning.md` gates
 * them behind this tier: nothing ships that can answer a question yet
 * (`spec/behavior/ai.md`), so listing them would sell an unbuilt module.
 */
const proPlan = [
  "Everything in Free",
  "Events with QR check-in and attendance",
  "Points ledger and leaderboard",
  "Dues invoicing, collected through Stripe",
  "Backwork library, reports and exports",
];

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
    name: "Signet",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    url: "https://frapp.live",
    description:
      "Signet is chat first. Free covers unlimited chat, members and chapters with no card; Chapter Pro adds events with check-in, the points ledger and dues invoicing for one flat price per chapter.",
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
    brand: { "@type": "Brand", name: "Signet" },
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

      <main id="top" tabIndex={-1} className="focus:outline-none">
        {/* ── 1 · Hero (D9, HeroB.dc.html) ───────────────────────────────── */}
        <section
          aria-labelledby="hero"
          className={`${SHELL} grid gap-10 overflow-hidden pt-10 sm:pt-18 lg:grid-cols-12 lg:gap-x-6`}
        >
          <div className="flex flex-col gap-6 lg:col-span-6 lg:pb-10">
            <p className={EYEBROW}>Chapter operations, chat first</p>
            <h1 id="hero" className="text-hero text-balance text-foreground">
              Run your chapter where it already talks.
            </h1>
            <p className="max-w-[616px] text-lead text-muted-foreground">
              Signet is chat first. Events, check-in and points land in the
              conversation your members already read. Officers stop chasing.
              Members stop asking where things are.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <TrackedCta
                cta="get-started"
                surface="hero"
                href={signupUrl}
                className={BUTTON_PRIMARY}
              >
                Get started
              </TrackedCta>
              <TrackedCta
                cta="join-chapter"
                surface="hero"
                href={joinUrl}
                className={LINK_ACCENT}
              >
                Have an invite? Join your chapter
              </TrackedCta>
            </div>
            <p className="max-w-[616px] text-body text-muted-foreground">
              Free for chat, members and announcements. No card. Officers add
              Chapter Pro when the chapter needs events, dues and points.
            </p>
          </div>

          {/*
            The frame bleeds off the right edge at `lg` and only at `lg`, which
            is where the board draws it: at 720 wide it overruns its column, and
            `overflow-hidden` on the section clips it at the shell rather than
            letting it open a horizontal scrollbar. The header is a sibling of
            this section, not a descendant, so that clip cannot break its
            stickiness.

            Below `lg` it is a whole, fully bordered frame at the column width.
            Bleeding it there would crop a 720 frame to phone width and cut the
            thread mid-word, which reads as a rendering bug rather than as a
            composition; the phone board carries no bleeding frame either.
          */}
          <div className="lg:col-span-6 lg:-mr-20">
            <div className="flex flex-col gap-3">
              <ChatFrame
                variant="fold"
                label="The Signet web app, the general channel: an event card in the conversation with a Check in button and a live count, an officer's reply, and a mention."
              />
              <p className={`${FRAME_CAPTION} lg:pr-20`}>
                Demo chapter, seen as an officer. Names and messages are
                illustrative.
              </p>
            </div>
          </div>
        </section>

        {/* ── 2 · Officers, at the fold ──────────────────────────────────── */}
        {/*
          Drawn at rest on purpose, and it is the one block the Motion sheet
          names for a reveal that does not get one. D9 replaced the crest column
          with the chat frame, which moved this strip up into the 1440x900 fold:
          it is first paint now, where README §7 prefers a static layout, and a
          reveal armed after hydration on an already-painted block is a flash
          rather than an entrance. The reveals below the fold are unaffected.
        */}
        <section aria-labelledby="officers" className={`${SHELL} ${SECTION_GAP}`}>
          <div className="grid gap-6 border-t border-border pt-6 lg:grid-cols-12 lg:gap-x-6">
            <h2 id="officers" className={`${EYEBROW} lg:col-span-3`}>
              Built for officers
            </h2>
            {officers.map((officer) => (
              <div key={officer.role} className="flex flex-col gap-2 lg:col-span-3">
                <h3 className="text-title text-foreground">{officer.role}</h3>
                <p className={PROOF_BODY}>{officer.outcome}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 3 · Proof, chat ────────────────────────────────────────────── */}
        <section id="product" className={`${SHELL} ${SECTION_GAP}`}>
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-x-6">
            <RevealOnView className="flex flex-col gap-6 lg:col-span-4">
              <p className={`${EYEBROW} reveal-item`}>Chat is the spine</p>
              <h2 className={`${SECTION_H2} reveal-item`} style={{ "--i": 1 } as StaggerStyle}>
                Ops happen in the thread.
              </h2>
              <p className={`${PROOF_BODY} reveal-item`} style={{ "--i": 2 } as StaggerStyle}>
                Members open chat. So that is where the event lands, where the
                check-in happens, and where the treasurer says the invoice batch
                went out. Nothing sits behind a tab nobody opens.
              </p>
              <div className="reveal-rule mt-2 border-t border-border" />
              <div className="flex flex-col border-t-0">
                {chatProof.map((row, index) => (
                  <div
                    key={row.title}
                    className={`${PROOF_ROW} reveal-item`}
                    style={{ "--i": index + 3 } as StaggerStyle}
                  >
                    <p className={PROOF_TITLE}>{row.title}</p>
                    <p className={PROOF_BODY}>{row.body}</p>
                  </div>
                ))}
              </div>
              <p className={FRAME_CAPTION}>
                Demo chapter, seen as an officer. Names and messages are
                illustrative.
              </p>
            </RevealOnView>

            <div className="lg:col-span-8">
              <ChatFrame
                variant="full"
                label="The Signet web app: a channel list beside the general channel, where an event card sits in the conversation with a Check in button and a live count."
              />
            </div>
          </div>
        </section>

        {/* ── 4 · Proof, events ──────────────────────────────────────────── */}
        <section aria-labelledby="events" className={`${SHELL} ${SECTION_GAP}`}>
          {/*
            The copy leads in the DOM and the frame follows, which is the phone
            board's order and the sensible one for a screen reader: the heading
            that names the section before the picture of it. Desktop keeps the
            frame on the left, as `Main.dc.html` draws it, through explicit grid
            placement rather than a flex `order`, so the two live in the same
            row without the source order changing.
          */}
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-x-6">
            <RevealOnView className="flex flex-col gap-6 lg:col-span-5 lg:col-start-6 lg:row-start-1">
              <p className={`${EYEBROW} reveal-item`}>Events and check-in</p>
              <h2
                id="events"
                className={`${SECTION_H2} reveal-item`}
                style={{ "--i": 1 } as StaggerStyle}
              >
                Check-in that keeps its own books.
              </h2>
              <p className={`${PROOF_BODY} reveal-item`} style={{ "--i": 2 } as StaggerStyle}>
                An officer opens check-in for a window. Members scan the QR in
                the room, attendance is recorded, and the points post. Nobody
                keeps a spreadsheet.
              </p>
              <div className="reveal-rule mt-2 border-t border-border" />
              <div className="flex flex-col">
                {eventsProof.map((row, index) => (
                  <div
                    key={row.title}
                    className={`${PROOF_ROW} reveal-item`}
                    style={{ "--i": index + 3 } as StaggerStyle}
                  >
                    <p className={PROOF_TITLE}>{row.title}</p>
                    <p className={PROOF_BODY}>{row.body}</p>
                  </div>
                ))}
              </div>
              <p className={FRAME_CAPTION}>
                Demo chapter. Names and events are illustrative.
              </p>
            </RevealOnView>

            {/*
              The wrapper is here for the check-in dot's ring and nothing else.
              The frame itself carries no `reveal-item`, so it is drawn at rest
              exactly as before: `reveal-armed` hides only `reveal-item`
              children, and the ring is a pseudo-element with no rest state. A
              reader who never sees the ring is missing nothing.
            */}
            <RevealOnView className="flex justify-center lg:col-span-5 lg:col-start-1 lg:row-start-1 lg:justify-start">
              <EventFrame />
            </RevealOnView>
          </div>
        </section>

        {/* ── 5 · Pricing (D3) ───────────────────────────────────────────── */}
        <section id="pricing" className={`${SHELL} ${SECTION_GAP}`}>
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-x-6">
            <div className="flex flex-col gap-6 lg:col-span-4">
              <p className={EYEBROW}>Pricing</p>
              <h2 className={SECTION_H2}>Free for chat. Pro for the ops.</h2>
              <p className={PROOF_BODY}>
                Every chapter starts on Free. Chapter Pro is one flat price per
                chapter, whatever your size, and it turns on the officer tools.
              </p>
              {/*
                The mechanics, stated exactly as `positioning.md` records them.
                The page this replaced said every new chapter starts with a
                14-day trial, which is not how the gating model works: a chapter
                starts on Free and the trial opens at checkout.
              */}
              <p className={`${PROOF_BODY} border-t border-border pt-4`}>
                The trial starts at checkout inside the app: 14 days, card up
                front, first charge on day 15, once per chapter.
              </p>
            </div>

            <RevealOnView className="grid gap-6 sm:grid-cols-2 lg:col-span-8 lg:col-start-5">
              <div
                className="reveal-item chrome-motion flex flex-col gap-6 rounded-xl border border-border bg-card p-8 hover:border-primary hover:bg-popover focus-within:border-primary focus-within:bg-popover"
                style={{ "--i": 0 } as StaggerStyle}
              >
                <h3 className="text-title text-foreground">Free</h3>
                <p className="flex items-baseline gap-2">
                  <span className="text-display-lg tabular-nums text-foreground">
                    $0
                  </span>
                  <span className="text-body text-muted-foreground">
                    per chapter
                  </span>
                </p>
                <ul className="flex flex-col border-t border-border">
                  {freePlan.map((item) => (
                    <li key={item} className="border-b border-border py-3 text-body">
                      {item}
                    </li>
                  ))}
                </ul>
                {/*
                  The only control in this section. Both tiers resolve to
                  `/sign-up` because no checkout deep link exists, so a second
                  button would be the same link twice wearing two labels.
                */}
                <TrackedCta
                  cta="get-started"
                  surface="pricing"
                  href={signupUrl}
                  className={`${BUTTON_PRIMARY} mt-auto w-full`}
                >
                  Get started
                </TrackedCta>
              </div>

              <div
                className="reveal-item chrome-motion relative flex flex-col gap-6 overflow-hidden rounded-xl border border-accent-border bg-card p-8 hover:border-primary hover:bg-popover focus-within:border-primary focus-within:bg-popover"
                style={{ "--i": 1 } as StaggerStyle}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-0.5 bg-primary"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-title text-foreground">Chapter Pro</h3>
                  <span className="inline-flex h-6 items-center rounded-xs border border-accent-border bg-accent-subtle px-[9px] text-caption font-semibold text-accent-text">
                    14-day trial
                  </span>
                </div>
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-display-lg tabular-nums text-foreground">
                    $149
                  </span>
                  <span className="text-body text-muted-foreground">
                    per chapter, per month. Flat.
                  </span>
                </p>
                <ul className="flex flex-col border-t border-border">
                  {proPlan.map((item) => (
                    <li key={item} className="border-b border-border py-3 text-body">
                      {item}
                    </li>
                  ))}
                </ul>
                <p className={`${PROOF_BODY} mt-auto`}>
                  Upgrade any time from Settings inside the app.
                </p>
              </div>
            </RevealOnView>
          </div>
        </section>

        {/* ── 6 · Closing ────────────────────────────────────────────────── */}
        <section
          aria-labelledby="closing"
          className={`${SHELL} flex flex-col items-center gap-6 pb-24 pt-20 text-center sm:pt-30`}
        >
          <RevealOnView className="flex w-full flex-col items-center gap-6">
            {/*
              Decorative: the heading beside it carries the meaning and the
              header lockup has already named the brand, so a second
              announcement would only repeat it. The crest paints whole from the
              first frame. The Motion sheet's signature moment, which would have
              wiped it in here, is cut until D4's brand sign-off clears (#2378).
            */}
            <span className="reveal-item" style={{ "--i": 0 } as StaggerStyle}>
              <SignetCrest className="h-14 w-14 sm:h-18 sm:w-18" />
            </span>
            {/*
              D8 holds the locked tagline off the page body until Ask can
              answer. `layout.tsx` keeps it in the meta and OG titles, where it
              is the brand tagline rather than a product claim.
            */}
            <h2
              id="closing"
              className={`${SECTION_H2} reveal-item max-w-[860px]`}
              style={{ "--i": 1 } as StaggerStyle}
            >
              Everything your chapter needs is already in chat.
            </h2>
            <p
              className="reveal-item max-w-[560px] text-lead text-muted-foreground"
              style={{ "--i": 2 } as StaggerStyle}
            >
              Sign up, name the chapter, invite the members. The officer tools
              are there when the chapter needs them.
            </p>
            <div
              className="reveal-item flex flex-wrap items-center gap-x-6 gap-y-3"
              style={{ "--i": 3 } as StaggerStyle}
            >
              <TrackedCta
                cta="get-started"
                surface="cta-band"
                href={signupUrl}
                className={BUTTON_PRIMARY}
              >
                Get started
              </TrackedCta>
              <TrackedCta
                cta="log-in"
                surface="cta-band"
                href={loginUrl}
                className={LINK_ACCENT}
              >
                Sign in
              </TrackedCta>
            </div>
          </RevealOnView>
        </section>
      </main>

      {/* ── 7 · Footer ───────────────────────────────────────────────────── */}
      {/*
        One row, eight links. The "Documentation" link is gone (D7): it pointed
        at the GitHub `docs/guides` tree, which is contributor documentation.
      */}
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
            <span>© {new Date().getFullYear()} Signet</span>
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
    </div>
  );
}

/*
 * `--i` is the stagger index a reveal's children carry. React's CSSProperties
 * does not model custom properties, and the alternative to this alias is a
 * cast at every call site.
 */
type StaggerStyle = React.CSSProperties & Record<"--i", number>;

/*
 * ── The two product frames ───────────────────────────────────────────────────
 *
 * Static JSX, never a screenshot and never a `next/image` call: the hero's LCP
 * element is the H1 and nothing on this page may become an image request
 * (`spec/ui/landing/README.md` § Performance). Each frame is one `role="img"`
 * with an `aria-label` that says what it shows, so a screen reader gets the
 * picture in a sentence instead of walking a tree of decorative divs, and each
 * carries a caption naming its contents as demo data.
 *
 * Type, spacing and radii INSIDE a frame are transcribed from the product
 * boards (`web-framework.dc.html` option 1b and `canvas-screens.dc.html` s06 /
 * s07) and are deliberately off the marketing scale and off the radius map.
 * Landing chrome is on the grid; frame internals are not. Do not "correct" them.
 *
 * What they may show is bounded by `spec/behavior/`, not by the boards: the
 * event card carries Check in and nothing else, there is no RSVP control and no
 * attendance count a member could not see, no dues artifact appears in the
 * thread because that renderer is a stub, and there is no Ask pill because the
 * shipped one opens an "isn't ready" notice.
 */

const threadRows = [
  { key: "open", kind: "them" as const },
  { key: "event", kind: "event" as const },
  { key: "reply", kind: "self" as const },
  { key: "mention", kind: "mention" as const },
];

const BUBBLE_THEM =
  "rounded-[18px] rounded-bl-[6px] border border-border bg-card px-3.5 py-2.5 text-[16px] leading-6 text-foreground";
const AVATAR =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-popover text-[12px] font-semibold text-foreground";
const META = "text-[12.5px] text-muted-foreground";

function ChatThread({ animate }: { animate: boolean }) {
  const rows = threadRows.map((row, index) => (
    <div
      key={row.key}
      className="reveal-item"
      style={{ "--i": index } as StaggerStyle}
    >
      {row.kind === "them" && (
        <div className="flex gap-2.5 px-5 pb-0.5 pt-3">
          <span className={AVATAR}>JE</span>
          <div className="flex max-w-[76%] flex-col gap-1">
            <p className={META}>
              <span className="font-semibold text-foreground">Jordan Ellis</span>{" "}
              · 4:02 PM
            </p>
            <p className={BUBBLE_THEM}>
              Chapter is 6:30 tonight. Dues forms in by then if yours is not.
            </p>
          </div>
        </div>
      )}

      {row.kind === "event" && (
        <div className="flex gap-2.5 px-5 pb-0.5 pt-2">
          <span className="w-8 shrink-0" />
          <div className="min-w-0 max-w-[76%] rounded-lg border border-border bg-card px-4 py-3.5">
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Event
            </p>
            <p className="mt-1 text-[16px] font-bold text-foreground">
              Chapter meeting
            </p>
            <p className="text-[14px] text-muted-foreground">
              Tonight · 6:30 PM · Chapter room · 10 pts
            </p>
            {/*
              Check in, and only Check in. `spec/behavior/events.md` records
              pre-event RSVP intent as not modelled, so there is no Going or
              Can't-make-it control to draw. The live count is drawn because
              the viewer is an officer, which the caption states: it shows only
              to `events:update` holders.
            */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="inline-flex h-[34px] items-center rounded-sm bg-primary px-3.5 text-[14px] font-bold text-primary-foreground">
                Check in
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                closes 6:45
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                31 checked in
              </span>
            </div>
          </div>
        </div>
      )}

      {row.kind === "self" && (
        <div className="flex flex-col items-start gap-1 px-5 pb-0.5 pt-3">
          <p className="max-w-[76%] rounded-[18px] rounded-br-[6px] bg-primary px-3.5 py-2.5 text-[16px] leading-6 text-primary-foreground">
            On it. Roster is pulled, 42 for food.
          </p>
          <p className={META}>4:05 PM · read</p>
        </div>
      )}

      {row.kind === "mention" && (
        <div className="flex gap-2.5 px-5 pb-0.5 pt-3">
          <span className={AVATAR}>MC</span>
          <div className="flex max-w-[76%] flex-col gap-1">
            <p className={META}>
              <span className="font-semibold text-foreground">Maya Chen</span> ·
              4:06 PM
            </p>
            <p className={BUBBLE_THEM}>
              {/*
                The in-bubble mention chip, not the mention red. Red as text
                inside a bubble is the case `foundations.md` §5 carves out, and
                this pair is what it carves out to.
              */}
              <span className="rounded-[5px] bg-mention-chip px-1 font-semibold text-mention-chip-text">
                @Jordan
              </span>{" "}
              can you pin the parking map before people leave?
            </p>
          </div>
        </div>
      )}
    </div>
  ));

  if (!animate) {
    return <div className="flex min-h-0 flex-col pb-2">{rows}</div>;
  }

  return (
    <RevealOnView className="reveal-thread flex min-h-0 flex-col pb-2">
      {rows}
    </RevealOnView>
  );
}

function Composer() {
  return (
    <div className="px-4 pb-3 pt-2">
      <div className="flex flex-col gap-1 rounded-md border border-input bg-surface-1 p-2 pb-1.5">
        <p className="px-1.5 py-0.5 text-[16px] leading-6 text-muted-foreground">
          Message #general
        </p>
        <div className="flex items-center justify-between">
          <span className="pl-1.5 text-[12.5px] text-muted-foreground">
            Enter to send
          </span>
          <span className="inline-flex h-8 items-center rounded-sm border border-border bg-card px-3.5 text-[14px] font-bold text-disabled">
            Send
          </span>
        </div>
      </div>
    </div>
  );
}

function ChannelRow({
  name,
  state,
  badge,
}: {
  name: string;
  state: "active" | "unread" | "rest";
  badge?: { count: string; tone: "neutral" | "mention" };
}) {
  const tone =
    state === "active"
      ? "bg-accent-subtle text-accent-text font-semibold"
      : state === "unread"
        ? "text-foreground font-semibold"
        : "text-muted-foreground";
  return (
    <div className={`flex h-8 items-center gap-2 rounded-sm px-2 ${tone}`}>
      <span className="w-4 font-bold">#</span>
      <span className="min-w-0 flex-1 truncate text-[14px]">{name}</span>
      {badge ? (
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] px-1.5 text-[11.5px] font-bold ${
            badge.tone === "mention"
              ? "bg-mention text-mention-foreground"
              : "bg-input text-foreground"
          }`}
        >
          {badge.count}
        </span>
      ) : null}
    </div>
  );
}

function DirectMessageRow({
  initials,
  name,
  unread,
}: {
  initials: string;
  name: string;
  unread?: boolean;
}) {
  return (
    <div
      className={`flex h-8 items-center gap-2 rounded-sm px-2 ${
        unread ? "font-semibold text-foreground" : "text-muted-foreground"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-popover text-[7.5px] text-foreground">
        {initials}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px]">{name}</span>
      {unread ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-mention px-1.5 text-[11.5px] font-bold text-mention-foreground">
          1
        </span>
      ) : null}
    </div>
  );
}

function ChatFrame({
  variant,
  label,
}: {
  variant: "fold" | "full";
  label: string;
}) {
  const isFold = variant === "fold";

  return (
    <div
      role="img"
      aria-label={label}
      className={
        isFold
          ? "flex h-[536px] w-full flex-col overflow-hidden rounded-xl border border-input bg-background lg:w-[720px] lg:max-w-none lg:rounded-r-none lg:border-r-0"
          : "flex h-[600px] w-full overflow-hidden rounded-xl border border-border bg-background"
      }
    >
      {!isFold && (
        <div className="hidden w-[220px] shrink-0 flex-col gap-0.5 border-r border-border bg-surface-1 p-2 sm:flex">
          <div className="flex h-10 items-center gap-2.5 px-1.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-xs border border-accent-border bg-accent-subtle text-[11px] font-bold text-accent-text">
              ΔΡ
            </span>
            <span className="text-[14px] font-bold text-foreground">
              Delta Rho
            </span>
          </div>
          <div className="mt-1.5 flex h-8 items-center justify-between px-2">
            <span className="text-[13px] font-bold text-foreground">
              Channels
            </span>
            <span className="text-[16px] font-bold text-muted-foreground">
              +
            </span>
          </div>
          <ChannelRow
            name="announcements"
            state="unread"
            badge={{ count: "2", tone: "neutral" }}
          />
          <ChannelRow name="general" state="active" />
          <ChannelRow name="treasury" state="rest" />
          <ChannelRow name="house" state="rest" />
          <p className="px-2 pb-1 pt-3.5 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Direct messages
          </p>
          <DirectMessageRow initials="MC" name="Maya Chen" unread />
          <DirectMessageRow initials="JE" name="Jordan Ellis" />
          <p className="px-2 pb-1 pt-3.5 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            System
          </p>
          <div className="flex h-8 items-center gap-2 rounded-sm px-2 text-muted-foreground">
            <ShieldGlyph />
            <span className="min-w-0 flex-1 truncate text-[14px]">
              chapter-audit
            </span>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-surface-1 px-4">
          {isFold && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xs border border-accent-border bg-accent-subtle text-[11px] font-bold text-accent-text">
              ΔΡ
            </span>
          )}
          <span className="text-[16px] font-bold text-foreground">
            <span className="text-muted-foreground">#</span>general
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            {isFold ? "Delta Rho · 42 members" : "42 members"}
          </span>
          <span className="ml-auto text-[18px] font-bold tracking-[0.5px] text-muted-foreground">
            ⋯
          </span>
        </div>

        {/*
          The fold's frame is static: it is first paint, where README §7 prefers
          a static layout. Only the below-fold frame plays its thread in.
        */}
        <ChatThread animate={!isFold} />
        <div className="mt-auto">
          <Composer />
        </div>
      </div>
    </div>
  );
}

/* 1.6px stroke on a 24 grid, rounded caps and joins (iconography.md §1). */
function ShieldGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3 19 6v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function QrGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M8.5 8.5h2v2h-2zM13.5 8.5h2v2h-2zM8.5 13.5h2v2h-2zM13.5 13.5h2v2h-2z" />
    </svg>
  );
}

function EventFrame() {
  return (
    <div
      role="img"
      aria-label="The Signet mobile app: an event detail with check-in open, a Scan QR to check in button, and an Add to calendar action."
      /*
       * Phone geometry is the base and desktop is the override, because the two
       * boards draw different frames rather than one frame at two widths:
       * `Phone.dc.html` is 350x560 at radius 28 with 44/16 insets,
       * `Main.dc.html` is 390x600 at radius 36 with 56/20. Varying only the
       * width would have shipped a phone frame at the desktop's height and
       * insets, cropping different content than the board approves.
       */
      className="flex h-[560px] w-[350px] max-w-full flex-col overflow-hidden rounded-[28px] border border-input bg-background px-4 pt-11 sm:h-[600px] sm:w-[390px] sm:rounded-[36px] sm:px-5 sm:pt-14"
    >
      <p className="text-[15px] font-semibold leading-5 text-accent-text">
        ‹ Events
      </p>

      <div className="mt-5 flex items-center gap-2">
        {/*
          The danger chip is the board's literal `rgba(248,81,73,.13)` rather
          than `bg-destructive/[0.13]`, and that is not laziness. Tailwind
          compiles an alpha-modified token to `color-mix`, with the OPAQUE token
          as the un-guarded fallback: below the `color-mix` floor the fill
          resolves to `--destructive` and the lifted `--destructive-text` label
          on top of it all but disappears. That exposure was #2376, which gave
          the dashboard `rgba()` `bg-*-tint` tokens with no floor. A literal has
          no `color-mix` dependency, renders the same in every engine, and is
          what the frame is transcribed from anyway, since frame internals
          follow the reference boards rather than the token map.
        */}
        <span className="inline-flex h-6 items-center rounded-xs bg-[rgba(248,81,73,0.13)] px-2.5 text-[12.5px] font-semibold text-destructive-text">
          Mandatory
        </span>
        <span className="inline-flex h-6 items-center rounded-xs border border-accent-border bg-accent-subtle px-2.5 text-[12.5px] font-semibold text-accent-text">
          +10 pts
        </span>
      </div>

      <p className="mt-3 text-[32px] font-bold leading-[37px] tracking-[-0.02em] text-foreground">
        Chapter meeting
      </p>
      <p className="mt-2 text-[16px] leading-[25px] text-muted-foreground">
        Tonight · 6:30 to 7:30 PM · Chapter room
      </p>

      <div className="mt-6 flex flex-col gap-3.5 rounded-lg border border-accent-border bg-accent-subtle p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {/*
            `relative` is load-bearing: the ring is this span's `::after` and
            is positioned against it. `globals.css` § the check-in dot's ring
            carries why the gesture is two beats at the micro duration.
          */}
          <span className="checkin-ring relative h-2.5 w-2.5 shrink-0 rounded-full bg-success" />
          <span className="text-[16px] font-semibold text-accent-text">
            Check-in is open
          </span>
          <span className="text-[12.5px] text-muted-foreground">
            closes 6:45
          </span>
        </div>
        <span className="flex h-12 items-center justify-center gap-2 rounded-md bg-primary text-[16px] font-bold text-primary-foreground">
          <QrGlyph />
          Scan QR to check in
        </span>
      </div>

      <span className="mt-4 flex h-[46px] items-center justify-center rounded-md border border-input bg-card text-[16px] font-semibold text-foreground">
        Add to calendar
      </span>

      <p className="mt-6 text-[12.5px] font-semibold uppercase leading-[17px] tracking-[0.1em] text-muted-foreground">
        Details
      </p>
      <p className="mt-2 text-[16px] leading-[25px] text-muted-foreground">
        Committee reports and the philanthropy vote. Attendance inside the
        window awards the event&apos;s points.
      </p>

      <p className="mt-6 text-[12.5px] font-semibold uppercase leading-[17px] tracking-[0.1em] text-muted-foreground">
        Host
      </p>
      <div className="mt-2 flex items-center gap-2.5">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-popover text-[12px] font-bold text-muted-foreground">
          JE
        </span>
        <span className="text-[16px] leading-[25px] text-foreground">
          Jordan Ellis <span className="text-muted-foreground">· President</span>
        </span>
      </div>
    </div>
  );
}
