### ADR-25: The product is named Frapp; "Signet" stays the design system's internal name until after the beta (2026-09-23)

**Decision:** The owner decided on 2026-09-23, on [#1829](https://github.com/pdcarlson/Frapp/issues/1829), after the USPTO searches recorded on [#1901](https://github.com/pdcarlson/Frapp/issues/1901).

- **The product's name is Frapp.** It is the name everywhere a user can see one: the app, the web dashboard, email, push and OS permission prompts, the landing and legal pages, and the store listing. "Signet" is retired as a product name.
- **Store identity.**
  - The App Store listing name is `Frapp: Chapter Hub`. Plain "Frapp" is taken, as plain "Signet" was, which is why the old listing was `Signet: Chapter Hub`.
  - The subtitle stays "Your chapter, in one place".
  - The home-screen name (`expo.name` in `apps/mobile/app.json`) becomes `Frapp`.
- **The permanent identifiers stay frapp, and the deferred frapp → signet identifier rename is cancelled.** They are:
  - the bundle id `live.frapp.mobile`, which App Store Connect record `6812025642` fixes once a build is uploaded;
  - `frapp.live` and its subdomains, which the beta binary bakes in as `api.frapp.live`;
  - the `frapp://` scheme, the Expo slug `frapp` and the Sentry org `frapp-live`;
  - the repo and `@repo/*` package names.
- **"Signet" remains the design system's internal name until after the beta.** That covers the `--signet-*` tokens and identifiers, file names such as `signet-emblem-B.svg`, the `signet-cutover` skill, and the design-system vocabulary in `spec/ui/`. A second series renames them after the beta ships. Until then, "Signet" in a spec or skill means the design system, and **nothing a user sees may say Signet**.
- **The mark is unchanged.** Emblem B is an abstract crest with no letterform, so it works under either name.
- **The rename runs as an ordered series.** Every step lands before the first `eas build --profile production` ([#2478](https://github.com/pdcarlson/Frapp/issues/2478) § C). Steps 2 to 5 each break down into up to three parts:
  - the code the step changes;
  - the specs and docs that pin those strings, which change in the same PR;
  - what the owner does by hand on the day it merges, whether in a console or as a decision.

  1. **This ADR and the naming rule.** The naming rule in [`spec/ui/brand-identity.md`](../../ui/brand-identity.md) § 1 is its one canonical statement, and the specs and the skill that restated it now link to it.
  2. **The mobile binary.** This step is first because it is the beta's critical path, and each binary stays as shipped until its user updates.
     - *Code:*
       - `expo.name`, the three iOS permission strings, and the in-app copy. That includes the `Settings → Frapp → …` recovery paths, which must match `expo.name` in the same build.
       - The local study-pause notification, the Stripe PaymentSheet merchant fallback, the calendar-export filename and PRODID, and the listing paste in `apps/mobile/store/README.md`.
     - *Specs:*
       - `spec/behavior/study-sessions.md` (the study-pause notification).
       - `spec/ui/design-system/writing.md` (the study and payment copy). Its § 7 Sign in title is shared by mobile s01 and web `/sign-in`, so this step splits that row per surface, and step 4 moves the web half.
       - `spec/ui/design-system/components.md` and `spec/ui/mobile/patterns.md` (the "Ask Signet" sheet header).
       - `spec/ui/mobile/screens.md` (the s01 wordmark).
  3. **Server.**
     - *Code:*
       - API user-visible text: error messages other than the Discord ones (those go in step 4), the PDF report footer and producer, report filenames and the ICS PRODID.
       - The invite email's From name, subject and body.
       - The OpenAPI title and descriptions, with the regenerated contract.
       - A new forward migration renaming the system actor `Signet System` → `Frapp System`.
       - The conformance naming checks in `scripts/ci/staging-conformance.mjs`, which `production-auth-conformance.mjs` reuses:
         - the constants `AUTH_SMTP_SENDER_NAME` and `AUTH_MAGIC_LINK_SUBJECT`;
         - the `auth-smtp` check labels that say "the sender is Signet";
         - the `leftoverFrappMailerSubjectKeys` guard. It fails any `mailer_subjects_*` containing "Frapp" before the subject is compared, so it inverts to catch leftover Signet, with its lock `signet-mailer-subjects.test.mjs`.

         Flipping only the constants leaves staging conformance red for good once the subjects say Frapp.
       - The App Review demo seed's placeholder PDF text in `scripts/demo/seed-demo.mjs`. If the production seed (#2309) runs before this step, re-run its `storage` command after it.
     - *Specs and docs:*
       - the PDF footer in `spec/behavior/reports.md` and `spec/product/modules.md`;
       - a new dated entry for the system actor in `DB_PROMOTION_RUNBOOK.md` and `DB_ROLLBACK_PLAYBOOK.md`, which record the 2026-09-09 `Signet System` rename;
       - every email string in `docs/internal/ops/deployment/supabase.md`: the SMTP table, the From addresses, the conformance description, and the Magic Link template's subject and body;
       - the conformance assertions restated in `AGENT_INFRA.md` (the staging and production conformance rows) and `ALERT_ROUTING.md` (the production Auth row);
       - the `RESEND_FROM_EMAIL` default and staging value in `ENV_REFERENCE.md`.
     - *Consoles (owner):*
       - on `frapp-staging` and `frapp-prod`, in Supabase Auth: the SMTP sender name, the mailer subjects, and the **Magic Link template body**, whose heading and link both read "Sign in to Signet". Conformance checks the subject and the body's link shape (TokenHash and `type=magiclink`, no ConfirmationURL), but never the body's brand text, so a missed heading stays silent. Keep the link shape when retyping it.
       - `RESEND_FROM_EMAIL` in Infisical `staging`, documented as `Signet <invites@mail.staging.frapp.live>`, and in `prod` if it is set there.
  4. **Web dashboard and third-party sign-in and billing.**
     - *Code:*
       - Tab titles, the auth headings, onboarding, settings and roles copy, the invite share text and the CSV and ICS filenames, plus the `packages/validation` and `packages/hooks` strings the dashboard renders.
       - Everything that names the Discord application or bot, on both sides: the web import copy, and the API's Discord error messages (`discord-import.service.ts`, `discord-bot-gateway.service.ts`, `discord-api-message.ts`).
     - *Specs and docs:*
       - the web half of `writing.md` § 7's Sign in title;
       - the tab-title template and title-lock description in `spec/ui/web-greenfield/deletion-checklist.md` § Copy, with a dated note;
       - the onboarding welcome slide in `spec/ui/design-system/iconography.md`;
       - the Discord application and bot names and the consent screen in `docs/internal/ops/deployment/integrations.md`, `ENV_REFERENCE.md` (`DISCORD_BOT_TOKEN`), `DB_PROMOTION_RUNBOOK.md` and `DB_ROLLBACK_PLAYBOOK.md`;
       - the Services ID Description in `supabase.md` § Auth OAuth providers;
       - the Stripe account name in `ENV_REFERENCE.md`.
     - *Consoles (owner),* so no recovery instruction or consent screen names something the member can't find:
       - rename the Discord application and bot in the Developer Portal;
       - set the Sign in with Apple Services ID `live.frapp.mobile.web` Description (Apple Developer → Identifiers → Services IDs) to Frapp, because it shows on the web consent sheet;
       - if they say Signet, change the Stripe account's public business name and statement descriptor (Settings → Business → Public details), which checkout, the billing portal and receipts show;
       - and the app name on the Google Cloud OAuth consent screen. No doc records that one, so check it.
  5. **Landing and legal.**
     - *Code:*
       - Metadata, the generated OG image, JSON-LD, the hero and footer copy, and the lockup wordmark.
       - The Terms, Privacy, FERPA and Support pages, with their `lastUpdated` dates.
     - *Specs:*
       - `spec/ui/landing/README.md` (the header lockup word and the OG card);
       - `spec/ui/assets.md` and `packages/brand-assets/README.md` (the lockup wordmark and the landing header);
       - the Terms and FERPA summaries in `spec/behavior/legal.md`.
     - *Owner:*
       - decide whether a name-only change bumps `LEGAL_POLICY_VERSION`;
       - after deploy, re-scrape the social previews and request a recrawl.
  6. **Store console (owner).** After step 2 is in a build, update the App Store Connect description and review notes, then capture and upload the screenshots ([#2454](https://github.com/pdcarlson/Frapp/issues/2454)).

  **Every step updates, in the same PR, every test and gate that pins a string it changes.** That means:
  - the `scripts/ci/__tests__/signet-*.test.mjs` locks, which were written to keep "Frapp" out of exactly these strings, and whose headers still cite the cancelled deferred rename;
  - component and unit specs such as `onboarding-tutorial.spec.tsx` ("says Signet, not Frapp");
  - `scripts/check-pglite-migrations.mjs`;
  - the conformance tests.

  An unflipped check fails CI. A lock that spans surfaces (calendar PRODID, export filenames, the auth wordmark and the ops-nudge copy) is split per surface by the first step that touches it.

  **This is the one list of specs, docs and consoles each step moves.** `spec/ui/brand-identity.md` § 1 links here rather than keeping its own copy.
  - It was found by reading every Markdown line that says Signet: `spec/` at `ee9dd538`, and `docs/`, the root and package READMEs and `.claude/` at this ADR's branch. The read left out the reference boards (covered by `spec/ui/README.md` precedence rule 1), ADRs, and uses of the name that mean the design system or the product in general prose.
  - A list like this is a starting point, not a proof. Specs and docs change before each step lands, so re-run `git grep -n Signet -- '*.md'` when a step starts, and treat every hit that describes a string the step changes as part of that step, whether it is new or not. Code, tests and scripts are found by the step's own grep over its surface, as the inventory behind this ADR was.

**Rationale:**

- **SIGNET collides on the federal register where the product lives.** The owner searched tmsearch.uspto.gov on 2026-09-23 (#1901).
  - SN 99945230 is SIGNET for downloadable mobile-app software and SaaS, classes 9 and 42, pending. It was filed 2026-07-16. That is four weeks before "Signet" first appears anywhere in this repo's history (commit `977527f`, 2026-08-13, per `git log -S Signet ee9dd538` over all 1,185 commits of `main` at that commit), and six weeks before production went live on 2026-08-30. Once it registers, it would likely block a SIGNET application from us in those classes, and its owner's priority dates from the filing.
  - SN 98639778 is a registered SIGNET mark for class 42 software.
  - RN 4186843 is SIGNET for Phi Sigma Kappa's magazine for fraternity members. That is the product's own audience.
- **FRAPP is clear on the register in the same classes.** The same search found no live mark containing FRAPP in classes 9 or 42. The only live near-match is FRAPP-WRAP (SN 90580395, class 21, drink holders).
- **One name instead of two.** Under Signet, users would always see both names: the app said Signet while the URLs, the `mail.frapp.live` sender and the `frapp://` links said frapp. The bundle id can never change, so that split could only ever shrink, never close.
- **The rename is cheapest now.** An inventory at `ee9dd538` found about 130 user-visible strings: roughly 30 in the mobile binary, 73 across web and landing, and 28 in the API and email. About 47 tests pin them. There is no production binary yet, and production has 2 users. After launch, every step would cost a new binary per install and a listing change.

**Alternatives rejected:**

- *Keep Signet, with the frapp identifiers made permanent.* The agent recommended this before the search, weighing a live same-audience app named Frapp (below) against Signet's adjacent collisions. The search reversed it: SN 99945230 is the same word for the same kind of goods, filed first.
- *Ask a lawyer before deciding.* This would hold up everything store-facing, because the listing, the binary and the screenshots all wait on the name. The one question that does need counsel (below) doesn't change which name the register favours.
- *Rename the internals too, before the beta.* At `ee9dd538`, 404 files mention "signet" in any case (`git grep -l -i signet`). That count includes 36 file names, plus 611 token and identifier lines in 126 files under `apps/` and `packages/`, counted with `git grep -E -- "--signet-|\bsignet[A-Z_]|\bSIGNET_|Signet[A-Z][a-z]"` outside Markdown. Renaming them before the beta would churn work already in flight with no user-visible gain, so they move after it instead.
- *Keep "Signet" permanently as the design system's name*, the way Shopify has Polaris or GitHub has Primer. The agent recommended this; the owner chose one name for the codebase, after the beta.

**Consequences:**

- **Open risk: prior use of "Frapp".** Two existing App Store apps use the name. Neither shows up on the federal register, but each holds unregistered rights where it is used:
  - "Frapp: Discover, Connect, Grow" (id `6759274038`), a live campus events app for student organisations, with event group chats, ticketing and QR check-in. It is the closest to this product's audience and function.
  - The listing named exactly "Frapp" (id `1540087188`). Its category and owner weren't confirmed, because the sandbox can't open App Store pages. Web search also shows an older student internships app called Frapp.

  Who used "Frapp" first is unresolved. This repo carries frapp.live branding from 2026-02-16 (commit `2938d00f`) and a landing app from 2026-02-26, but it doesn't record whether or when either was public. Those questions, and whether to file a federal FRAPP application in classes 9 and 42, belong to the owner and counsel.
- **Two senses of "Frapp" until the internals series.** In the specs and skills, "legacy Frapp" still means the retired pre-Signet visuals and code (bone, bronze, Geist, `#2563EB`). It never means the product name. A cutover deletes legacy Frapp visuals, never Frapp copy.
- **Brand extras.** [`brand-identity.md` § 2](../../ui/brand-identity.md#2-the-mark) records what the rename means for the extras beyond the mark, and the CI lock on that section is revised with the internals series. Nothing is commissioned.
- **Issues.**
  - #1901 is answered: both searches are dated, and the go/no-go is recorded here.
  - #1829 closes when the listing and `app.json` say Frapp (step 2).
  - #1843 (`getsignet.live`) no longer has a purpose.
  - #1256 (the headline) doesn't depend on the name and stays deferred.

**Trigger to revisit:** Counsel judges the prior-use risk from either existing Frapp app to be material, or a FRAPP application is refused.
