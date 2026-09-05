# Legal (Terms of Service, Privacy Policy, FERPA)

## Terms of Service

- Displayed on the landing site (frapp.live/terms) and linked from the app footer.
- Accepted during chapter creation (onboarding step): the admin must check a "I agree to the Terms of Service and Privacy Policy" checkbox before the **Create chapter** submit — there is no payment step in the wizard, whose steps are `find → archetype → identity → invite`.
- Covers: acceptable use policy, data ownership (chapters own their data; Frapp has a license to host and process it), limitation of liability, subscription terms and auto-renewal, account termination conditions.
- **Known gap:** [`data-retention.md` § Inactive Chapter Cleanup](data-retention.md#inactive-chapter-cleanup) reserves the right to delete data from chapters inactive for more than 2 years, and now flags itself that the Terms do not yet carry it. The shipped terms page carries no such clause — no inactivity reservation, no 2-year window, no 30-day warning. Nothing implements the cleanup, so there is no live exposure, but the two must be reconciled before anything does (#1562). Do not describe the ToS as covering inactivity deletion until the page itself does.

## Privacy Policy

- Displayed on the landing site (frapp.live/privacy) and linked from the app footer.
- Covers: what data is collected (account info, location data for study hours, uploaded files, chat messages), how data is used (to provide the service, not sold to third parties), third-party services (Supabase, Stripe, Expo Push), data retention (see [`data-retention.md`](data-retention.md)), user rights (deletion on request — the shipped page grants no access or correction right, and does not mention cookies or the per-chapter analytics that `chapters.analytics_opt_out` gates).

## FERPA Notice

- A specific callout (frapp.live/ferpa) that Backwork materials are shared voluntarily by members.
- Frapp is not an educational institution and does not access student education records.
- Members are responsible for ensuring they have the right to share uploaded materials.
- Members are encouraged to use the redaction feature to remove personal information before uploading.

## In-App Placement

- All three legal pages are linked from:
  - The landing site footer.
  - The web app and mobile app settings/about screen.
  - The chapter creation onboarding flow (ToS and Privacy Policy acceptance).

## Acceptance record (implementation)

Acceptance captured during chapter creation is persisted on the `chapters` row —
`legal_accepted_at` (timestamp), `legal_policy_version` (the `LEGAL_POLICY_VERSION`
constant from `@repo/validation`), and `legal_accepted_by` (the accepting admin) —
stamped server-side by `ChapterOnboardingService` from the authenticated session,
never from the client payload. The onboarding wizard blocks "Create chapter" until
the required checkbox is ticked, and the API enforces the same rule server-side
(`accept_terms_privacy` must be `true`).
