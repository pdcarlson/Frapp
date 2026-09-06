> **FROZEN (pre-Signet).** This surface ships the legacy Frapp landing at frapp.live until its Signet pass. Do not implement visual changes from this document and do not file spec-vs-implementation drift issues against it.

# UI/UX Specification: Landing Page (frapp.live)

> Frapp's storefront as built. It leads with the ops-consolidation message — *replace Discord, OmegaFi, and Life360 with one platform* — and treats chat as one capability among six, not as the headline. This is the single surviving spec page for the surface: section inventory, route facts, and the OG-image gotcha. Visual truth for the future reskin lives in [`../design-system/`](../design-system/README.md).

## Section inventory (live page, scroll order)

Source of truth: [`apps/landing/app/page.tsx`](../../../apps/landing/app/page.tsx) — one file renders the whole page; the only extracted pieces are [`FrappLockup`](../../../apps/landing/components/frapp-lockup.tsx) and [`buildAuthUrls`](../../../apps/landing/lib/auth-urls.ts).

| # | Section | Content |
| --- | ------- | ------- |
| 1 | Header (sticky) | `FrappLockup` (inline SVG, links to `/`); anchor nav Features / How it works / Pricing, hidden below `md`; "Log In" (also `md`+ only) and a primary "Get Started" |
| 2 | Hero | Eyebrow "The operating system for greek life" (CSS-uppercased), H1 "Replace Discord, OmegaFi, and Life360 with one intentional platform.", sub paragraph on unifying comms/events/study/points/dues, primary CTA "Get Started", secondary "Explore the product", trust line "14-day trial • No per-seat pricing • Stripe-backed billing". Right column is a hand-built "Chapter Operations Snapshot" card — "Subscription active" pill plus four static status lines. **No hero image, no chat mockup.** |
| 3 | Stats strip | Three static values (50+ chapters, 2,000+ members, 10,000+ events) with an explicit "Illustrative projections—not reported customer metrics" disclaimer. Values are plain text — there is no count-up animation anywhere on the page. The disclaimer cites [`spec/ui/brand-identity.md`](../brand-identity.md). |
| 4 | Features (`#features`) | Eyebrow "Core capabilities", H2 "One ledger for communication, events, points, and dues." One bordered list, six equal-weight rows in this order: Backwork Library, Real-Time Chat, Events & Attendance, Points & Leaderboard, Study Hours, Billing & Dues. Chat is a peer row, not a lead block, and nothing is framed as an upgrade grid. |
| 5 | How it works (`#how-it-works`) | H2 "Launch your chapter in under five minutes." Three numbered cards: 01 "Create your chapter workspace", 02 "Invite members with role defaults", 03 "Run events, communication, and accountability" |
| 6 | App showcase | Eyebrow "Product in context", H2 "Web and mobile surfaces designed as one system." Two cards, each a static SVG rendered through `next/image` (`/showcase-dashboard.svg` 1280×900, `/showcase-mobile.svg` 900×900) over a caption: "Dashboard operations console" and "Member mobile loop". Flat art in bordered cards — no device frames, no feature tabs |
| 7 | Pricing (`#pricing`) | **One** card: "Simple chapter pricing", **$149 / per chapter / month**, five bullets (unlimited members and officers; chat, events, points, study tracking, billing; role-based permissions and audit history; reports and exports; priority implementation support), CTA "Start free trial". Beside it, four always-open FAQ cards — not an accordion. No free tier and no second tier render |
| 8 | Testimonials | H2 "Built for real chapter operations.", disclaimer "Composite feedback—illustrative of officer workflows; not attributed to verified customers until published as such.", three quote cards with name / role / chapter |
| 9 | Final CTA | Full-bleed navy band, H2 "Ready to run your chapter with clarity, speed, and accountability?", sub paragraph, CTA "Get Started" |
| 10 | Footer | Four columns — Product (Features, Pricing, Get Started), Resources (Documentation → the GitHub `docs/guides` tree in a new tab, Log In), Legal (Terms of Service, Privacy Policy, FERPA Notice), Contact (Support → `/support`, `mailto:team@frapp.live`) — over a copyright line |

Two as-built quirks the table would otherwise hide:

- `id="showcase"` sits on the **hero's** snapshot card, not on section 6. The hero's "Explore the product" button therefore scrolls to the hero itself; the App showcase section carries no id.
- A `SoftwareApplication` JSON-LD block is injected at the top of `<main>`. Its offer repeats the price as `149` USD / "Flat monthly chapter plan", so the $149 figure ships in two places.

