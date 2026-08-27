## Track A — You, today (config/secrets, ~1 hr total)
Nothing ships without these. Do in this order:
1. #919 — repair the foreign prod migration row, then push pending migrations
2. #805 — enable prod auth hook (only after #919 lands)
3. #1033 — set `EVENT_CHECK_IN_TOKEN_SECRET` (unblocks QR check-in)
4. #806 / #1064 — Stripe prod web vars + mobile publishable key
5. #938 — EAS project setup (unblocks mobile builds)
6. ~~#1166 — re-run branch protection config~~ DONE Aug 24 (verified live: 19 required checks on main, 20 on production)
7. #1173 / #862 — PostHog + Sentry keys (you're blind without these at launch)

## Track B — CONFIRMED DONE Aug 23, not a next step
#920 web-dashboard reskin actually shipped in full (verified live, not from stale notes). #1218-#1223 mobile-binary-400 risk: Paul decided this can wait, not a beta blocker. Remaining loose end: #1190/#1193 still need a design call.

## Track C — BUILT, live test deferred by choice
Discord migration tool shipped across 3 phases (schema, importer, single-bot OAuth path) plus a staging CI/migration hardening pass. Both import paths are deployed on staging but not yet run end-to-end against a real Discord server — genuinely can't be agent-verified (needs a human clicking Discord's real consent screen + a staging test account that doesn't exist yet, #893). Paul is proceeding on the assumption it works and will troubleshoot live later. Tracked in #1266. One thing worth a personal double-check before that: the OAuth redirect URI must be the API origin, not the app origin — a mistake that's happened before.

## Quick decisions (2 min each, unblocks filed issues)
- #1133 — mobile tutorial replay: keep or cut for beta?
- #1135 — notification feed scope
- meetings.md — quarantine (recommended) vs. commit to roadmap

## Deferred past beta (don't touch)
Two-host AI podcast, SMS notifications, recruitment/rush module, multi-chapter templates, formal trademark filing.

## Definition of beta-ready
Chat, events, points, study hours, dues all functional on Signet skin + Discord import run once on your own chapter's data + Sentry catching real errors.