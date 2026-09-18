> **RESKIN IN PROGRESS** ([#2364](https://github.com/pdcarlson/Frapp/issues/2364)), with two of four slices merged. The bone/bronze/Geist **visual freeze is lifted**, the **token cutover has merged** ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) and the **page rebuild has merged** ([#2367](https://github.com/pdcarlson/Frapp/issues/2367)): `apps/landing` ships Figtree, the Signet ladder, the inlined crest and the boards' composition. Spec-vs-implementation drift is filable against both tokens and structure now. What is left is slice 3 ([#2368](https://github.com/pdcarlson/Frapp/issues/2368)), which is polish, plus one piece of D4 that a human has to unblock before an agent can build it ([#2378](https://github.com/pdcarlson/Frapp/issues/2378)). Product copy, JSON-LD, lockup word, and the mark are **Signet** and always were.

# UI/UX Specification: Landing Page (frapp.live)

> Signet's storefront. It leads with chat as the spine and the free tier as the wedge: the ops-consolidation message — *replace Discord, OmegaFi, and Life360 with one platform* — and the six-capability feature list it sat on are gone, deleted by slice 2 rather than rewritten. This is the single surviving spec page for the surface: the reskin's decisions, the marketing type and copy rules, the as-built section inventory, route facts, and the OG-image gotcha. Token-level visual truth is [`../design-system/`](../design-system/README.md); the composition the page is built to is [`reference/`](reference/README.md).

## The reskin

The crest-editorial redesign of this surface is designed and committed as target-state boards under [`reference/`](reference/README.md) — desktop and phone pages, three alternative folds, and the token, spec and motion sheets. **That README is the one home for the boards' status**, including when they start to bind this surface; it is not restated here.

The build is staged as epic [#2364](https://github.com/pdcarlson/Frapp/issues/2364), four PRs each reviewable on its own and each deleting what it replaces:

| Slice | Issue | Lands |
| --- | --- | --- |
| 0 | [#2365](https://github.com/pdcarlson/Frapp/issues/2365) | This document. Docs only; no code moves |
| 1 | [#2366](https://github.com/pdcarlson/Frapp/issues/2366) | Token cutover across the whole `apps/landing` surface. Supersedes [#2123](https://github.com/pdcarlson/Frapp/issues/2123) |
| 2 | [#2367](https://github.com/pdcarlson/Frapp/issues/2367) | **Merged.** Page rebuild to the section map, with the motion stylesheet. The taxonomy amendment did *not* ship with it and deliberately so: the signature moment it would have paid for is cut pending brand sign-off ([#2378](https://github.com/pdcarlson/Frapp/issues/2378)). Superseded [#447](https://github.com/pdcarlson/Frapp/issues/447) and [#491](https://github.com/pdcarlson/Frapp/issues/491) |
| 3 | [#2368](https://github.com/pdcarlson/Frapp/issues/2368) | Polish and follow-ups |

The section map, copy deck, routes-and-analytics contract, and the verified-versus-assumed ledger are the Spec sheet's ([`reference/canvas/Spec.dc.html`](reference/canvas/Spec.dc.html)). Read it before implementing; do not copy it into this document.

## Decisions D1 to D9

Taken by the owner on 2026-09-18 and recorded on [#2364](https://github.com/pdcarlson/Frapp/issues/2364). Each was drawn one way on the boards with the alternative a flip away; the reasoning for each sits in the Spec sheet's §3 and is not repeated here. **These are settled — an implementer applies them rather than re-opening them.**

| # | Decision | Taken | Consequence for the build |
| --- | --- | --- | --- |
| D1 | Which gold | **`#DDB844`** (mark gold, accent seed, web `--primary`) | One accent seed on the page, and it is the crest's own — the storefront reads one gold, not two. The page takes the accent-slot role set pinned in [`packages/theme/src/signet.css`](../../../packages/theme/src/signet.css) (`--primary`, `--primary-hover`, `--accent-border`, `--accent-text`), which on a marketing surface never retints because no chapter context is applied there. `#EFB63B` house gold does not appear on this surface. Slice 2 reads every gold through those vars, so a later flip is one token |
| D2 | Privacy and Terms in the top nav | **No** — footer only | The legal pages already cross-link each other in their own header ([`LegalDocument`](../../../apps/landing/app/components/legal-document.tsx)) |
| D3 | Pricing on the page | **Full section** — Free beside Chapter Pro | One button, on Free, because both cards resolve to `/sign-up` and no checkout deep link exists. It is the only place the free tier is stated honestly |
| D4 | Motion | **The Motion sheet's spec** | Once-only reveals below the fold and hover and focus on chrome shipped in slice 2. The signature moment on the crest did **not**: it needed brand sign-off that nobody but the owner can give, so the crest pieces were cut rather than trimmed — see [Motion, and what D4 still owes](#motion-and-what-d4-still-owes) |
| D5 | CTA case | **Sentence case** | "Get started", "Sign in", "Join chapter" everywhere. [`../design-system/writing.md`](../design-system/writing.md) §2's example row still reads `Get Started`; slice 3 amends it. One case ships, never two |
| D6 | Phone width | **390** | The board width only. The layout has no breakpoint between 375 and 390, so nothing else moves; slice 3's visual snapshot pins 390×844 |
| D7 | Footer "Documentation" link | **Dropped** | It points at the GitHub `docs/guides` tree, which is contributor documentation, not customer documentation |
| D8 | Tagline on the storefront | **Held until Ask ships** | *Flips what the boards draw.* The page closes on "Everything your chapter needs is already in chat." instead. Two sources, each for its own half: [`spec/behavior/ai.md`](../../behavior/ai.md) records that there is no `ai` module in the API to route a tool call through and that the mobile Ask mock is unreachable in any shipped build, and the web dashboard's Ask pill opens an "isn't ready" notice ([`ask-pill.tsx`](../../../apps/web/components/layout/ask-pill.tsx)). Scope is the **page body only** — [`layout.tsx`](../../../apps/landing/app/layout.tsx)'s meta title and the OG title keep "Signet. Ask your chapter anything." as built, and [`../brand-identity.md`](../brand-identity.md) §1 still locks it as the brand tagline |
| D9 | Hero | **B — the officer's chat at the fold** | *Flips what the boards draw.* The fold is [`reference/canvas/HeroB.dc.html`](reference/canvas/HeroB.dc.html). Hero A is superseded on **both** page boards — the desktop `Main.dc.html` **and** the 390 `Phone.dc.html`; everything below the fold on the two still stands. The crest keeps the lockup and the closing. D4's signature moment was to move to the **closing** crest with it; it is cut until sign-off, so that crest paints whole ([#2378](https://github.com/pdcarlson/Frapp/issues/2378)) |

D8 and D9 are the two answers that differ from what the committed boards draw. Which board elements they supersede is recorded once, in [`reference/README.md`](reference/README.md), with the rest of the boards' status.

### Motion, and what D4 still owes

D4 is taken, and it is the one decision that did not fit inside one slice. It carried two prerequisites, and **slice 2 shipped around the one it could not satisfy**.

- **Brand sign-off is outstanding, and it is the binding constraint.** The signature moment puts a reveal mask and a backing light behind the crest. That those are *page treatment* rather than *mark design* under [`../brand-identity.md`](../brand-identity.md) §2 has **not** been signed off. Only the owner can clear it. So slice 2 took the Motion sheet's own instruction for this case and **cut the crest pieces rather than trimming them** — a 300ms wipe is a different gesture, not a smaller one. The closing crest paints whole, from the first frame, on every branch. The question, what unblocks it and the build brief for the work are on [#2378](https://github.com/pdcarlson/Frapp/issues/2378).
- **The fourth motion class is therefore not written, and that is the correct state, not an omission.** [`../design-system/README.md`](../design-system/README.md) §7 and [`../design-system/foundations.md`](../design-system/foundations.md) §11 call the three-class taxonomy (micro-feedback, standard transition, context shift) settled discipline that binds every surface. A *signature* class — 520ms, one moment per page load — is an amendment to it, and an amendment that pays for nothing is a claim about a class no surface uses. The rule is unchanged and still binds whoever lands #2378: the README §7 table row and the foundations §11 paragraph go in the **same pull request as the stylesheet that declares the class**, never earlier and never later. That rule is now enforced rather than remembered — `apps/landing/app/page.spec.ts` fails if the landing stylesheet declares a signature class while either doc is silent.

**What did ship is the rest of the sheet**, and all of it fits the existing budget in [`../design-system/README.md`](../design-system/README.md) §7 with no amendment: once-only reveals below the fold, section hairlines drawing in, the chat thread arriving row by row, and hover and focus on chrome as colour and border only. No entrance animation touches LCP-critical text or the primary CTA, every reveal is drawn at rest under `prefers-reduced-motion`, and nothing runs longer than the 300ms context ceiling.

## Marketing type roles

The six locked type roles are [`../design-system/foundations.md`](../design-system/foundations.md) §7 and bind every Signet surface. The landing needs three roles above the largest locked one (`display`, 32), because a storefront headline is not a product heading.

**These three are an amendment to §7, and slice 1 ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) settled it.** The amendment is recorded in [`../design-system/foundations.md`](../design-system/foundations.md#amendment-the-three-marketing-type-roles-landing-only) §7, which is now canonical for them — values included.

**Home: the landing stylesheet.** They are declared in [`apps/landing/app/globals.css`](../../../apps/landing/app/globals.css) and bound as utilities by [`apps/landing/tailwind.config.ts`](../../../apps/landing/tailwind.config.ts), and [`../design-system/README.md`](../design-system/README.md) §3 rule 4 was widened in the same PR to name a second app-local token home. The alternative — `packages/theme/src/signet.css`, alongside the locked roles — was rejected: that stylesheet is pinned to `signet.ts`, which is the token source `apps/mobile` reads, so a 72px storefront headline declared there would sit one import away from every product screen on two surfaces where §7's six roles are the whole scale. Using one of these three outside `apps/landing` is a defect, exactly as an off-scale literal is.

**The values are not restated here.** `--text-hero`, `--text-display-lg` and `--text-lead`, their desktop and phone sizes, and which element takes each one live in [`../design-system/foundations.md`](../design-system/foundations.md#amendment-the-three-marketing-type-roles-landing-only) § Amendment. One canonical place per fact — a second copy on this page is a copy that drifts, and it did: it disagreed with the canonical table about the phone pricing figures before that was reconciled.

Type inside the two product frames is transcribed from the design-system and web-greenfield boards and is deliberately **not** on this scale. Do not "correct" it.

**The residual off-scale carve-out is spent, and page chrome is now on the scale.** The token cutover left roughly forty-five stock Tailwind sizes (`text-sm`, `text-xs`, `text-base`) in `page.tsx` because slice 2 was going to rewrite the file; it did, and they went with the sections that carried them. Every piece of **landing chrome** now takes a named role: `text-hero` on the H1, `text-display-lg` on section H2s and the desktop figures, `text-lead`, `text-title`, `text-body`, `text-label`, `text-caption`. A stock Tailwind size on page chrome is filable drift today, not a tracked residual.

**Type inside the two product frames is the one exception, and it is deliberate.** The frames carry literal sizes (`text-[16px]`, `text-[12.5px]`) and literal radii because they are transcriptions of the product boards, not landing chrome: the System sheet's rule is that landing chrome sits on the grid and the scale while frame internals follow the reference boards. Do not "correct" them to the scale, and do not read them as licence for an off-scale size anywhere else on the page.

## Marketing copy rules

Copy for this surface obeys [`../design-system/writing.md`](../design-system/writing.md) and the full deck on the Spec sheet's §2. Two rules are owned here because they exist nowhere else:

- **No em dashes in marketing copy.** This extends the web greenfield's product-copy lock ([`../web-greenfield/README.md`](../web-greenfield/README.md#scope-note-on-no-em-dashes)) from product copy to the marketing copy on this surface. It reaches rendered page strings only — headlines, leads, labels, captions, meta description, JSON-LD description. It does **not** reach this document or any other repository prose, which keeps the house style. Like the greenfield lock, no CI check enforces it; it is a review rule.
- **Sentence case on buttons and links** (D5), until [`../design-system/writing.md`](../design-system/writing.md) §2 is amended to match in slice 3.

## Section inventory (as built)

> **This table describes the page that ships.** Why each section exists, what it replaced and the truth each is drawn from are the Spec sheet's §1 ([`reference/canvas/Spec.dc.html`](reference/canvas/Spec.dc.html)); that is linked rather than copied so the two cannot drift. What follows is the shipped structure only.

Source of truth: [`apps/landing/app/page.tsx`](../../../apps/landing/app/page.tsx) — one file renders the whole page. The extracted pieces are [`FrappLockup`](../../../apps/landing/components/frapp-lockup.tsx), [`TrackedCta`](../../../apps/landing/components/tracked-cta.tsx), [`RevealOnView`](../../../apps/landing/components/reveal-on-view.tsx) and [`buildAuthUrls`](../../../apps/landing/lib/auth-urls.ts). The page is server-rendered with inline Tailwind; the only client code it pulls in is `TrackedCta` and `RevealOnView`.

A skip link ("Skip to content") is the first thing in the tab order and targets the `<main id="top">` landmark, which is focusable so focus actually moves. The header and footer sit outside that landmark.

| # | Section | Content |
| --- | ------- | ------- |
| 0 | Header (sticky) | `FrappLockup` (locked emblem B inlined as one SVG path + Signet word, links to `/`); nav Product / Pricing, hidden below `md`; "Sign in" and a primary "Get started", both always visible. Every text link carries a 44px hit box. No Privacy or Terms link (D2) |
| 1 | Hero (`#top`, on `<main>`) | Eyebrow "Chapter operations, chat first", H1 "Run your chapter where it already talks.", lead on chat being where events, check-in and points land, primary "Get started", accent text link "Have an invite? Join your chapter", and a tier line naming Free and Chapter Pro. Beside it, **the officer's chat frame** (D9, hero B): static JSX, `role="img"`, bleeding off the right edge at `lg` and whole below it. No crest at the fold, no image request, no entrance animation on the H1, lead or primary CTA |
| 2 | Officers | Eyebrow "Built for officers" over three columns: President, Treasurer, Secretary, one shipped outcome each. Drawn at rest, not revealed: D9 moved this strip inside the fold, where §7's motion budget prefers a static layout |
| 3 | Proof, chat (`#product`) | Eyebrow "Chat is the spine", H2 "Ops happen in the thread.", a lead, then three proof rows (Events post as cards / Red means you / Officer changes are public) over a hairline that draws in. Beside it the full chat frame: 220px channel rail with a neutral channel unread, a red DM badge and `#chapter-audit`, and a timeline whose rows arrive one by one on first view |
| 4 | Proof, events | The mobile event-detail frame (check-in open, "Scan QR to check in", Add to calendar, details, host) beside eyebrow "Events and check-in", H2 "Check-in that keeps its own books.", a lead and three proof rows. **No RSVP control anywhere**, and no count a member could not see |
| 5 | Pricing (`#pricing`) | Eyebrow, H2 "Free for chat. Pro for the ops.", a lead, and the trial mechanics stated exactly as `positioning.md` records them. Beside it two cards: **Free** ($0 per chapter, five lines, the section's one button) and **Chapter Pro** ($149 per chapter, per month, flat; gold 2px top rule, a "14-day trial" chip, five lines, and "Upgrade any time from Settings inside the app." in place of a control) |
| 6 | Closing | The crest at 56/72, H2 "Everything your chapter needs is already in chat." (D8 holds the locked tagline), a lead, then "Get started" beside "Sign in" |
| 7 | Footer | One row: lockup tile and © line on the left, eight links on the right — Sign in, Product, Pricing, Support, Privacy, Terms, FERPA, `team@frapp.live`. No "Documentation" link (D7) |

Four things the table would otherwise hide:

- **Both product frames are static JSX, never images.** Each is one `role="img"` with an `aria-label` describing what it shows, so assistive tech gets the picture in a sentence instead of a tree of decorative divs, and each carries a caption naming its contents as demo data. `ChatFrame` renders twice — cropped at the fold, full with its channel rail in section 3 — so three frames come from two components.
- **What the frames may draw is bounded by `spec/behavior/`, not by the boards.** The event card carries Check in and nothing else; the live attendance count is drawn because the viewer is an officer, which the caption states; no dues artifact appears in the thread, because that renderer is a stub; there is no Ask pill.
- **The JSON-LD carries two offers**, Free at `0` and Chapter Pro at `149`, and its description names both tiers. The $149 figure therefore still ships in two places, the pricing card and the structured data, which is what `positioning.md` means when it says moving the number means moving the site.
- **Motion is one landing-scoped stylesheet plus one client wrapper.** `app/globals.css` carries the keyframes and a CSS mirror of the `@repo/theme` motion scale; `components/reveal-on-view.tsx` adds one class when a block first enters the viewport and unobserves, so a reveal plays once and never runs backwards. The base state is the finished block: with no JavaScript, with no `IntersectionObserver`, or under `prefers-reduced-motion`, nothing is ever hidden. `apps/landing` goes from three client files to four.

**Legal routes:** `/terms` (Terms of Service), `/privacy` (Privacy Policy), `/ferpa` (FERPA Notice) and — since 2026-09-06, because both app stores require a public support URL — `/support` all render through one prose layout, [`LegalDocument`](../../../apps/landing/app/components/legal-document.tsx). That layout has its own narrower header — lockup plus Terms / Privacy / FERPA / Support links — and **no footer and no marketing nav**; it does not reuse the main page's header or footer. [`apps/landing/app/sitemap.ts`](../../../apps/landing/app/sitemap.ts) lists these four alongside `/`.

## Route facts

- **"Sign in"** routes to the web app's `/sign-in` (the Supabase Auth sign-in route). There is **no `/login` route**. Both auth targets are absolute URLs built by [`buildAuthUrls`](../../../apps/landing/lib/auth-urls.ts) from `NEXT_PUBLIC_APP_URL` (default `https://app.frapp.live`), and the paths are unit-tested so they cannot silently drift.
- Every "Get started" on the page — header, hero, the Free card and the closing — routes to `/sign-up`. "Sign in" appears in the header, the closing and the footer.
- **The analytics ids are not the labels.** The sign-in control reports `log-in` and the closing section reports the surface `cta-band`, both deliberately: they are the join keys for the `landing-cta-clicked` rows PostHog already holds, and renaming either would split one funnel at the reskin's merge commit. The closed allowlists are [`lib/posthog/events.ts`](../../../apps/landing/lib/posthog/events.ts); the full contract is the Spec sheet's §5.
- **"Have an invite? Join your chapter" points at this origin's own `/join`**, not straight at the app. That route calls `buildJoinUrl` itself and forwards with the invite query intact. Building the app URL on the homepage instead would move that helper's throw on a misconfigured `NEXT_PUBLIC_APP_URL` from one redirect route onto `/`, which is the 500 [`auth-urls.ts`](../../../apps/landing/lib/auth-urls.ts) documents avoiding.
- `/sign-up` itself lands the new user on `/chat`; the first-officer chapter wizard then opens as a gate for anyone with zero chapter memberships ([`spec/behavior/onboarding.md`](../../behavior/onboarding.md)). The landing page does not link the wizard directly.
- The header's in-page nav resolves to `#product` and `#pricing`; both targets exist. `#features` and `#how-it-works` are gone with the sections that carried them, and so is the `#showcase` anchor that used to sit on the hero's own card.
- `/join` is not a landing page. The redirect, https requirement, and sitemap omission are owned by [`spec/product/surfaces.md`](../../product/surfaces.md) Landing.

## OG image (gotcha)

Do **not** point `openGraph.images` / `twitter.images` at a static `/og-image.png` — no such file exists in `public/`. The canonical social image is the dynamic App Router route [`apps/landing/app/opengraph-image.tsx`](../../../apps/landing/app/opengraph-image.tsx) (nodejs runtime so it can `readFile` the Design PNG, 1200×630). [`apps/landing/app/layout.tsx`](../../../apps/landing/app/layout.tsx) is correct as built: `metadataBase` is `https://frapp.live`, `openGraph.images` is `{ url: "/opengraph-image", width: 1200, height: 630, alt }`, and `twitter.images` is `["/opengraph-image"]` with a `summary_large_image` card, so previews resolve to the generated image at runtime.

## Performance

**The hero paints text, not an image.** The LCP element is the H1 block — there is no hero image, and no `next/image` call renders above the fold. That is the guard: nothing above the fold may become an image without re-deciding the LCP story, and no `priority` image should be introduced to a hero that has none.

The header lockup **is no longer an image request at all.** It was a 32×32 `next/image` of the Design tile; the token cutover ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)) replaced it with the crest inlined as one SVG path, which removes a request from a component that renders above the fold on every route, the legal pages included.

**The page now makes no image request whatsoever.** The two below-fold showcase mockups were the last `next/image` calls on it, and slice 2 deleted both the calls and the SVG files they pointed at. What replaced them is static JSX: the product frames are markup, and the crest is the same inline path at every size. So the guard is simpler than it was — `apps/landing/app/page.tsx` imports `next/image` never, not lazily, and `app/page.spec.ts` asserts it. Introducing one means re-deciding the LCP story first.

`apps/landing/public/brand/signet-emblem-B.png` stays on disk although nothing on the page reads it. It is a synced target of `signet-emblem-B-1024.png` in the `SYNCED` list ([`scripts/lib/brand-pixels.mjs`](../../../scripts/lib/brand-pixels.mjs)), which `check-brand-assets.mjs` walks; deleting it turns that gate red.

## Pricing truth

What ships: **two cards**. Free at **$0 per chapter**, no card, carrying the section's one button; Chapter Pro at **$149 per chapter / month, flat**, with a gold top rule, a "14-day trial" chip and, in place of a control, the line "Upgrade any time from Settings inside the app." Beside them the trial mechanics are stated in full: 14 days, card up front, first charge on day 15, once per chapter, opened at checkout **inside the app**. The same $149 is duplicated in the page's JSON-LD, which now carries an offer per tier.

[`spec/product/positioning.md`](../../product/positioning.md) is canonical for pricing. **All three divergences this section used to carry are closed.**

- **$149/chapter/month** is stated in `positioning.md` as the committed amount, so the card and the spec agree rather than the card being an unbacked number.
- The **14-day trial is implemented** (#913) — `subscription_data.trial_period_days` on the Checkout Session — so no CTA on this page promises a trial that charges on day zero.
- **The free tier renders, and the contradiction with the gating model is gone** ([#2367](https://github.com/pdcarlson/Frapp/issues/2367), decision D3). The page used to show one paid card backed by FAQ copy claiming "no feature gating", which is false under the canonical model, and "every new chapter starts with a 14-day trial", which is imprecise: a new chapter starts on the **free tier**, and the trial opens when it subscribes. The rebuilt section says exactly that. All four FAQ cards were deleted with it — the first carried the false claim; cancellation, trial and alumni went because the rebuilt section has no FAQ, not because each was false.

**This page still does not own pricing truth.** It sells the numbers and does not set them. Two rules survive the rebuild: the Pro list omits the AI features although `positioning.md` gates them behind that tier, because nothing ships that can answer a question yet ([`spec/behavior/ai.md`](../../behavior/ai.md)); and both cards resolve to `/sign-up` because no checkout deep link exists, which is why there is one button rather than two. Changing an amount means changing `positioning.md`, this page and the JSON-LD in the same commit. Do not reconcile any of it by editing this section alone.
