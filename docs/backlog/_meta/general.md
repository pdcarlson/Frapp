# General backlog (un-projected)

Everything not owned by a [project](../projects/). Grouped by area. The backlog is the source of
truth; `/triage` keeps these rows in sync with GitHub (repo wins).

> **Completeness caveat (verified seed):** the GitHub API reports **235 open issues**, but the
> paginator reliably enumerated only **200** (#280–#519). The ~35 lowest-numbered open issues were
> skipped by the cursor (confirmed-open samples: #232, #234, #236). Those are **not yet listed** here.
> <!-- TODO: seed remaining ~35 low-number open issues (< #280) once the paginator is worked around -->

## Feature epics (not yet promoted to their own project)

These are scoped v1 feature epics. Promote any of them to `projects/<slug>.md` when active work begins.

### AI features (v1) — [#427](https://github.com/pdcarlson/Frapp/issues/427)

Q&A + summarization over authoritative sources only (chat-as-corpus deferred to v2+). Spec: [`spec/behavior/ai.md`](../../../spec/behavior/ai.md).
- #448 Corpus ingestion · #449 Meeting summarization (type-aware) · #450 Q&A surface · #451 Citation UI · #452 Evals harness
- Standalone dups to reconcile: #477 (meetings transcription + AI summaries), #478 (AI Q&A over corpus)

### Vault & security — [#428](https://github.com/pdcarlson/Frapp/issues/428)

Encrypted private storage with HSM break-glass + quarterly transparency. Spec: [`spec/behavior/vault.md`](../../../spec/behavior/vault.md).
- #453 Storage layer · #454 HSM key provisioning · #455 Break-glass workflow · #456 Quarterly transparency report
- Standalone dup: #476 (Vault encrypted storage)

### Save & permanence (Pin + Bookmark) — [#430](https://github.com/pdcarlson/Frapp/issues/430)

Chapter-elevated Pin + personal Bookmark; no sender-extend. Spec: [`spec/behavior/chat/`](../../../spec/behavior/chat/).
- #461 Pin model · #462 Bookmark model · #463 Ephemerality clock
- Standalone dups: #488 (chat bookmarks), #421 (web pin/unpin)

### Spec maintenance — [#432](https://github.com/pdcarlson/Frapp/issues/432)

- #467 Split `spec/ui/web-dashboard/README.md` into folder layout — **subsumed by the current restructure** (close on merge)

## Un-projected issues by area

> Verified subset (representative + complete-where-enumerated). `/triage` should flesh these out.

**Security / authz:** #281 account deletion + PII anonymization · #293 validate service-hour proof uploads · #305 chapter-subscription lock on chat Edge Functions · #325 gate poll create/vote on channel access · #326 read-only channels before sends · #347 scope chat mutations to active channel · #481 pseudonymize Sentry IDs · #483 Helmet headers · #511 restrict Swagger /docs in prod

**CI / agent-infra (not under #401):** #320 package hook tests in CI · #321 API coverage threshold · #322 chat Edge Function CI coverage · #355 Next.js prod builds in CI · #356 migrations on fresh DB · #359 web Vitest in CI · #360 RLS coverage in migration safety · #366 ON CONFLICT/dedup branches · #380 chat-integrations unit tests · #389 slash-palette gating tests · #423 PGlite RLS smoke · #424 Edge Function deprecation spike · #475 supersede stale #322 · #509 mobile Vitest in CI

**Mobile (Expo):** #289 Expo SDK 56 · #299 alumni CTA · #312 prefs sync lockout (bug) · #329 Study Hours geofence · #330 gate onboarding tutorial · #338 chat-first landing tab · #341 global search entry · #343 Alumni Directory · #357 Backwork browse/upload · #367 Expo push token registration · #368 Google OAuth web+mobile · #371 notification grouping · #372 app-icon badge sync · #388 Realtime chat parity · #398 typing indicators · #407 Task Center · #408 Service Hours · #409 Notification Center · #500 chat_notification_preferences REST API · #501 network resilience banner · #505 theme preference sync

**Billing / dues (not under #429):** #370 past_due grace period · #378 member self-service dues invoices · #474 overdue invoice copy fix

**Other product / UX / bugs / deps:** #280 presidency transfer txn · #283 chat realtime polling fallback · #284 full-text search indexes · #290 swc bump · #291 Next.js advisories · #292 geist bump · #294/#314/#354 transactional point-award fixes · #335 @mention push · #369 chat Markdown · #390 @mention autocomplete · #392 inline attachments · #393 chat edit/delete · #397 tar/@infisical bump · #417 migrate chat hot path to NestJS · #469 in-channel search · #470 NestJS chat e2e tests

<!-- TODO: complete enumeration of the remaining ~80 un-projected "other" issues + the ~35 low-number gap via /triage -->