Entrance motion is opt-out throughout: every animated block pairs `motion-safe:animate-fade-up` with `motion-reduce:animate-none`, using the `fade-up` keyframes from the shared preset ([`packages/theme/src/tailwind.config.ts`](../../../packages/theme/src/tailwind.config.ts)).

**Legal routes:** `/terms` (Terms of Service), `/privacy` (Privacy Policy), `/ferpa` (FERPA Notice) and — since 2026-09-06, because both app stores require a public support URL — `/support` all render through one prose layout, [`LegalDocument`](../../../apps/landing/app/components/legal-document.tsx). That layout has its own narrower header — lockup plus Terms / Privacy / FERPA / Support links — and **no footer and no marketing nav**; it does not reuse the main page's header or footer. [`apps/landing/app/sitemap.ts`](../../../apps/landing/app/sitemap.ts) lists these four alongside `/` — the site's complete public route set.

## Route facts

- **Log In** routes to the web app's `/sign-in` (the Supabase Auth sign-in route). There is **no `/login` route**. Both auth targets are absolute URLs built by [`buildAuthUrls`](../../../apps/landing/lib/auth-urls.ts) from `NEXT_PUBLIC_APP_URL` (default `https://app.frapp.live`), and the paths are unit-tested so they cannot silently drift.
- Every CTA on the page — header "Get Started", hero "Get Started", the single pricing card's "Start free trial", the final CTA, and the footer "Get Started" — routes to `/sign-up`.
- `/sign-up` itself lands the new user on `/chat`; the first-officer chapter wizard then opens as a gate for anyone with zero chapter memberships ([`spec/behavior/onboarding.md`](../../behavior/onboarding.md)). The landing page does not link the wizard directly.
- The header's in-page nav resolves to `#features`, `#how-it-works`, and `#pricing`; all three targets exist.

## OG image (gotcha)

Do **not** point `openGraph.images` / `twitter.images` at a static `/og-image.png` — no such file exists in `public/`. The canonical social image is the dynamic App Router route [`apps/landing/app/opengraph-image.tsx`](../../../apps/landing/app/opengraph-image.tsx) (edge runtime, 1200×630). [`apps/landing/app/layout.tsx`](../../../apps/landing/app/layout.tsx) is correct as built: `metadataBase` is `https://frapp.live`, `openGraph.images` is `{ url: "/opengraph-image", width: 1200, height: 630, alt }`, and `twitter.images` is `["/opengraph-image"]` with a `summary_large_image` card, so previews resolve to the generated image at runtime.

## Performance

**The hero paints text, not an image.** The LCP element is the H1 block — there is no hero image, and no `next/image` call renders above the fold. That is the guard: nothing above the fold may become an image without re-deciding the LCP story, and no `priority` image should be introduced to a hero that has none.

The only two `next/image` calls are the below-fold showcase mockups in [`apps/landing/app/page.tsx`](../../../apps/landing/app/page.tsx), both explicitly `priority={false}` so they stay lazy and never preempt the text paint. Keep them that way.

## Pricing truth

What ships: a **single** pricing card at **$149 per chapter / month** with a "Start free trial" CTA, backed by FAQ copy stating one flat monthly chapter plan, no per-seat pricing, no feature gating, and a 14-day trial for every new chapter. The same $149 is duplicated in the page's JSON-LD offer.

[`spec/product/positioning.md`](../../product/positioning.md) is canonical for pricing. **Two of the three divergences it used to carry are now closed, and one is not.**

Closed: **$149/chapter/month** is now stated in `positioning.md` as the committed amount, so the card and the spec agree rather than the card being an unbacked number. And the **14-day trial is implemented** (#913) — `subscription_data.trial_period_days` on the Checkout Session — so the "Start free trial" CTA no longer charges on day zero.

Still open: **the page renders no free tier, and its "no feature gating" claim contradicts the gating model.** `positioning.md` makes the free tier the wedge (unlimited chat, members, chapters) with ops and AI modules gated behind Chapter Pro; the page shows a single paid card. That also makes "every new chapter starts with a 14-day trial" (`:99`) imprecise under the canonical model — a new chapter starts on the **free tier**, and the trial opens when it subscribes. This page does not own pricing truth; that remainder is a product/copy question for the surface owner, and the page is [visual-change frozen](#future-reskin) until its Signet reskin, so it is not something to reconcile by editing this table.

## Future reskin

The landing's Signet visual system is specified in [`../design-system/`](../design-system/README.md). Until its Signet pass lands, the implementation intentionally ships the legacy Frapp landing and this document stays visual-change frozen.
