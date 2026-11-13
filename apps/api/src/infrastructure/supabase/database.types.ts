import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityItemRead,
  ActivityUnreadStart,
  AiReport,
  AiRun,
  AiSuggestion,
  AskDiagnosticsExchange,
  AskDiagnosticsWindow,
  BackworkCourse,
  BackworkDepartment,
  BackworkProfessor,
  BackworkResource,
  CalendarFeed,
  ChannelReadReceipt,
  Chapter,
  ChapterActivationMilestone,
  ChapterAiSettings,
  ChapterAuditLog,
  ChapterCustomField,
  ChapterDirectoryEntry,
  ChapterDirectoryRequest,
  ChapterDocument,
  ChapterDocumentFolder,
  ChapterDocumentStar,
  ChapterDocumentType,
  ChapterDuesConfig,
  ChapterGoalRow,
  ChapterGroup,
  ChapterGroupMember,
  ChapterGroupMembership,
  ChapterPointsConfig,
  ChapterServiceConfig,
  ChapterWorkflow,
  ChatChannel,
  ChatChannelCategory,
  ChatFormResponse,
  ChatLinkMemberState,
  ChatMemberBlock,
  ChatMessage,
  ChatMessageAction,
  ChatMessageAttachment,
  ChatMessageBookmark,
  ChatMessageImportantSeen,
  ChatMessageLink,
  ChatMessageReport,
  ChatNotificationPreference,
  ChatPushDispatch,
  ChatSidebarPin,
  ChatSidebarPreferences,
  ChatThreadFollow,
  CorpusCandidate,
  CorpusSource,
  DiscordAuthorLink,
  DiscordConnection,
  DiscordImport,
  DiscordImportChannel,
  DiscordImportCreatedCategory,
  DiscordImportCreatedChannel,
  DiscordImportFile,
  DiscordOAuthState,
  Event,
  EventAttendance,
  EventCheckInScreen,
  EventExcuse,
  EventType,
  FinancialInvoice,
  FinancialTransaction,
  FollowedThreadUnread,
  GoogleCalendarConnection,
  GoogleCalendarOAuthState,
  Invite,
  Meeting,
  MeetingDraft,
  MeetingRecording,
  MeetingTemplate,
  Member,
  MemberCustomFieldValueRow,
  MessageReaction,
  Notification,
  NotificationPreference,
  PledgeClass,
  PledgeClassAssignment,
  PointTransaction,
  PollVote,
  PushToken,
  Role,
  RoleTier,
  RushCandidate,
  RushCandidateVote,
  ScheduledNotificationDispatch,
  SemesterArchive,
  ServiceEntry,
  ServiceLeaderboardRow,
  StripeWebhookEvent,
  StudyGeofence,
  StudySession,
  Task,
  TaskPhoto,
  TaskSubtask,
  User,
  UserAiConsent,
  UserSettings,
} from '#domain/entities';
import type { StripeWebhookClaimOutcome } from '#domain/repositories/stripe-webhook-event.repository.interface';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Flatten an interface into an anonymous mapped type so it satisfies
 * postgrest-js's `Record<string, unknown>` constraint (interfaces have no
 * implicit index signature; a mapped type does). Same trick as `Row`.
 *
 * Insert/Update used to be a bare `Record<string, unknown>`, which is why
 * every `.insert()` / `.update()` needed `as never` — `Partial<Entity>` is an
 * interface and is not assignable to that index signature. Mapping the
 * entity's keys keeps GenericSchema bound *and* lets `TablesInsert<'tasks'>`
 * type-check at the write boundary.
 */
type TableRow<Row> = { [K in keyof Row]: Row[K] };
type TableInsert<Row> = { [K in keyof Row]?: Row[K] };
type TableUpdate<Row> = { [K in keyof Row]?: Row[K] };

type TableDefinition<Row> = {
  Row: TableRow<Row>;
  Insert: TableInsert<Row>;
  Update: TableUpdate<Row>;
  Relationships: {
    foreignKeyName: string;
    columns: string[];
    isOneToOne?: boolean;
    referencedRelation: string;
    referencedColumns: string[];
  }[];
};

