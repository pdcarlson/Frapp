export * from "./act";
export * from "./ai-copy";
// Report this (#4315): the reasons, the request, and the words about what a
// report keeps.
export * from "./ai-report";
// Suggested tasks (#4313): the words web and mobile share.
export * from "./ai-suggestion-copy";
export * from "./alumni-permission";
// ── Analytics payload hygiene (issue #464) ───────────────────────────────────
export {
  ANALYTICS_APPS,
  type AnalyticsApp,
  type AnalyticsEvent,
  type AnalyticsProperties,
  assertContentFreeProperties,
  CLIENT_ANALYTICS_APPS,
  type ClientAnalyticsApp,
  ContentFreePropertyError,
  FORBIDDEN_ANALYTICS_PROPERTY_KEYS,
  RESERVED_ANALYTICS_PROPERTY_KEYS_TEXT,
} from "./analytics";
// Client-side analytics opt-out. Fourth shared client gate alongside `can`,
// `isModuleEnabled`, and `subscriptionWriteState`.
export * from "./analytics-opt-out";
export * from "./api-error-codes";
// Ask Frapp (#450): the request, the versioned stream format, and its copy.
export * from "./ask";
export * from "./backwork";
// ── Backwork course names and nicknames (#3848) ──
export * from "./backwork-courses";
export * from "./beta-off-modules";
export * from "./channel-access-lists";
export * from "./chapter-branding";
export * from "./chapter-config";
export * from "./chapter-goals";
// ── Chapter mark (logo → short name → Greek letters → initials) ─────────────
export * from "./chapter-mark";
export * from "./chat-backgrounds";
// Catch me up (#3946): a channel's new messages or a thread, summarized.
export * from "./chat-catch-up";
export * from "./chat-message";
export * from "./chat-message-flags";
export * from "./chat-notification-defaults";
export * from "./chat-sidebar";
export * from "./check-in-window";
export * from "./check-in-zone-copy";
// Connection state machine (`spec/ui/resilience/connection-state.md`). Shared so web and
// mobile cannot disagree about ONLINE / DEGRADED / OFFLINE. Each app owns
// the effects that feed it; this package owns the rule.
export * from "./connection-state";
// Discord export (DCE) preamble parsing, shared between the import wizard
// (apps/web) and the import worker (apps/api). See ./discord-export for why
// this used to be two copies of the same scanner.
export * from "./discord-export";
// Which Discord imports may be cleared off the list, shared so the web never
// offers a Clear the API refuses. See ./discord-import.
export * from "./discord-import";
export * from "./error-copy";
// Event attendance by role: who an event is for, read the same way by the
// API's read gate, check-in, auto-absent and pushes, and by both editors.
export * from "./event-attendance";
// Editing or deleting an existing event: what a save sends, and whether to
// ask "this event or all upcoming" first. Web and the phone share it (#3667).
export * from "./event-edit";
// Absence excuses for required events: the late window and reason limit the
// API enforces and the apps read (#3735).
export * from "./event-excuse";
// The chapter's Everyone role, the Member role renamed and hidden (#4191).
export {
  EVERYONE_MEMBER_LIST_HEADING,
  EVERYONE_MENTION_NAME,
  EVERYONE_ROLE_NAME,
  EVERYONE_ROLE_SYSTEM_KEY,
  HERE_MENTION_NAME,
  type HereMentionSource,
  isEveryoneRole,
  mentionRoleHint,
  reservedMentionName,
  rolesAfterSave,
  withHereMention,
} from "./everyone-role";
// ── Field limits ─────────────────────────────────────────────────────────────
// The bounds a client or a schema here reads. The API-only ones are in
// `apps/api/src/domain/constants/field-limits.ts` (#3268).
export * from "./field-limits";
export * from "./invite-emails";
// Invite paste/URL extraction and https minting, shared so web `/join`,
// mobile s02, the API email helper, and the landing `/join` redirect cannot
// drift on what a copied join link is or whether a public http: origin is
// allowed. See ./invite-token.
export * from "./invite-token";
export * from "./last-year";
export * from "./legal";
// The words and date labels the minutes screens share on web and mobile.
export * from "./meeting-copy";
// Minutes drafted from notes (#4312): the model's output schema, the draft's
// states and the words each failure shows.
export * from "./meeting-draft";
export * from "./meeting-recording";
// ── Meeting minutes (#4312) ──────────────────────────────────────────────────
export * from "./meetings";
// ── `@`-mention resolution (C1 of #937) ──────────────────────────────────────
// Shared because the API's authoritative pass and any client-side preview must
// not disagree about who `@jane` is — but only the API's result is persisted,
// since mentions override a per-channel mute in the push rules and a
// client-supplied list would be forgeable.
export * from "./mentions";
export * from "./message-text";
export * from "./module-enablement";
export * from "./module-refusal";
// The native app's identifiers, store listings and invite hand-off (#4002),
// shared so web's invite hand-off (`AppHandoff`), the API's update-screen
// default and the app-link files name one app. See ./native-app.
export * from "./native-app";
// ── Notification categories (issue #564; mobile half shipped in C4 of #937) ──
// Shared because each `key` is written verbatim into
// `notification_preferences.category` and nothing validates it — the column is
// unconstrained `text` and the DTO only length-limits the string — so a
// per-surface copy drifts into preference rows the server never reads. Both
// surfaces now draw from here: mobile's s16 grid and web's Profile card.
// `rowsToNotificationCategoryState` is shared for the same reason the catalog
// is — it is the fold from server rows onto those keys, and a second copy is
// how two surfaces come to disagree about what a member's switches say.
export * from "./notification-categories";
// ── Ops-setup nudges (issue #492) ────────────────────────────────────────────
// Shared for the same reason as the categories above: each `key` is written
// verbatim into `members.dismissed_ops_nudges`, the column is an unconstrained
// `text[]`, and `DismissOpsNudgeDto` validates against `MEMBER_DISMISSAL_KEYS`
// (these keys plus the setup checklist's) — so a
// per-surface copy would drift into dismissal entries that suppress nothing.
// `selectOpsNudge` carries the spec's priority order, which is behavior rather
// than presentation, so it is shared too rather than re-derived per surface.
export * from "./ops-nudges";
export * from "./order-number";
// What each system permission is called and which module it belongs to. The
// API serves it at `GET /v1/roles/permissions-catalog`; web and mobile read
// the same list from here (#4069).
export * from "./permission-registry";
// Client-side RBAC gates, shared by apps/web and apps/mobile. Moved out of
// `apps/web/lib/auth/can.ts` with #994 so the wildcard rule has one definition.
export * from "./permissions";
export * from "./phone";
export * from "./profile-copy";
export * from "./profile-correction";
// Event recurrence: the repeat-rule format the DTOs validate against, the
// stepper the series generator materializes from, and the words both apps
// describe a series with. One source so the generated series and what the
// Repeat controls promise cannot describe different meetings (#4488, #3662).
export * from "./recurrence";
export {
  accountHasSeenNewest,
  decideWhatsNew,
  formatReleaseNoteDate,
  isLaterReleaseNoteVersion,
  isNewerReleaseNoteVersion,
  parseReleaseNoteVersion,
  RELEASE_NOTE_VERSION_PATTERN,
  RELEASE_NOTES,
  type ReleaseNote,
  releaseNoteText,
  releaseNoteVersion,
  type ReleaseNoteVersion,
  type WhatsNewDecision,
} from "./release-notes";
// The Repeat control's state, read and written the same way by the web
// editor and the phone's New event sheet (#4488).
export * from "./repeat-draft";
export * from "./role-colors";
export * from "./service-points";
export * from "./service-receipt";
export * from "./signed-upload";
export * from "./status-labels";
// Study zone shapes: a circle or a traced outline, and the polygon a circle
// is stored as (map picker, Pick study zones on a map).
export * from "./study-zone-shape";
// Client-side subscription write gate. Moved out of `apps/web/lib/subscription.ts`
// so it sits next to `can` and `isModuleEnabled` as the third shared client gate.
export * from "./subscription";
export * from "./thumbhash";
// ── Time zones (issue #687) ──────────────────────────────────────────────────
export * from "./time-zone";
// ── Upload MIME / extension allowlists + size caps (25 MB; backwork 100 MB) ──
export {
  acceptAttribute,
  contentTypeByExtension,
  DOCUMENT_UPLOAD_SURFACES,
  fileExtension,
  type InspectedUpload,
  inspectUploadFile,
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  MAX_BACKWORK_UPLOAD_BYTES,
  MAX_BACKWORK_UPLOAD_LABEL,
  MAX_BACKWORK_ZIP_BYTES,
  MAX_BACKWORK_ZIP_FILES,
  MAX_BACKWORK_ZIP_LABEL,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  mimeForUploadFile,
  normalizeExtension,
  type UploadKind,
} from "./upload-allowlists";
