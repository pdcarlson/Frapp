> **RESKIN IN PROGRESS** ([#2364](https://github.com/pdcarlson/Frapp/issues/2364)). The bone/bronze/Geist **visual freeze is lifted** and the **token cutover has merged** ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)): `apps/landing` ships Figtree, the Signet ladder and the inlined crest, and the legacy `@repo/theme` tokens are off this surface. Spec-vs-implementation drift against tokens is filable again. What has *not* moved is the **composition** — the page is still the section inventory below, not the boards' eight sections; slice 2 ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)) rebuilds it. Product copy, JSON-LD, lockup word, and the mark are **Signet** and always were.

# UI/UX Specification: Landing Page (frapp.live)

> Signet's storefront, mid-reskin. What ships today leads with the ops-consolidation message — *replace Discord, OmegaFi, and Life360 with one platform* — and treats chat as one capability among six; what it is being rebuilt into leads with chat as the spine. This is the single surviving spec page for the surface: the reskin's decisions, the marketing type and copy rules, the as-built section inventory, route facts, and the OG-image gotcha. Token-level visual truth is [`../design-system/`](../design-system/README.md); the target composition is [`reference/`](reference/README.md).

## The reskin

The crest-editorial redesign of this surface is designed and committed as target-state boards under [`reference/`](reference/README.md) — desktop and phone pages, three alternative folds, and the token, spec and motion sheets. **That README is the one home for the boards' status**, including when they start to bind this surface; it is not restated here.

The build is staged as epic [#2364](https://github.com/pdcarlson/Frapp/issues/2364), four PRs each reviewable on its own and each deleting what it replaces:

| Slice | Issue | Lands |
| --- | --- | --- |
| 0 | [#2365](https://github.com/pdcarlson/Frapp/issues/2365) | This document. Docs only; no code moves |
| 1 | [#2366](https://github.com/pdcarlson/Frapp/issues/2366) | Token cutover across the whole `apps/landing` surface. Supersedes [#2123](https://github.com/pdcarlson/Frapp/issues/2123) |
| 2 | [#2367](https://github.com/pdcarlson/Frapp/issues/2367) | Page rebuild to the section map, with the motion stylesheet and its taxonomy amendment. Supersedes [#447](https://github.com/pdcarlson/Frapp/issues/447) and [#491](https://github.com/pdcarlson/Frapp/issues/491) |
| 3 | [#2368](https://github.com/pdcarlson/Frapp/issues/2368) | Polish and follow-ups |

The section map, copy deck, routes-and-analytics contract, and the verified-versus-assumed ledger are the Spec sheet's ([`reference/canvas/Spec.dc.html`](reference/canvas/Spec.dc.html)). Read it before implementing; do not copy it into this document.

## Decisions D1 to D9

Taken by the owner on 2026-09-18 and recorded on [#2364](https://github.com/pdcarlson/Frapp/issues/2364). Each was drawn one way on the boards with the alternative a flip away; the reasoning for each sits in the Spec sheet's §3 and is not repeated here. **These are settled — an implementer applies them rather than re-opening them.**

| # | Decision | Taken | Consequence for the build |
| --- | --- | --- | --- |
| D1 | Which gold | **`#DDB844`** (mark gold, accent seed, web `--primary`) | One accent seed on the page, and it is the crest's own — the storefront reads one gold, not two. The page takes the accent-slot role set pinned in [`packages/theme/src/signet.css`](../../../packages/theme/src/signet.css) (`--primary`, `--primary-hover`, `--accent-border`, `--accent-text`), which on a marketing surface never retints because no chapter context is applied there. `#EFB63B` house gold does not appear on this surface. Slice 2 reads every gold through those vars, so a later flip is one token |
| D2 | Privacy and Terms in the top nav | **No** — footer only | The legal pages already cross-link each other in their own header ([`LegalDocument`](../../../apps/landing/app/components/legal-document.tsx)) |
| D3 | Pricing on the page | **Full section** — Free beside Chapter Pro | One button, on Free, because both cards resolve to `/sign-up` and no checkout deep link exists. It is the only place the free tier is stated honestly |
| D4 | Motion | **The Motion sheet's spec** | Signature moment on the crest, once-only reveals below the fold, hover and focus on chrome. Carries two prerequisites — see [Motion, and what D4 still owes](#motion-and-what-d4-still-owes) |
| D5 | CTA case | **Sentence case** | "Get started", "Sign in", "Join chapter" everywhere. [`../design-system/writing.md`](../design-system/writing.md) §2's example row still reads `Get Started`; slice 3 amends it. One case ships, never two |
| D6 | Phone width | **390** | The board width only. The layout has no breakpoint between 375 and 390, so nothing else moves; slice 3's visual snapshot pins 390×844 |
| D7 | Footer "Documentation" link | **Dropped** | It points at the GitHub `docs/guides` tree, which is contributor documentation, not customer documentation |
| D8 | Tagline on the storefront | **Held until Ask ships** | *Flips what the boards draw.* The page closes on "Everything your chapter needs is already in chat." instead. Two sources, each for its own half: [`spec/behavior/ai.md`](../../behavior/ai.md) records that there is no `ai` module in the API to route a tool call through and that the mobile Ask mock is unreachable in any shipped build, and the web dashboard's Ask pill opens an "isn't ready" notice ([`ask-pill.tsx`](../../../apps/web/components/layout/ask-pill.tsx)). Scope is the **page body only** — [`layout.tsx`](../../../apps/landing/app/layout.tsx)'s meta title and the OG title keep "Signet. Ask your chapter anything." as built, and [`../brand-identity.md`](../brand-identity.md) §1 still locks it as the brand tagline |
| D9 | Hero | **B — the officer's chat at the fold** | *Flips what the boards draw.* The fold is [`reference/canvas/HeroB.dc.html`](reference/canvas/HeroB.dc.html). Hero A is superseded on **both** page boards — the desktop `Main.dc.html` **and** the 390 `Phone.dc.html`; everything below the fold on the two still stands. The crest keeps the lockup and the closing, and D4's signature moment moves to the **closing** crest, playing on view through the same wrapper |

D8 and D9 are the two answers that differ from what the committed boards draw. Which board elements they supersede is recorded once, in [`reference/README.md`](reference/README.md), with the rest of the boards' status.

### Motion, and what D4 still owes

D4 is taken, and it is the one decision that is not self-contained. It carries two prerequisites, **both of which belong to slice 2 and neither of which is settled by this document**:

- **A fourth motion class must be written before the stylesheet ships.** [`../design-system/README.md`](../design-system/README.md) §7 and [`../design-system/foundations.md`](../design-system/foundations.md) §11 call the three-class taxonomy (micro-feedback, standard transition, context shift) settled discipline that binds every surface. A *signature* class — 520ms, one moment per page load — is an amendment to that taxonomy, not an implementer's call. The README §7 table row and the foundations §11 paragraph land in the **same PR as the landing stylesheet** ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)), never earlier and never later. Slice 0 deliberately does not touch either file.
- **Brand sign-off is outstanding.** The signature moment puts a reveal mask and a backing light behind the crest. That those are *page treatment* rather than *mark design* under [`../brand-identity.md`](../brand-identity.md) §2 has **not** been signed off as of 2026-09-18. Slice 2 must clear it before its stylesheet merges. Tracked on [#2364](https://github.com/pdcarlson/Frapp/issues/2364).

Everything else motion-related on this surface obeys the existing budget in [`../design-system/README.md`](../design-system/README.md) §7 unchanged: no entrance animation on LCP-critical text or the primary CTA, below-the-fold reveals once only, and every reveal drawn at rest under `prefers-reduced-motion`.

## Marketing type roles

The six locked type roles are [`../design-system/foundations.md`](../design-system/foundations.md) §7 and bind every Signet surface. The landing needs three roles above the largest locked one (`display`, 32), because a storefront headline is not a product heading.

**These three are an amendment to §7, and slice 1 ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) settled it.** The amendment is recorded in [`../design-system/foundations.md`](../design-system/foundations.md) §7 ("Amendment: the three marketing type roles"), which is now canonical for them; the table below is the same set, kept here because this is the surface that uses them.

**Home: the landing stylesheet.** They are declared in [`apps/landing/app/globals.css`](../../../apps/landing/app/globals.css) and bound as utilities by [`apps/landing/tailwind.config.ts`](../../../apps/landing/tailwind.config.ts), and [`../design-system/README.md`](../design-system/README.md) §3 rule 4 was widened in the same PR to name a second app-local token home. The alternative — `packages/theme/src/signet.css`, alongside the locked roles — was rejected: that stylesheet is pinned to `signet.ts`, which is the token source `apps/mobile` reads, so a 72px storefront headline declared there would sit one import away from every product screen on two surfaces where §7's six roles are the whole scale. Using one of these three outside `apps/landing` is a defect, exactly as an off-scale literal is.

**The values are not restated here.** `--text-hero`, `--text-display-lg` and `--text-lead`, their desktop and phone sizes, and which element takes each one live in [`../design-system/foundations.md`](../design-system/foundations.md#amendment-the-three-marketing-type-roles-landing-only) § Amendment. One canonical place per fact — a second copy on this page is a copy that drifts, and it did: it disagreed with the canonical table about the phone pricing figures before that was reconciled.

Type inside the two product frames is transcribed from the design-system and web-greenfield boards and is deliberately **not** on this scale. Do not "correct" it.

**Residual off-scale sizes in `page.tsx`, and why they are not drift.** The token cutover moved this surface's colours, typeface and the type that has a named role — the hero H1, the section H2s, the leads, the figures — onto the scale. It did **not** convert the roughly forty-five remaining stock Tailwind sizes (`text-sm`, `text-xs`, `text-base`) in [`apps/landing/app/page.tsx`](../../../apps/landing/app/page.tsx), because slice 2 ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)) rewrites that file to the section map and deletes them. This is the same posture the web reskin took during #920 — residuals on a surface awaiting its rebuild are tracked by the epic, not filed as drift ([`../design-system/README.md`](../design-system/README.md) §2). The legal layout ([`LegalDocument`](../../../apps/landing/app/components/legal-document.tsx)) is **not** in that carve-out and was converted in the cutover, because slice 2 does not rebuild it.

## Marketing copy rules

Copy for this surface obeys [`../design-system/writing.md`](../design-system/writing.md) and the full deck on the Spec sheet's §2. Two rules are owned here because they exist nowhere else:

- **No em dashes in marketing copy.** This extends the web greenfield's product-copy lock ([`../web-greenfield/README.md`](../web-greenfield/README.md#scope-note-on-no-em-dashes)) from product copy to the marketing copy on this surface. It reaches rendered page strings only — headlines, leads, labels, captions, meta description, JSON-LD description. It does **not** reach this document or any other repository prose, which keeps the house style. Like the greenfield lock, no CI check enforces it; it is a review rule.
- **Sentence case on buttons and links** (D5), until [`../design-system/writing.md`](../design-system/writing.md) §2 is amended to match in slice 3.

## Section inventory (as built, until slice 2)

> **This table describes the page that ships today, not the page being built.** The target section map — eight sections, what each one replaces here, and the truth each is drawn from — is the Spec sheet's §1 ([`reference/canvas/Spec.dc.html`](reference/canvas/Spec.dc.html)); it is linked rather than copied so the two cannot drift. Slice 2 ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)) replaces this inventory with the shipped page's.

Source of truth: [`apps/landing/app/page.tsx`](../../../apps/landing/app/page.tsx) — one file renders the whole page; the only extracted pieces are [`FrappLockup`](../../../apps/landing/components/frapp-lockup.tsx) and [`buildAuthUrls`](../../../apps/landing/lib/auth-urls.ts).

| # | Section | Content |
| --- | ------- | ------- |
| 1 | Header (sticky) | `FrappLockup` (locked emblem B **inlined as one SVG path** + Signet word, links to `/`); anchor nav Features / How it works / Pricing, hidden below `md`; "Log In" (also `md`+ only) and a primary "Get Started" |
| 2 | Hero | Eyebrow "The operating system for greek life" (CSS-uppercased), H1 "Replace Discord, OmegaFi, and Life360 with one intentional platform.", sub paragraph on unifying comms/events/study/points/dues, primary CTA "Get Started", secondary "Explore the product", trust line "14-day trial • No per-seat pricing • Stripe-backed billing". Right column is a hand-built "Chapter Operations Snapshot" card — "Subscription active" pill plus four static status lines. **No hero image, no chat mockup.** |
| 3 | Stats strip | Three static values (50+ chapters, 2,000+ members, 10,000+ events). Values are plain text; there is no count-up animation and no metrics disclaimer. |
| 4 | Features (`#features`) | Eyebrow "Core capabilities", H2 "One ledger for communication, events, points, and dues." One bordered list, six equal-weight rows in this order: Backwork Library, Real-Time Chat, Events & Attendance, Points & Leaderboard, Study Hours, Billing & Dues. Chat is a peer row, not a lead block, and nothing is framed as an upgrade grid. |
| 5 | How it works (`#how-it-works`) | H2 "Launch your chapter in under five minutes." Three numbered cards: 01 "Create your chapter workspace", 02 "Invite members with role defaults", 03 "Run events, communication, and accountability" |
| 6 | App showcase | Eyebrow "Product in context", H2 "Web and mobile surfaces designed as one system." Two cards, each a static SVG rendered through `next/image` (`/showcase-dashboard.svg` 1280×900, `/showcase-mobile.svg` 900×900) over a caption: "Dashboard operations console" and "Member mobile loop". Flat art in bordered cards — no device frames, no feature tabs |
| 7 | Pricing (`#pricing`) | **One** card: "Simple chapter pricing", **$149 / per chapter / month**, five bullets (unlimited members and officers; chat, events, points, study tracking, billing; role-based permissions and audit history; reports and exports; priority implementation support), CTA "Start free trial". Beside it, four always-open FAQ cards — not an accordion. No free tier and no second tier render |
| 8 | Testimonials | H2 "Built for real chapter operations.", supporting line "Officers run chat, events, hours, and dues in one place.", three quote cards with name / role / chapter |
| 9 | Final CTA | Full-bleed band on the elevated ladder step (`bg-card`), H2 "Ready to run your chapter with clarity, speed, and accountability?", sub paragraph, CTA "Get Started" |
| 10 | Footer | Four columns — Product (Features, Pricing, Get Started), Resources (Documentation → the GitHub `docs/guides` tree in a new tab, Log In), Legal (Terms of Service, Privacy Policy, FERPA Notice), Contact (Support → `/support`, `mailto:team@frapp.live`) — over a copyright line |

Two as-built quirks the table would otherwise hide:

- `id="showcase"` sits on the **hero's** snapshot card, not on section 6. The hero's "Explore the product" button therefore scrolls to the hero itself; the App showcase section carries no id.
- A `SoftwareApplication` JSON-LD block is injected at the top of `<main>`. Its offer repeats the price as `149` USD / "Flat monthly chapter plan", so the $149 figure ships in two places.

Entrance motion is opt-out throughout: every animated block pairs `motion-safe:animate-fade-up` with `motion-reduce:animate-none`, using the `fade-up` keyframes from the shared preset ([`packages/theme/src/tailwind.config.ts`](../../../packages/theme/src/tailwind.config.ts)).

**Legal routes:** `/terms` (Terms of Service), `/privacy` (Privacy Policy), `/ferpa` (FERPA Notice) and — since 2026-09-06, because both app stores require a public support URL — `/support` all render through one prose layout, [`LegalDocument`](../../../apps/landing/app/components/legal-document.tsx). That layout has its own narrower header — lockup plus Terms / Privacy / FERPA / Support links — and **no footer and no marketing nav**; it does not reuse the main page's header or footer. [`apps/landing/app/sitemap.ts`](../../../apps/landing/app/sitemap.ts) lists these four alongside `/`.

## Route facts

- **Log In** routes to the web app's `/sign-in` (the Supabase Auth sign-in route). There is **no `/login` route**. Both auth targets are absolute URLs built by [`buildAuthUrls`](../../../apps/landing/lib/auth-urls.ts) from `NEXT_PUBLIC_APP_URL` (default `https://app.frapp.live`), and the paths are unit-tested so they cannot silently drift.
- Every CTA on the page — header "Get Started", hero "Get Started", the single pricing card's "Start free trial", the final CTA, and the footer "Get Started" — routes to `/sign-up`.
- `/sign-up` itself lands the new user on `/chat`; the first-officer chapter wizard then opens as a gate for anyone with zero chapter memberships ([`spec/behavior/onboarding.md`](../../behavior/onboarding.md)). The landing page does not link the wizard directly.
- The header's in-page nav resolves to `#features`, `#how-it-works`, and `#pricing`; all three targets exist.
- `/join` is not a landing page. The redirect, https requirement, and sitemap omission are owned by [`spec/product/surfaces.md`](../../product/surfaces.md) Landing.

## OG image (gotcha)

Do **not** point `openGraph.images` / `twitter.images` at a static `/og-image.png` — no such file exists in `public/`. The canonical social image is the dynamic App Router route [`apps/landing/app/opengraph-image.tsx`](../../../apps/landing/app/opengraph-image.tsx) (nodejs runtime so it can `readFile` the Design PNG, 1200×630). [`apps/landing/app/layout.tsx`](../../../apps/landing/app/layout.tsx) is correct as built: `metadataBase` is `https://frapp.live`, `openGraph.images` is `{ url: "/opengraph-image", width: 1200, height: 630, alt }`, and `twitter.images` is `["/opengraph-image"]` with a `summary_large_image` card, so previews resolve to the generated image at runtime.

## Performance

**The hero paints text, not an image.** The LCP element is the H1 block — there is no hero image, and no `next/image` call renders above the fold. That is the guard: nothing above the fold may become an image without re-deciding the LCP story, and no `priority` image should be introduced to a hero that has none.

The header lockup **is no longer an image request at all.** It was a 32×32 `next/image` of the Design tile; the token cutover ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) replaced it with the crest inlined as one SVG path, which removes a request from a component that renders above the fold on every route, the legal pages included. The only `next/image` calls left are the below-fold showcase mockups in [`apps/landing/app/page.tsx`](../../../apps/landing/app/page.tsx), both explicitly `priority={false}` so they stay lazy and never preempt the text paint. Keep them that way, and keep the lockup inline.

## Pricing truth

What ships: a **single** pricing card at **$149 per chapter / month** with a "Start free trial" CTA, backed by FAQ copy stating one flat monthly chapter plan, no per-seat pricing, no feature gating, and a 14-day trial for every new chapter. The same $149 is duplicated in the page's JSON-LD offer.

[`spec/product/positioning.md`](../../product/positioning.md) is canonical for pricing. **Two of the three divergences it used to carry are now closed, and one is not.**

Closed: **$149/chapter/month** is now stated in `positioning.md` as the committed amount, so the card and the spec agree rather than the card being an unbacked number. And the **14-day trial is implemented** (#913) — `subscription_data.trial_period_days` on the Checkout Session — so the "Start free trial" CTA no longer charges on day zero.

Still open in code, and now scheduled: **the page renders no free tier, and its "no feature gating" claim contradicts the gating model.** `positioning.md` makes the free tier the wedge (unlimited chat, members, chapters) with ops and AI modules gated behind Chapter Pro; the page shows a single paid card. That also makes "every new chapter starts with a 14-day trial" imprecise under the canonical model — a new chapter starts on the **free tier**, and the trial opens when it subscribes. This page does not own pricing truth. What has changed is that it is no longer unowned: **D3** takes the full pricing section with Free beside Chapter Pro, and slice 2 ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)) closes the divergence by rebuilding the section — including deleting the FAQ block entirely, all four cards. Only the first of them carries the "no feature gating" claim; the other three are cancellation, trial and alumni, and they go because the rebuilt section has no FAQ, not because each is false. Do not reconcile any of it by editing this table.
