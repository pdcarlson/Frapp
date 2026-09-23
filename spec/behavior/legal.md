# Legal (Terms of Service, Privacy Policy, FERPA)

## Terms of Service

- Displayed on the landing site (frapp.live/terms) and linked from the app footer.
- **No one is added to a chapter until they accept them** (#2302), and a member from before that is asked before anything else in the app. One checkbox, "I'm 18 or older and agree to the Terms of Service and Privacy Policy." (`LEGAL_ACCEPTANCE_LABEL` in `@repo/validation`), appears in three places:
  - **Chapter creation**, where the officer must tick it before **Create chapter**. There is no payment step in the wizard, whose steps are `find → archetype → identity → invite`. This one tick is the officer's acceptance for the chapter and for themselves.
  - **Joining by invite**, where a user who hasn't accepted the current version must tick it before **Join chapter**. A user who already has isn't asked again.
  - **The Terms prompt**, which asks a member who hasn't accepted the current version before they reach anything else, on mobile and web. A version change asks every member once.
- Covers:
  - **Eligibility.** Users must be 18 or older, and accepting confirms it. Owner decision 2026-09-23 (#2261): 18 is the one authoritative age. The iOS age rating stays 13+, because it rates content, not who may sign up ([`apps/mobile/store/README.md`](../../apps/mobile/store/README.md) § Age rating).
  - **Acceptable use**, including zero tolerance for objectionable content and abusive users, which App Review Guideline 1.2 expects. Members can report and block in the app, and chapter officers act on reports ([`chat/README.md`](chat/README.md#report-and-block) § Report and block).
  - **Data ownership:** chapters own their data, and Frapp has a license to host and process it.
  - **Limitation of liability, subscription terms and auto-renewal, and account termination.**
  - **The inactive-chapter reservation** (#1562): a chapter whose subscription has been canceled for more than two years, and in which no member has signed in during that time, may be deleted after a 30-day email warning to its last known admin. [`data-retention.md` § Inactive Chapter Cleanup](data-retention.md#inactive-chapter-cleanup) owns what that does and doesn't mean in practice.

## Privacy Policy

- Displayed on the landing site (frapp.live/privacy) and linked from the app footer.
- Covers: what data is collected (account info, location data for study hours, uploaded files, chat messages), how data is used (to provide the service, not sold to third parties), third-party services (the page's "3. Service Providers" section, in [`apps/landing/app/privacy/page.tsx`](../../apps/landing/app/privacy/page.tsx), is the list — do not restate it here; it named only three providers when the page named five, and missed Resend, #2305), data retention (see [`data-retention.md`](data-retention.md)), user rights (deletion on request — the shipped page grants no access or correction right, and does not mention cookies or the per-chapter analytics that `chapters.analytics_opt_out` gates).

## FERPA Notice

- A specific callout (frapp.live/ferpa) that Backwork materials are shared voluntarily by members.
- Signet is not an educational institution and does not access student education records.
- Members are responsible for ensuring they have the right to share uploaded materials.
- Members are told to remove identifying details themselves before uploading. The page must not point at a redaction tool: the one in [`backwork.md` § PDF Redaction](backwork.md#pdf-redaction-phase-v2) is v2 and unbuilt (nothing rasterizes, and web writes `is_redacted: false`). It used to say "Signet encourages use of redaction workflows", which implied one (#2262). When redaction ships, the page may name it.

## In-App Placement

- All three legal pages are linked from:
  - The landing site footer.
  - The web app and mobile app settings/about screen.
- The Terms and Privacy Policy are also linked from the acceptance checkbox, wherever it appears (above). The web chapter wizard adds the FERPA notice beside it, because Backwork is on the web dashboard. Mobile doesn't, because the app has no Backwork (#2258).

## Acceptance record

There are two records, and they make different claims.

- **Per user** (#2302). `users.legal_accepted_at` and `users.legal_policy_version` record what this user agreed to for themselves. `LegalAcceptanceService` (apps/api) stamps both from the authenticated session and the server clock, never from the client. A request's `accept_terms_privacy: true` (`@Equals(true)` on the DTO) is only the user's claim that they ticked the box, and only a JSON `true` makes it: the field is validated as sent (`RawValue`), because the global pipe's implicit conversion would otherwise turn the string `"false"` into `true`. Every route that creates a membership calls `requireOrAccept` before it exists: invite redemption and chapter onboarding with their checkbox, and `POST /v1/chapters`, which has none and so needs an acceptance already on record. So no membership is created without one. A refused request is a 403 whose message is `LEGAL_ACCEPTANCE_REQUIRED_MESSAGE` (`@repo/validation`), and an invite it refused stays usable. The API also throws the code `legal.acceptance_required`, but `AllExceptionsFilter` sends no `code` to clients (#1020), so clients recognise the message (`isTermsRequiredError` in `@repo/hooks`). Accepting a version already accepted keeps the first timestamp.
- **Per chapter.** `chapters.legal_accepted_at`, `legal_policy_version` and `legal_accepted_by` record the founding officer agreeing on the chapter's behalf. `ChapterOnboardingService` stamps them at creation.

**The server decides whether a user must accept.** A user's acceptance is current when their `legal_policy_version` equals the API's `LEGAL_POLICY_VERSION`. Clients read `GET /v1/users/me/legal-acceptance` (`required`) and record it with `POST /v1/users/me/legal-acceptance`; they never compare versions themselves. A store binary can't be updated over the air, so one compiled with an older constant would otherwise disagree with the server for as long as it's installed. Bump `LEGAL_POLICY_VERSION` whenever the Terms or Privacy Policy change materially, to the `YYYY-MM` of the Terms page's "Last updated". Everyone is asked again once.

**Where a member is asked, and what it can't block.** On mobile, `resolveAuthGate` returns `terms` for a member whose acceptance isn't current, ahead of first-run ([`../ui/mobile/navigation.md`](../ui/mobile/navigation.md)). On web, `TermsPromptGate` covers every dashboard route. Both fail open when their first read fails, so an outage of the endpoint can't lock members out, but a later refetch that fails keeps the answer already cached, so it can't let a member past the prompt either. The join screens' rule for when to show the checkbox is `useJoinTermsCheckbox`, shared by both apps. Writes by a member who joined before this shipped are not refused server-side while they haven't accepted. The prompt is the only thing in their way, and a client that skipped it could keep posting. That's a deliberate limit: refusing every chapter write on it would need a user read in `ChapterGuard` on every request.