export interface Database {
  public: {
    Tables: {
      activity_item_reads: TableDefinition<ActivityItemRead>;
      activity_unread_starts: TableDefinition<ActivityUnreadStart>;
      ai_diagnostics_exchanges: TableDefinition<AskDiagnosticsExchange>;
      ai_diagnostics_windows: TableDefinition<AskDiagnosticsWindow>;
      ai_reports: TableDefinition<AiReport>;
      ai_runs: TableDefinition<AiRun>;
      ai_suggestions: TableDefinition<AiSuggestion>;
      backwork_courses: TableDefinition<BackworkCourse>;
      backwork_departments: TableDefinition<BackworkDepartment>;
      backwork_professors: TableDefinition<BackworkProfessor>;
      backwork_resources: TableDefinition<BackworkResource>;
      calendar_feeds: TableDefinition<CalendarFeed>;
      channel_read_receipts: TableDefinition<ChannelReadReceipt>;
      chapter_activation_milestones: TableDefinition<ChapterActivationMilestone>;
      chapter_ai_settings: TableDefinition<ChapterAiSettings>;
      chapter_audit_log: TableDefinition<ChapterAuditLog>;
      chapter_custom_fields: TableDefinition<ChapterCustomField>;
      chapter_directory: TableDefinition<ChapterDirectoryEntry>;
      chapter_directory_requests: TableDefinition<ChapterDirectoryRequest>;
      chapter_document_folders: TableDefinition<ChapterDocumentFolder>;
      chapter_document_stars: TableDefinition<ChapterDocumentStar>;
      chapter_document_types: TableDefinition<ChapterDocumentType>;
      chapter_documents: TableDefinition<ChapterDocument>;
      chapter_dues_config: TableDefinition<ChapterDuesConfig>;
      chapter_goals: TableDefinition<ChapterGoalRow>;
      chapter_group_members: TableDefinition<ChapterGroupMember>;
      chapter_groups: TableDefinition<ChapterGroup>;
      chapter_pledge_classes: TableDefinition<PledgeClass>;
      chapter_points_config: TableDefinition<ChapterPointsConfig>;
      chapter_service_config: TableDefinition<ChapterServiceConfig>;
      chapter_workflows: TableDefinition<ChapterWorkflow>;
      chapters: TableDefinition<Chapter>;
      chat_channel_categories: TableDefinition<ChatChannelCategory>;
      chat_channels: TableDefinition<ChatChannel>;
      chat_form_responses: TableDefinition<ChatFormResponse>;
      chat_link_member_states: TableDefinition<ChatLinkMemberState>;
      chat_member_blocks: TableDefinition<ChatMemberBlock>;
      chat_message_actions: TableDefinition<ChatMessageAction>;
      chat_message_attachments: TableDefinition<ChatMessageAttachment>;
      chat_message_bookmarks: TableDefinition<ChatMessageBookmark>;
      chat_message_important_seen: TableDefinition<ChatMessageImportantSeen>;
      chat_message_links: TableDefinition<ChatMessageLink>;
      chat_message_reports: TableDefinition<ChatMessageReport>;
      chat_messages: TableDefinition<ChatMessage>;
      chat_notification_preferences: TableDefinition<ChatNotificationPreference>;
      chat_push_dispatches: TableDefinition<ChatPushDispatch>;
      chat_sidebar_pins: TableDefinition<ChatSidebarPin>;
      chat_sidebar_preferences: TableDefinition<ChatSidebarPreferences>;
      chat_thread_follows: TableDefinition<ChatThreadFollow>;
      corpus_sources: TableDefinition<CorpusSource>;
      discord_author_links: TableDefinition<DiscordAuthorLink>;
      discord_connections: TableDefinition<DiscordConnection>;
      discord_import_channels: TableDefinition<DiscordImportChannel>;
      discord_import_created_categories: TableDefinition<DiscordImportCreatedCategory>;
      discord_import_created_channels: TableDefinition<DiscordImportCreatedChannel>;
      discord_import_files: TableDefinition<DiscordImportFile>;
      discord_imports: TableDefinition<DiscordImport>;
      discord_oauth_states: TableDefinition<DiscordOAuthState>;
      event_attendance: TableDefinition<EventAttendance>;
      event_check_in_screens: TableDefinition<EventCheckInScreen>;
      event_excuses: TableDefinition<EventExcuse>;
      event_types: TableDefinition<EventType>;
      events: TableDefinition<Event>;
      financial_invoices: TableDefinition<FinancialInvoice>;
      financial_transactions: TableDefinition<FinancialTransaction>;
      google_calendar_connections: TableDefinition<GoogleCalendarConnection>;
      google_calendar_oauth_states: TableDefinition<GoogleCalendarOAuthState>;
      invites: TableDefinition<Invite>;
      meeting_drafts: TableDefinition<MeetingDraft>;
      meeting_recordings: TableDefinition<MeetingRecording>;
      meeting_templates: TableDefinition<MeetingTemplate>;
      meetings: TableDefinition<Meeting>;
      member_custom_field_values: TableDefinition<MemberCustomFieldValueRow>;
      members: TableDefinition<Member>;
      message_reactions: TableDefinition<MessageReaction>;
      notification_preferences: TableDefinition<NotificationPreference>;
      notifications: TableDefinition<Notification>;
      point_transactions: TableDefinition<PointTransaction>;
      poll_votes: TableDefinition<PollVote>;
      push_tokens: TableDefinition<PushToken>;
      role_tiers: TableDefinition<RoleTier>;
      roles: TableDefinition<Role>;
      rush_candidate_votes: TableDefinition<RushCandidateVote>;
      rush_candidates: TableDefinition<RushCandidate>;
      scheduled_notification_dispatches: TableDefinition<ScheduledNotificationDispatch>;
      semester_archives: TableDefinition<SemesterArchive>;
      service_entries: TableDefinition<ServiceEntry>;
      stripe_webhook_events: TableDefinition<StripeWebhookEvent>;
      study_geofences: TableDefinition<StudyGeofence>;
      study_sessions: TableDefinition<StudySession>;
      task_photos: TableDefinition<TaskPhoto>;
      task_subtasks: TableDefinition<TaskSubtask>;
      tasks: TableDefinition<Task>;
      user_ai_consents: TableDefinition<UserAiConsent>;
      user_settings: TableDefinition<UserSettings>;
      users: TableDefinition<User>;
    };
    Views: {
      /** `20261113040007` (#4076): one row per (group, member), every kind. */
      chapter_group_memberships: {
        Row: TableRow<ChapterGroupMembership>;
        Relationships: [];
      };
    };
    Functions: {
      /**
       * `20260928170000` (#1302). Atomically appends `p_user_id` to a PRIVATE
       * channel's `member_ids` unless already listed. Empty result set means
       * the row didn't match (wrong id/chapter, or not PRIVATE).
       */
      add_private_channel_member: {
        Args: {
          p_channel_id: string;
          p_chapter_id: string;
          p_user_id: string;
        };
        Returns: ChatChannel[];
      };
      /**
       * `20261112165020` (#714) — a chapter's AI usage in `[p_from, p_to)`, one
       * row per task, provider and model. Bigint columns may arrive as strings.
       */
      ai_chapter_usage: {
        Args: { p_chapter_id: string; p_from: string; p_to: string };
        Returns: {
          task: string;
          provider: string;
          model: string;
          calls: number | string;
          input_tokens: number | string;
          output_tokens: number | string;
          cached_input_tokens: number | string;
          /** `20261112190000` (#712); absent before that migration. */
          audio_seconds?: number | string;
          cost_micro_usd: number | string;
          estimated_cost_micro_usd: number | string;
          unsettled_calls: number | string;
        }[];
      };
      /** `20260803140000` — `returns setof users`. */
      anonymize_user: {
        Args: { p_user_id: string; p_rescan_cards?: boolean };
        Returns: User[];
      };
      /** `20260803120000` — `returns setof financial_invoices`. */
      apply_invoice_payment: {
        Args: {
          p_invoice_id: string;
          p_chapter_id: string;
          p_payment_intent_id: string | null;
          p_charge_id: string | null;
        };
        Returns: FinancialInvoice[];
      };
      /**
       * `20260909180000` (#1979) — `returns table (applied chapters,
       * previous_subscription_status text)`. Empty when the event is older
       * than `last_stripe_webhook_at` (lost CAS / stale). Replaced
       * `20260909050000`'s `setof chapters`.
       */
      apply_subscription_webhook: {
        Args: {
          p_chapter_id: string;
          p_event_at: string;
          p_patch: Record<string, string | string[] | null | undefined>;
        };
        Returns: {
          applied: { [K in keyof Chapter]: Chapter[K] };
          previous_subscription_status: Chapter['subscription_status'];
        }[];
      };
      /** `20260603120000` — `returns setof service_entries`. */
      approve_service_entry: {
        Args: {
          p_entry_id: string;
          p_chapter_id: string;
          p_reviewer_id: string;
          p_review_comment: string | null;
          p_points: number;
        };
        Returns: ServiceEntry[];
      };
      /** `20261110170000` (#3939) — `p_assignments` is `jsonb`; `returns setof members`. */
      assign_member_pledge_classes: {
        Args: { p_chapter_id: string; p_assignments: PledgeClassAssignment[] };
        Returns: Member[];
      };
      backwork_course_write: {
        Args: {
          p_chapter_id: string;
          p_department_id: string;
          p_course_number: string;
          p_set_name: boolean;
          p_name: string | null;
          p_may_rename: boolean;
          p_add: string[];
          p_remove: string[];
          p_clamp?: boolean;
        };
        Returns: BackworkCourse;
      };
      /** `20261112170000` (#4314) — who the chapter's chat index holds or left out. */
      chat_corpus_authors: {
        Args: { p_chapter_id: string };
        Returns: { user_id: string; indexed: boolean }[];
      };
      /** `20261112170000` (#4314) — chapters that hold chat windows. */
      chat_corpus_chapters: {
        Args: Record<string, never>;
        Returns: string[];
      };
      /** `20261112170000` (#4314) — each chat window's channel, DMs refused. */
      chat_corpus_window_channels: {
        Args: { p_chapter_id: string; p_window_ids: string[] };
        Returns: { window_id: string; channel_id: string }[];
      };
      /** `20260603140000` — `returns setof event_attendance`. */
      check_in_event: {
        Args: {
          p_event_id: string;
          p_user_id: string;
          p_chapter_id: string;
          p_check_in_time: string;
          p_point_value: number;
          p_event_name: string;
        };
        Returns: EventAttendance[];
      };
      /**
       * `20261112165000` (#4310) — leases the oldest claimable run, or returns
       * no row; `returns setof ai_runs`.
       */
      claim_ai_run: {
        Args: {
          p_worker_id: string;
          p_now: string;
          p_lease_seconds: number;
          p_kinds: string[];
        };
        Returns: AiRun[];
      };
      /**
       * `20261112165050` (#720) — sources that need indexing, each with its
       * next attempt pushed out; `returns setof corpus_sources`.
       */
      claim_corpus_sources: {
        Args: { p_fingerprint: string; p_now: string; p_limit: number };
        Returns: CorpusSource[];
      };
      /**
       * `20261113040008` (#3322) — Google Calendar connections to sync or
       * clean up next, each leased; `returns setof google_calendar_connections`.
       */
      claim_google_calendar_syncs: {
        Args: { p_now: string; p_limit: number; p_lease_seconds: number };
        Returns: GoogleCalendarConnection[];
      };
      /**
       * `20260901183000` — `returns boolean`. `true` on a successful claim,
       * `false` when the chapter's `needs_president` flag was already clear
       * (race lost to another claimant).
       */
      claim_presidency: {
        Args: {
          p_chapter_id: string;
          p_claiming_member_id: string;
          p_eligible_role_id: string;
          p_president_role_id: string;
        };
        Returns: boolean;
      };
      claim_signup_slots: {
        Args: {
          p_message_id: string;
          p_user_id: string;
          p_slot_ids: string[];
          p_note?: string | null;
        };
        Returns: Json;
      };
      /**
       * `20260805150000`. `claim_outcome` is `text` in SQL, narrowed here to
       * the three literals the function body can actually return.
       */
      claim_stripe_webhook_event: {
        Args: {
          p_event_id: string;
          p_event_type: string;
          p_stale_seconds: number;
        };
        Returns: {
          claim_outcome: StripeWebhookClaimOutcome;
          claim_attempts: number;
        }[];
      };
      /** `20260602210000` — `returns setof tasks`. */
      confirm_task_completion: {
        Args: { p_task_id: string; p_chapter_id: string };
        Returns: Task[];
      };
      /**
       * `20261113040003` (#3735) — move a PENDING excuse to a decision and
       * write the attendance it implies in the same transaction. Empty when
       * the excuse was no longer pending.
       */
      decide_event_excuse: {
        Args: {
          p_excuse_id: string;
          p_chapter_id: string;
          p_decision: 'APPROVED' | 'DECLINED';
          p_decided_by: string;
          p_mark_absent: boolean;
        };
        Returns: EventExcuse[];
      };
      /**
       * `20261113053718` (#3642). Clears a document type from its documents
       * (by `document_type_key`) and deletes it, in one transaction; false
       * when the chapter has no such type.
       */
      delete_chapter_document_type: {
        Args: { p_chapter_id: string; p_type_id: string };
        Returns: boolean;
      };
      /**
       * `20261105220000`. Deletes the channel groups a `purging` import
       * created that now hold no channel, and returns their ids. A no-op for
       * any other status.
       */
      delete_empty_discord_import_categories: {
        Args: { p_import_id: string; p_chapter_id: string };
        Returns: string[];
      };
      /**
       * `20260930030000` (#2905). Deletes the channels a `purging` import
       * created that now hold nothing, and returns their ids. A no-op for any
       * other status.
       */
      delete_empty_discord_import_channels: {
        Args: { p_import_id: string; p_chapter_id: string };
        Returns: string[];
      };
      /**
       * `20261113040010` (#4620) — delete the upcoming occurrences a series
       * edit rebuilt, carrying each matched pair's excuses (and an approved
       * one's EXCUSED attendance) to the new meeting in the same transaction.
       * Returns the pending and approved excuses no new meeting took.
       */
      delete_replaced_occurrences: {
        Args: {
          p_chapter_id: string;
          p_old_ids: string[];
          p_from_ids: string[];
          p_to_ids: string[];
        };
        Returns: EventExcuse[];
      };
      /**
       * `20261106170000`. An import's rows being imported, added up per
       * Discord category, a thread under its parent's category.
       */
      discord_import_category_progress: {
        Args: { p_import_id: string; p_chapter_id: string };
        Returns: {
          category: string | null;
          channels: number;
          threads: number;
          done: number;
          failed: number;
        }[];
      };
      /**
       * `20260905010000` (#1243). Registers Discord-import manifest rows and
       * enforces the two `chat-archive` byte ceilings in one transaction,
       * returning the rows it wrote.
       *
       * Raises `check_violation` with a `discord_import_archive_quota:`-prefixed
       * message when a ceiling is crossed, in which case the whole batch is
       * rolled back. `p_rows` carries the same shape as a
       * `discord_import_files` insert, minus the columns the function supplies
       * itself (`import_id`, `chapter_id`).
       */
      discord_import_register_files: {
        Args: {
          p_chapter_id: string;
          p_import_id: string;
          p_rows: {
            relative_path: string;
            kind: string;
            part_index: number | null;
            bucket: string;
            storage_path: string;
            content_type: string | null;
            byte_size: number | null;
          }[];
          /** `bigint` in SQL; sent and returned as a JSON number. */
          p_import_cap: number;
          p_chapter_cap: number;
        };
        Returns: DiscordImportFile[];
      };
      /**
       * `20261112165000` (#4310) — the run for (chapter, kind, dedupe key),
       * new or existing; `returns setof ai_runs`.
       */
      enqueue_ai_run: {
        Args: {
          p_chapter_id: string;
          p_kind: string;
          p_dedupe_key: string;
          p_requested_by: string | null;
          p_acting_user_id: string | null;
          p_input_ref: AiRun['input_ref'];
          p_max_attempts: number;
        };
        Returns: AiRun[];
      };
      /** `20261112165020` (#714) — expires unsettled holds; returns the count. */
      expire_ai_spend_holds: {
        Args: { p_older_than: string };
        Returns: number;
      };
      /** `20261112165050` (#720) — marks a source indexed or skipped. */
      finish_corpus_source: {
        Args: {
          p_source_id: string;
          p_revision: number;
          p_fingerprint: string;
          p_title: string | null;
          p_source_at: string | null;
          p_decays: boolean;
          p_chunk_count: number;
          p_skip_reason: string | null;
          /** `20261112170000` (#4314): what a chat window left out, and whose. */
          p_left_out_count?: number;
          p_left_out_author_ids?: string[] | null;
        };
        Returns: boolean;
      };
      /**
       * `20261113040001` — finish a study session behind a compare-and-set on
       * status, watermark and pause, and write its STUDY award in the same
       * transaction. Empty when the compare-and-set lost.
       */
      finish_study_session: {
        Args: {
          p_session_id: string;
          p_chapter_id: string;
          p_expected_last_heartbeat_at: string;
          p_expected_paused_at: string | null;
          p_status: 'COMPLETED' | 'PAUSED_EXPIRED';
          p_end_time: string;
          p_last_heartbeat_at: string;
          p_total_foreground_minutes: number;
          p_points: number;
          p_description: string;
        };
        Returns: StudySession[];
      };
      /**
       * `20261106210000`. Each channel's latest message that is not deleted
       * and not from a member the caller blocked, for Chat home's previews.
       * Rows for every channel in the chapter: the service filters by access.
       * `payload` is set only on an audit line; `content` is cut to 500.
       */
      get_channel_latest_messages: {
        Args: { p_chapter_id: string; p_user_id: string };
        Returns: {
          channel_id: string;
          message_id: string;
          sender_id: string | null;
          author_name: string | null;
          content: string;
          kind: string;
          payload: Record<string, unknown> | null;
          attachment_count: number;
          created_at: string;
        }[];
      };
      /**
       * `20260816190000` (C1 of #937). Unread and mention tallies for every
       * channel in a chapter, for one viewer, in one round trip.
       *
       * Returns a row per channel in the chapter — including channels the
       * viewer cannot access and including channels with nothing unread (as
       * zero). Callers MUST filter to accessible channels; the service does
       * this with the same predicate the rest of chat uses, rather than a
       * second copy of the access rules in SQL.
       *
       * `p_user_id` is `users.id`, not `supabase_auth_id`.
       */
      get_channel_unread_counts: {
        Args: { p_chapter_id: string; p_user_id: string };
        Returns: {
          channel_id: string;
          unread_count: number;
          mention_count: number;
        }[];
      };
      /**
       * `20261110220000` (#3785). The caller's followed and muted threads in
       * one channel, with how many replies are new to them (0 when muted).
       * The service authorizes the channel first.
       */
      get_followed_thread_unread: {
        Args: { p_channel_id: string; p_user_id: string };
        Returns: FollowedThreadUnread[];
      };
      /**
       * `20260925200000` (#2303). The chapter's 1:1 DMs `p_user_id` has hidden
       * and that no newer, non-deleted message from a sender they have not
       * blocked has resurfaced.
       */
      get_hidden_channel_ids: {
        Args: { p_chapter_id: string; p_user_id: string };
        Returns: { channel_id: string }[];
      };
      /**
       * `20260906120001` — per-member point totals for one chapter, summed in
       * Postgres. Bounds carry the same semantics as `get_points_report`:
       * `p_since` exclusive, `p_until` inclusive, either null unbounded. Rows
       * come back ordered by total descending, then `user_id` ascending.
       */
      get_points_leaderboard: {
        Args: {
          p_chapter_id: string;
          p_since?: string | null;
          p_until?: string | null;
        };
        Returns: {
          user_id: string;
          /** `bigint` in SQL; PostgREST serializes it as a JSON number. */
          total: number;
        }[];
      };
      /**
       * `20250226120000`, re-signed by `20260604140000` and again by
       * `20260902010001`: each parameter-list change drops the prior
       * signature, so this is the only one. `p_since` is an exclusive lower
       * bound and `p_until` an inclusive upper bound on `created_at`; either
       * null is unbounded on that side.
       */
      get_points_report: {
        Args: {
          p_chapter_id: string;
          p_user_id?: string | null;
          p_since?: string | null;
          p_until?: string | null;
        };
        Returns: {
          member_name: string;
          /** `bigint` in SQL; PostgREST serializes it as a JSON number. */
          total_points: number;
          breakdown_by_category: Record<string, number>;
        }[];
      };
      get_poll_user_votes_for_messages: {
        Args: { p_message_ids: string[]; p_user_id: string };
        Returns: {
          message_id: string;
          option_index: number;
        }[];
      };
      get_poll_vote_option_totals: {
        Args: { p_message_ids: string[] };
        Returns: {
          message_id: string;
          option_index: number;
          vote_count: number;
        }[];
      };
      /**
       * `20261112151000` (#3583). The caller's `users.id`, the chapter's
       * subscription state and module toggles, the caller's membership row
       * in it and the roles that row names, in one round trip, for the
       * chapter guards' prefetch. Service role only. Each part is `null`
       * (`roles` is `[]`) when its row does not exist.
       */
      get_request_context: {
        Args: { p_auth_id: string; p_chapter_id: string };
        Returns: Json;
      };
      /**
       * `20260809124500` — ranked APPROVED service time per member. Date
       * bounds are inclusive and compare against `date`, not `created_at`;
       * both are nullable for an all-time ranking.
       */
      get_service_leaderboard: {
        Args: {
          p_chapter_id: string;
          p_start_date?: string | null;
          p_end_date?: string | null;
        };
        Returns: ServiceLeaderboardRow[];
      };
      /**
       * `20260925200000` (#2303). Hides a 1:1 DM from `p_user_id`'s own list:
       * upserts their read receipt with `hidden_at` and `last_read_at` at the
       * database's `now()`. Empty result set means the row didn't match (wrong
       * id/chapter, or not a DM).
       */
      hide_direct_message: {
        Args: {
          p_channel_id: string;
          p_chapter_id: string;
          p_user_id: string;
        };
        Returns: ChannelReadReceipt[];
      };
      leave_group_dm: {
        Args: {
          p_channel_id: string;
          p_chapter_id: string;
          p_user_id: string;
        };
        Returns: ChatChannel[];
      };
      /**
       * `20260929230000` (#2878). Links a member's Discord account in one
       * chapter and attaches that author's imported rows in the chapter's
       * channels to them. Raises `23505` when the account is linked to another
       * member of the chapter and `42501` when the user is not a member.
       */
      link_discord_author: {
        Args: {
          p_chapter_id: string;
          p_user_id: string;
          p_discord_user_id: string;
          p_discord_username: string | null;
        };
        Returns: {
          discord_user_id: string;
          discord_username: string | null;
          linked_at: string;
          messages_linked: number;
        }[];
      };
      /**
       * `20261112165050` (#720) — retrieval candidates for one chapter, for a
       * member of it only.
       */
      match_corpus_chunks: {
        Args: {
          p_chapter_id: string;
          p_user_id: string;
          p_query: string;
          p_embedding: string;
          p_embedding_model: string;
          p_limit: number;
        };
        Returns: CorpusCandidate[];
      };
      /**
       * `20261112170000` (#4314) — a chat window's readable messages, oldest
       * conversation first; one row with a null `message_id` when it holds
       * none, no row when it is gone or its channel is a DM.
       */
      read_chat_corpus_window: {
        Args: { p_chapter_id: string; p_window_id: string };
        Returns: {
          channel_id: string;
          channel_name: string;
          day: string;
          message_id: string | null;
          sender_id: string | null;
          sender_name: string | null;
          content: string | null;
          created_at: string | null;
          thread_root_id: string | null;
          conversation_at: string | null;
        }[];
      };
      /**
       * `20260928170000` (#1302). Atomically removes `p_user_id` from a
       * PRIVATE channel's `member_ids`. Empty result set means the row didn't
       * match (wrong id/chapter, not PRIVATE) or the removal would have left
       * no current chapter member listed, which it refuses.
       */
      remove_private_channel_member: {
        Args: {
          p_channel_id: string;
          p_chapter_id: string;
          p_user_id: string;
        };
        Returns: ChatChannel[];
      };
      /**
       * `20260928170000` (#1302). Removes `p_user_id` from every PRIVATE
       * channel's `member_ids` in the chapter, for `MemberService.remove`.
       * Returns the ids of the channels it changed.
       */
      remove_user_from_private_channels: {
        Args: {
          p_chapter_id: string;
          p_user_id: string;
        };
        Returns: string[];
      };
      /**
       * `20261113053718` (#3642). Renames a document type and every document
       * of it (by `document_type_key`) in one transaction; no row when the
       * chapter has no such type, unique_violation when the name is taken.
       */
      rename_chapter_document_type: {
        Args: { p_chapter_id: string; p_type_id: string; p_name: string };
        Returns: ChapterDocumentType[];
      };
      /** `20261110170000` (#3939) — `returns setof chapter_pledge_classes`. */
      reorder_chapter_pledge_classes: {
        Args: { p_chapter_id: string; p_ids: string[] };
        Returns: PledgeClass[];
      };
      /**
       * `20261111190000`. The chapter's category order in array order; any
       * category not listed keeps its relative order after them. Returns
       * every category of the chapter in its new order.
       */
      reorder_chat_categories: {
        Args: {
          p_chapter_id: string;
          p_category_ids: string[];
        };
        Returns: ChatChannelCategory[];
      };
      /**
       * `20261111190000`. Files the listed channels under one section
       * (`p_category_id` null is the default Channels section) in array
       * order, and renumbers the rest of that section after them. Skips DMs,
       * group DMs and the audit log. Returns the listed rows.
       */
      reorder_chat_channels: {
        Args: {
          p_chapter_id: string;
          p_category_id: string | null;
          p_channel_ids: string[];
        };
        Returns: ChatChannel[];
      };
      /**
       * `20261112001000` (#4071) — `returns setof role_tiers`. Raises
       * `check_violation` when `p_ids` is not exactly the chapter's tiers or
       * its order no longer starts with `p_fixed_ids`.
       */
      reorder_role_tiers: {
        Args: { p_chapter_id: string; p_ids: string[]; p_fixed_ids: string[] };
        Returns: RoleTier[];
      };
      /**
       * `20261112170000` (#4314) — reads again every chat window that holds or
       * left out one of `p_user_ids`; returns how many.
       */
      requeue_chat_corpus_by_authors: {
        Args: { p_user_ids: string[]; p_chapter_id: string | null };
        Returns: number;
      };
      /**
       * `20261112165020` (#714) — holds an AI call's worst-case cost against
       * the platform, chapter and member caps. One row: the hold's id, or the
       * cap it would cross. Amounts are bigint micro-USD.
       */
      reserve_ai_spend: {
        Args: {
          p_chapter_id: string;
          p_user_id: string | null;
          p_run_id: string | null;
          p_task: string;
          p_family: string;
          p_provider: string;
          p_model: string;
          p_prompt_version: string;
          p_reserved_cost_micro_usd: number;
          p_chapter_cap_micro_usd: number | null;
          p_member_cap_micro_usd: number | null;
          p_platform_cap_micro_usd: number | null;
          p_now: string;
        };
        Returns: {
          reservation_id: string | null;
          refused: string | null;
          platform_spent_before: number | string;
          platform_spent_after: number | string;
        }[];
      };
      /**
       * `20260829000000` — `returns semester_archives`. Archives the period and
       * swaps New Member → Member across the chapter in one transaction. Returns
       * the single created archive row (a composite, not `setof`), so this is the
       * row type rather than an array. Only reached when promotion is requested;
       * a plain rollover still goes through `semester_archives.insert`.
       */
      rollover_semester: {
        Args: {
          p_chapter_id: string;
          p_label: string;
          p_start_date: string;
          p_end_date: string;
          p_new_member_role_id: string;
          p_member_role_id: string;
        };
        Returns: SemesterArchive;
      };
      /** `20261113040011`. Raises `form_card_missing` or `form_closed`. */
      save_chat_form_response: {
        Args: {
          p_message_id: string;
          p_user_id: string;
          p_answers: Json;
        };
        Returns: ChatFormResponse;
      };
      /**
       * `20261106190000` (#585). Backwork search over title, course,
       * department, professor and tags, with trigram typo tolerance, ranked
       * word matches first. One chapter only; at most 50 rows.
       */
      search_backwork_resources: {
        Args: { p_chapter_id: string; p_query: string; p_limit?: number };
        Returns: BackworkResource[];
      };
      /**
       * `20261107043000`. Onboarding chapter search: word prefixes over
       * organization, letters, chapter, school and aliases, with trigram typo
       * tolerance. Global reference data, no chapter scope; at most 50 rows.
       */
      search_chapter_directory: {
        Args: {
          p_query: string;
          p_university?: string | null;
          p_limit?: number;
        };
        Returns: ChapterDirectoryEntry[];
      };
      /**
       * `20261112131300` (#3965). Chat search with a filter and no text: each
       * handed channel's newest matches through an index, merged, newest
       * first. Reads only the channel ids it is handed (the caller decides
       * access); `p_has` is `file | image | link | poll`; at most 100 rows.
       */
      search_chat_messages_filtered: {
        Args: {
          p_channel_ids: string[];
          p_sender_id: string | null;
          p_after: string | null;
          p_before: string | null;
          p_has: string[];
          p_limit: number;
        };
        Returns: ChatMessage[];
      };
      /**
       * `20261113040007` (#4076): a manual group's members set to exactly
       * `p_user_ids`, all or none. Returns the `users.id`s after.
       */
      set_chapter_group_members: {
        Args: {
          p_chapter_id: string;
          p_group_id: string;
          p_user_ids: string[];
        };
        Returns: string[];
      };
      /**
       * `20261111233000` (#3722). Sets a category's who-can-see and
       * who-can-post lists, and the same lists on every channel in it that
       * matched the category before, in one transaction. Returns the ids of
       * the channels that followed.
       */
      set_chat_category_access: {
        Args: {
          p_chapter_id: string;
          p_category_id: string;
          p_who_can_see: string[] | null;
          p_who_can_post: string[] | null;
        };
        Returns: string[];
      };
      /**
       * `20260901180000` (#348). Atomically removes `p_user_id` from a
       * GROUP_DM's `member_ids` and archives the row once <= 1 member
       * remains — `array_remove` referencing the table's own column directly
       * (not an app-computed value) is what makes concurrent leaves
       * serialize correctly instead of losing an update. Empty result set
       * means the row didn't match (wrong id/chapter, or not a GROUP_DM).
       */
      /**
       * `20261106010000`. Makes one channel the chapter's default and unsets
       * the old one in the same transaction. Empty when the channel is not
       * in the chapter or is a DM.
       */
      set_chat_channel_default: {
        Args: {
          p_channel_id: string;
          p_chapter_id: string;
        };
        Returns: ChatChannel[];
      };
      /**
       * `20260929213000` (#2877). Folds or unfolds one sidebar section for one
       * member in one chapter, creating the row on first use.
       */
      set_chat_sidebar_section_collapsed: {
        Args: {
          p_user_id: string;
          p_chapter_id: string;
          p_section_key: string;
          p_collapsed: boolean;
        };
        Returns: ChatSidebarPreferences[];
      };
      /**
       * `20261112165020` (#714) — settles a hold with the call's real counts
       * and cost, or records a call made with no hold. Returns `settled`,
       * `inserted` or `missing`.
       */
      settle_ai_spend: {
        Args: {
          p_reservation_id: string | null;
          p_chapter_id: string;
          p_user_id: string | null;
          p_run_id: string | null;
          p_task: string;
          p_family: string;
          p_provider: string;
          p_model: string;
          p_prompt_version: string;
          p_outcome: string;
          p_error_kind: string | null;
          p_input_tokens: number;
          p_output_tokens: number;
          p_cached_input_tokens: number;
          p_cost_micro_usd: number;
          p_bill_reservation: boolean;
          p_latency_ms: number;
          p_now: string;
          /** `20261112190000` (#712): seconds of audio, transcription only. */
          p_audio_seconds?: number;
        };
        Returns: string;
      };
      /**
       * `20260604120000` — `returns setof members`. Returns both updated rows
       * on success, or zero rows when the caller no longer holds President.
       */
      transfer_presidency: {
        Args: {
          p_chapter_id: string;
          p_current_member_id: string;
          p_target_member_id: string;
          p_president_role_id: string;
        };
        Returns: Member[];
      };
      /**
       * `20260929230000` (#2878). Removes the member's link in the chapter and
       * returns how many imported rows went back to their Discord name, or
       * null when there was no link.
       */
      unlink_discord_author: {
        Args: { p_chapter_id: string; p_user_id: string };
        Returns: number | null;
      };
      /**
       * `20261113040003` (#3735) — delete a PENDING or APPROVED excuse, and an
       * approved one's EXCUSED attendance row. Empty when there was none.
       */
      withdraw_event_excuse: {
        Args: { p_event_id: string; p_user_id: string; p_chapter_id: string };
        Returns: EventExcuse[];
      };
      /**
       * `20261112165050` (#720) — one batch of a source's passages, written
       * only while the source is at `p_revision`. Each chunk's `embedding` is
       * the vector as text (`[0.1,0.2]`).
       */
      write_corpus_chunks: {
        Args: {
          p_source_id: string;
          p_revision: number;
          p_first: boolean;
          p_embedding_model: string;
          p_chunks: Json;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type FrappSupabaseClient = SupabaseClient<Database>;

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
