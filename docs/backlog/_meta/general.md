# General backlog (un-projected)

Everything not owned by a [project](../projects/). Grouped by area. The backlog is the source of
truth; `/triage` keeps these rows in sync with GitHub (repo wins).

> **Completeness caveat (verified seed):** the GitHub API reports **233 open issues** (verified via
> ascending search pagination, 100+100+33). All 233 are now enumerated here or accounted for as
> epics + their sub-issues (#426–#432 epics, #435–#467 sub-issues, which live in the epics/projects,
> not this file). The lowest-numbered open issues (#232–#279) that the cursor paginator previously
> skipped have been recovered and bucketed.

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

**Security / authz:** #234 chat-react authorize before service-role write · #243 bind chat reads to channel membership · #246 scope RBAC role update/delete to active chapter · #247 verify membership before notification-pref reads · #260 validate upload-confirm storage paths · #261 filter chat search by channel access · #269 write-gate announcements/read-only channels · #272 alumni role restrictions on study/check-in · #279 tighten chat action RLS to channel membership · #281 account deletion + PII anonymization · #293 validate service-hour proof uploads · #297 block member replies in announcements · #305 chapter-subscription lock on chat Edge Functions · #325 gate poll create/vote on channel access · #326 read-only channels before sends · #347 scope chat mutations to active channel · #350 restrict alumni chat posting · #386 enforce 25MB chat upload limit · #481 pseudonymize Sentry IDs · #483 Helmet headers · #511 restrict Swagger /docs in prod · #264 gate disabled modules across nav/commands/API writes

**CI / agent-infra (not under #401):** #248 make API lint read-only · #249 reliable check-types on fresh install · #255 API E2E tests in CI · #270 regenerate DB types after migrations · #320 package hook tests in CI · #321 API coverage threshold · #322 chat Edge Function CI coverage · #355 Next.js prod builds in CI · #356 migrations on fresh DB · #359 web Vitest in CI · #360 RLS coverage in migration safety · #366 ON CONFLICT/dedup branches · #380 chat-integrations unit tests · #389 slash-palette gating tests · #423 PGlite RLS smoke · #424 Edge Function deprecation spike · #475 supersede stale #322 · #509 mobile Vitest in CI · #529 run web Vitest unit tests in CI

**Mobile (Expo):** #253 spec-backed member flows (replace preview shell) · #266 sync notification prefs with server · #276 per-chapter accent/logo branding · #289 Expo SDK 56 · #299 alumni CTA · #312 prefs sync lockout (bug) · #329 Study Hours geofence · #330 gate onboarding tutorial · #338 chat-first landing tab · #341 global search entry · #343 Alumni Directory · #357 Backwork browse/upload · #367 Expo push token registration · #368 Google OAuth web+mobile · #371 notification grouping · #372 app-icon badge sync · #388 Realtime chat parity · #398 typing indicators · #407 Task Center · #408 Service Hours · #409 Notification Center · #500 chat_notification_preferences REST API · #501 network resilience banner · #505 theme preference sync

**Billing / dues (not under #429):** #370 past_due grace period · #378 member self-service dues invoices · #474 overdue invoice copy fix · #251 wire chapter_dues_config to API · #252 member invoice Stripe PaymentIntents · #262 persist Stripe webhook idempotency · #405 reconcile invite 402 w/ free-tier

**Other product / UX / bugs / deps:** #280 presidency transfer txn · #283 chat realtime polling fallback · #284 full-text search indexes · #290 swc bump · #291 Next.js advisories · #292 geist bump · #294/#314/#354 transactional point-award fixes · #335 @mention push · #369 chat Markdown · #390 @mention autocomplete · #392 inline attachments · #393 chat edit/delete · #397 tar/@infisical bump · #417 migrate chat hot path to NestJS · #469 in-channel search · #470 NestJS chat e2e tests · #232 scrape full chapter directory seed · #236 Chunk 02 review follow-ups · #238 email bulk invites onboarding · #254 Terms/Privacy acceptance at chapter creation · #257 branded PDF report export (signed URLs) · #258 push delivery metrics · #263 scheduled auto-absent/due-notification jobs · #265 dashboard chapter switcher · #267 free-to-paid activation funnel · #271 report window filtering in points report · #273 service-hours leaderboard + points rate · #274 chapter-document folder mgmt/title search · #275 link Terms/Privacy/FERPA in settings · #277 chapter-health artifacts in catch-up · #282 fix landing Log In + Get Started CTA routes (→ `/sign-in`, `/sign-up`) — ✅ shipped (closed via PR) · #285 New Member promotion at rollover · #286 presence-aware push suppression · #295 recurring event edit/cancel lifecycle · #296 per-channel mute w/ mention override · #298 web Add-to-Calendar export · #300 quantify directory miss rate · #301 slash-command discoverability research · #302 degraded health as readiness failures · #313 study heartbeat GPS accuracy · #315 channel read cursors → unread badges · #316 Message action to start DMs from directory · #317 role-targeted attendance in event editor · #318 rename event notes to meeting minutes · #319 reconcile landing pricing copy · #327 web Chat Admin (channel/category mgmt) · #328 deep-link notifications/search to message · #331 client-side Backwork PDF redaction · #332 sync spec/guides after Dashboard home removal · #333 Activity Feed aggregation API · #334 expand chapter audit log · #336 wire dashboard bulk-selection actions · #337 chat offline outbox flush instrumentation · #339 log global search zero-results · #340 Recruitment/Rush behavior spec · #342 chapter logo upload in web Settings · #344 Chapter Settings custom fields/workflows APIs · #345 nationals export/advisor digest research · #346 validate onboarding pathway templates · #348 Group DM leave + auto-archive · #349 orphan-president claim flow · #351 chapter vocabulary across nav/slash · #352 report member/event pickers (replace UUID) · #353 inactive-chapter retention cleanup research · #358 notify task managers on completion · #361 risk/standards module behavior spec · #373 member display names in chat headers · #374 Chunk 05 slash dispatch + integration cards · #375 points semester window to active period · #376 Backwork dept/professor admin UI · #377 semester archive picker for points/reports · #379 poll manual close by creator · #381 interactive map in Study Geofences admin · #382 anonymous poll mode research · #383 event role targeting in web Events · #384 web Events calendar month view · #385 chapter-configurable points anomaly threshold · #391 configurable pre-event reminders · #394 chapter-configurable anti-fraud limits · #395 weekly leaderboard digest spike · #396 web chat a11y audit · #399 configurable event reminder lead times · #402 chapter documents title search (web) · #403 export API latency/error-rate metrics · #404 notify channel on poll expiry · #406 event slash command + Event card · #410 chat push worker runbook · #418 Settings Notifications tab (chapter defaults) · #419 Online/Idle presence in web directory · #420 semester rollover confirm dialog (web) · #422 default invite role config in Settings · #471 update slash-command spec for NestJS auth · #472 instrument Realtime broadcast failure rate · #473 RRULE in recurring event ICS export · #479 treasurer AI usage allowance dashboard · #480 pseudonymous analytics pipeline (PostHog) · #482 task due-date/overdue reminders · #485 Chunk 06: module trial tracking · #486 Chunk 06: audit core chapter profile edits · #489 Discord-style reply-with-quote · #490 Chunk 07 Settings customization tabs · #491 Chunk 12 landing refresh (chat-first) · #492 dismissible ops-setup nudges on chat home · #494 Rush ops integration slash (Chunk 10e) · #495 instrument Settings Modules enablement · #502 chapter analytics opt-out in Settings · #503 web Service Hours signed proof upload · #508 chapter directory request review workflow · #510 Chunk 08 Settings Beta/Audit tabs · #512 web NetworkProvider OFFLINE after health fails · #514 purge chat attachments on message delete · #515 group web chat sidebar by category · #519 add chunk-01…12 labels + backfill
