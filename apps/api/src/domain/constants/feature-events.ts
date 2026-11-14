/**
 * Server-side feature events (#593): the main action of each feature, recorded
 * by the API when the request that performs it succeeds, so PostHog sees web
 * and mobile usage from one place.
 *
 * Each entry names:
 *  - `feature`: the `MODULE_CATALOG` key (`@repo/org-archetypes`) the action
 *    belongs to, stamped on the event as the `feature` property so usage can be
 *    broken down by module;
 *  - `properties`: the **only** property keys the event may carry. This is an
 *    allowlist, checked at compile time on each `@FeatureEvent` describer and
 *    again at runtime by `FeatureEventInterceptor`. The shared
 *    `FORBIDDEN_ANALYTICS_PROPERTY_KEYS` denylist can't do this job alone: it
 *    doesn't know `title` or `details` hold content.
 *
 * A property describes the action's shape, never its content: no titles,
 * bodies, descriptions, free-text reasons or comments, names, emails,
 * coordinates, file or folder names, money amounts, or another member's id. A
 * string value comes from a closed set (a DTO `@IsIn`/`@IsEnum`, or a value
 * the server derives), never from free text.
 *
 * Names are domain-first past participles in kebab-case, like the rest of the
 * API's events. Each is used by at least one `@FeatureEvent` handler, and
 * `spec/behavior/observability.md` § Feature Events lists the same set; both
 * are checked by `feature-events.spec.ts`.
 */
