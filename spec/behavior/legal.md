# Legal (Terms of Service, Privacy Policy, FERPA)

## Terms of Service

- Displayed on the landing site (frapp.live/terms) and linked from the app footer.
- Accepted during chapter creation (onboarding step): the admin must check a "I agree to the Terms of Service and Privacy Policy" checkbox before proceeding to payment.
- Covers: acceptable use policy, data ownership (chapters own their data; Frapp has a license to host and process it), limitation of liability, subscription terms and auto-renewal, account termination conditions.

## Privacy Policy

- Displayed on the landing site (frapp.live/privacy) and linked from the app footer.
- Covers: what data is collected (account info, location data for study hours, uploaded files, chat messages), how data is used (to provide the service, not sold to third parties), third-party services (Supabase, Stripe, Expo Push), data retention (see [`data-retention.md`](data-retention.md)), user rights (access, correction, deletion on request), cookies and analytics.

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