export const FEATURE_EVENTS = {
  // Events and attendance
  'event-created': {
    feature: 'events',
    properties: [
      'is_mandatory',
      'is_recurring',
      'has_check_in_zone',
      'has_point_value',
      'posted_to_chat',
    ],
  },
  'attendance-checked-in': {
    feature: 'events',
    properties: ['method', 'has_location'],
  },
  'attendance-marked': {
    feature: 'events',
    properties: ['status', 'has_excuse'],
  },
  // Absence excuses (#3735): never the reason a member wrote.
  'event-excuse-sent': {
    feature: 'events',
    properties: [],
  },
  'event-excuse-decided': {
    feature: 'events',
    properties: ['decision'],
  },

  // Meetings (#4312): minutes written by hand. Only the type and which
  // sections hold something, never a word of the minutes.
  'meeting-started': {
    feature: 'meetings',
    properties: ['meeting_type', 'from_new_event'],
  },
  'meeting-posted': {
    feature: 'meetings',
    properties: ['meeting_type', 'has_decisions', 'has_action_items'],
  },
  // An officer asks for minutes drafted from their notes (#4312). No
  // property: the AI call itself is counted by the gateway's own event.
  'meeting-draft-requested': {
    feature: 'meetings',
    properties: [],
  },
  // An officer's recording finished uploading and its transcription was
  // queued (#712). No property: nothing about the file, and the provider
  // call is counted by the gateway's own event.
  'meeting-recording-uploaded': {
    feature: 'meetings',
    properties: [],
  },

  // Tasks
  'task-created': {
    feature: 'tasks',
    properties: [
      'assigned_to_self',
      'has_due_time',
      'has_point_reward',
      'has_reference_photo',
      'has_subtasks',
      'posted_to_chat',
      'proof_kind',
    ],
  },
  'task-status-changed': {
    feature: 'tasks',
    properties: [
      'status',
      'has_proof_photo',
      'has_proof_link',
      'has_completion_note',
    ],
  },
  'task-completion-confirmed': { feature: 'tasks', properties: [] },
  'task-completion-rejected': {
    feature: 'tasks',
    properties: ['asked_for_photo'],
  },

  // Polls (a poll is a chat message of kind `poll`)
  'poll-created': {
    feature: 'polls',
    properties: ['choice_mode', 'option_count', 'has_expiry'],
  },
  'poll-voted': {
    feature: 'polls',
    properties: ['surface', 'selected_count', 'is_revote'],
  },

  // Dues
  'invoice-created': { feature: 'dues', properties: [] },
  'invoice-status-changed': { feature: 'dues', properties: ['status'] },
  'invoice-payment-started': { feature: 'dues', properties: [] },

  // Points
  'points-adjusted': {
    feature: 'points',
    properties: ['category', 'direction', 'posted_to_chat'],
  },

  // Service hours and study sessions
  'service-hours-logged': {
    feature: 'hours',
    properties: ['duration_minutes', 'has_proof', 'posted_to_chat'],
  },
  'service-hours-reviewed': {
    feature: 'hours',
    properties: ['status', 'has_comment'],
  },
  'study-session-started': { feature: 'hours', properties: [] },
  'study-session-stopped': {
    feature: 'hours',
    properties: ['outcome', 'duration_minutes'],
  },

  // Geofences
  'geofence-created': { feature: 'geofences', properties: [] },

  // Chat
  'message-sent': {
    feature: 'chat',
    properties: ['kind', 'is_reply', 'attachment_count'],
  },
  'announcement-posted': { feature: 'announcements', properties: [] },
  'message-forwarded': { feature: 'chat', properties: ['has_comment'] },
  'message-reacted': { feature: 'chat', properties: [] },
  'message-flagged': { feature: 'chat', properties: ['flag'] },
  'dm-opened': { feature: 'chat', properties: [] },
  'channel-created': {
    feature: 'chat',
    properties: ['type', 'is_read_only', 'has_category'],
  },
  'message-reported': { feature: 'chat', properties: ['reason'] },

  // Documents and backwork
  'document-uploaded': {
    feature: 'documents',
    properties: ['has_document_type', 'has_folder'],
  },
  'document-viewed': { feature: 'documents', properties: [] },
  // One per batch a folder import files (#2242): counts only, since types
  // and folders are chapter-chosen names.
  'documents-imported': {
    feature: 'documents',
    properties: ['count', 'typed_count', 'filed_count'],
  },
  'backwork-uploaded': {
    feature: 'backwork',
    properties: ['assignment_type', 'is_redacted', 'tag_count'],
  },
  'backwork-viewed': { feature: 'backwork', properties: [] },

  // Recruitment
  'rush-candidate-added': {
    feature: 'rush',
    properties: ['is_existing_user', 'posted_to_chat'],
  },
  'rush-candidate-voted': { feature: 'rush', properties: [] },
  'rush-candidate-bid': { feature: 'rush', properties: [] },

  // Reports
  'report-generated': {
    feature: 'reports',
    properties: ['report_kind', 'format'],
  },

  // Members and chapter setup
  'invite-created': {
    feature: 'members',
    properties: ['invite_method', 'count'],
  },
  'invite-redeemed': { feature: 'members', properties: ['sign_in_method'] },
  'member-onboarding-completed': { feature: 'members', properties: [] },
  'profile-photo-updated': { feature: 'members', properties: [] },
  'chapter-onboarded': {
    feature: 'chapter-settings',
    properties: ['archetype', 'from_directory', 'sign_in_method'],
  },
  'semester-rolled-over': {
    feature: 'chapter-settings',
    properties: ['promote_new_members'],
  },
  'chapter-config-updated': {
    feature: 'chapter-settings',
    properties: ['section'],
  },
  'checkout-started': { feature: 'billing', properties: [] },
  'discord-import-created': { feature: 'chat', properties: ['source'] },
  'discord-import-started': { feature: 'chat', properties: ['has_cutoff'] },
} as const satisfies Record<string, FeatureEventDefinition>;

export interface FeatureEventDefinition {
  readonly feature: string;
  readonly properties: readonly string[];
}

export type FeatureEventName = keyof typeof FEATURE_EVENTS;

/** The property keys a feature event may carry. */
export type FeatureEventPropertyKey<N extends FeatureEventName> =
  (typeof FEATURE_EVENTS)[N]['properties'][number];

/** A feature event's properties: any subset of its allowlist, scalar values. */
export type FeatureEventProperties<N extends FeatureEventName> = {
  [K in FeatureEventPropertyKey<N>]?: string | number | boolean | null;
};
