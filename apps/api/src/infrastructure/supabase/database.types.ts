import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityItemRead,
  AiRun,
  AiSuggestion,
  ActivityUnreadStart,
  BackworkCourse,
  BackworkDepartment,
  BackworkProfessor,
  BackworkResource,
  Chapter,
  ChapterActivationMilestone,
  ChapterAuditLog,
  ChapterCustomField,
  ChapterDirectoryEntry,
  ChapterDirectoryRequest,
  ChapterDocument,
  ChapterDocumentFolder,
  ChapterDocumentStar,
  ChapterDuesConfig,
  ChapterServiceConfig,
  ChapterPointsConfig,
  ChapterWorkflow,
  ChannelReadReceipt,
  ChatChannel,
  ChatChannelCategory,
  ChatMemberBlock,
  ChatMessage,
  ChatMessageAction,
  ChatMessageAttachment,
  ChatMessageBookmark,
  ChatMessageImportantSeen,
  ChatMessageLink,
  ChatLinkMemberState,
  ChatThreadFollow,
  FollowedThreadUnread,
  ChatMessageReport,
  ChatNotificationPreference,
  ChatPushDispatch,
  ChatSidebarPin,
  ChatSidebarPreferences,
  DiscordConnection,
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
  DiscordImportCreatedChannel,
  DiscordImportCreatedCategory,
  DiscordOAuthState,
  DiscordAuthorLink,
  Event,
  EventAttendance,
  FinancialInvoice,
  FinancialTransaction,
  Invite,
  Member,
  MemberCustomFieldValueRow,
  MessageReaction,
  Notification,
  NotificationPreference,
  PointTransaction,
  PollVote,
  PushToken,
  Role,
  RoleTier,
  ScheduledNotificationDispatch,
  SemesterArchive,
  ServiceEntry,
  ServiceLeaderboardRow,
  StripeWebhookEvent,
  StudyGeofence,
  StudySession,
  Task,
  TaskSubtask,
  PledgeClass,
  EventType,
  Meeting,
  MeetingTemplate,
  PledgeClassAssignment,
  RushCandidate,
  RushCandidateVote,
  User,
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
      users: TableDefinition<User>;
      chapters: TableDefinition<Chapter>;
      members: TableDefinition<Member>;
      roles: TableDefinition<Role>;
      role_tiers: TableDefinition<RoleTier>;
      invites: TableDefinition<Invite>;
      backwork_departments: TableDefinition<BackworkDepartment>;
      backwork_courses: TableDefinition<BackworkCourse>;
      backwork_professors: TableDefinition<BackworkProfessor>;
      backwork_resources: TableDefinition<BackworkResource>;
      point_transactions: TableDefinition<PointTransaction>;
      events: TableDefinition<Event>;
      event_attendance: TableDefinition<EventAttendance>;
      chat_channel_categories: TableDefinition<ChatChannelCategory>;
      chat_channels: TableDefinition<ChatChannel>;
      chat_messages: TableDefinition<ChatMessage>;
      chat_message_actions: TableDefinition<ChatMessageAction>;
      chat_message_attachments: TableDefinition<ChatMessageAttachment>;
      discord_connections: TableDefinition<DiscordConnection>;
      discord_oauth_states: TableDefinition<DiscordOAuthState>;
      discord_author_links: TableDefinition<DiscordAuthorLink>;
      discord_imports: TableDefinition<DiscordImport>;
      discord_import_channels: TableDefinition<DiscordImportChannel>;
      discord_import_files: TableDefinition<DiscordImportFile>;
      discord_import_created_channels: TableDefinition<DiscordImportCreatedChannel>;
      discord_import_created_categories: TableDefinition<DiscordImportCreatedCategory>;
      message_reactions: TableDefinition<MessageReaction>;
      channel_read_receipts: TableDefinition<ChannelReadReceipt>;
      chat_message_bookmarks: TableDefinition<ChatMessageBookmark>;
      chat_message_important_seen: TableDefinition<ChatMessageImportantSeen>;
      chat_message_links: TableDefinition<ChatMessageLink>;
      chat_link_member_states: TableDefinition<ChatLinkMemberState>;
      activity_item_reads: TableDefinition<ActivityItemRead>;
      ai_suggestions: TableDefinition<AiSuggestion>;
      activity_unread_starts: TableDefinition<ActivityUnreadStart>;
      chat_thread_follows: TableDefinition<ChatThreadFollow>;
      chat_message_reports: TableDefinition<ChatMessageReport>;
      chat_member_blocks: TableDefinition<ChatMemberBlock>;
      poll_votes: TableDefinition<PollVote>;
      push_tokens: TableDefinition<PushToken>;
      notifications: TableDefinition<Notification>;
      notification_preferences: TableDefinition<NotificationPreference>;
      user_settings: TableDefinition<UserSettings>;
      study_geofences: TableDefinition<StudyGeofence>;
      study_sessions: TableDefinition<StudySession>;
      financial_invoices: TableDefinition<FinancialInvoice>;
      financial_transactions: TableDefinition<FinancialTransaction>;
      service_entries: TableDefinition<ServiceEntry>;
      tasks: TableDefinition<Task>;
      task_subtasks: TableDefinition<TaskSubtask>;
      chapter_pledge_classes: TableDefinition<PledgeClass>;
      event_types: TableDefinition<EventType>;
      meetings: TableDefinition<Meeting>;
      meeting_templates: TableDefinition<MeetingTemplate>;
      rush_candidates: TableDefinition<RushCandidate>;
      rush_candidate_votes: TableDefinition<RushCandidateVote>;
      chapter_documents: TableDefinition<ChapterDocument>;
      chapter_document_folders: TableDefinition<ChapterDocumentFolder>;
      chapter_document_stars: TableDefinition<ChapterDocumentStar>;
      semester_archives: TableDefinition<SemesterArchive>;
      stripe_webhook_events: TableDefinition<StripeWebhookEvent>;
      chapter_audit_log: TableDefinition<ChapterAuditLog>;
      chapter_custom_fields: TableDefinition<ChapterCustomField>;
      chapter_workflows: TableDefinition<ChapterWorkflow>;
      chapter_dues_config: TableDefinition<ChapterDuesConfig>;
      chapter_service_config: TableDefinition<ChapterServiceConfig>;
      chapter_points_config: TableDefinition<ChapterPointsConfig>;
      chapter_directory: TableDefinition<ChapterDirectoryEntry>;
      chapter_directory_requests: TableDefinition<ChapterDirectoryRequest>;
      chat_notification_preferences: TableDefinition<ChatNotificationPreference>;
      chat_push_dispatches: TableDefinition<ChatPushDispatch>;
      chat_sidebar_preferences: TableDefinition<ChatSidebarPreferences>;
      chat_sidebar_pins: TableDefinition<ChatSidebarPin>;
      member_custom_field_values: TableDefinition<MemberCustomFieldValueRow>;
      scheduled_notification_dispatches: TableDefinition<ScheduledNotificationDispatch>;
      chapter_activation_milestones: TableDefinition<ChapterActivationMilestone>;
      ai_runs: TableDefinition<AiRun>;
    };
    Views: Record<string, never>;
    Functions: {
      /**
       * `20261112020000` (#4310) — the run for (chapter, kind, dedupe key),
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
      /**
       * `20261112020000` (#4310) — leases the oldest claimable run, or returns
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
       * `20261110220000` (#3785). The caller's followed and muted threads in
       * one channel, with how many replies are new to them (0 when muted).
       * The service authorizes the channel first.
       */
      get_followed_thread_unread: {
        Args: { p_channel_id: string; p_user_id: string };
        Returns: FollowedThreadUnread[];
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
       * `20261106190000` (#585). Backwork search over title, course,
       * department, professor and tags, with trigram typo tolerance, ranked
       * word matches first. One chapter only; at most 50 rows.
       */
      search_backwork_resources: {
        Args: { p_chapter_id: string; p_query: string; p_limit?: number };
        Returns: BackworkResource[];
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
      get_poll_vote_option_totals: {
        Args: { p_message_ids: string[] };
        Returns: {
          message_id: string;
          option_index: number;
          vote_count: number;
        }[];
      };
      get_poll_user_votes_for_messages: {
        Args: { p_message_ids: string[]; p_user_id: string };
        Returns: {
          message_id: string;
          option_index: number;
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
      /** `20261110170000` (#3939) — `returns setof chapter_pledge_classes`. */
      reorder_chapter_pledge_classes: {
        Args: { p_chapter_id: string; p_ids: string[] };
        Returns: PledgeClass[];
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
      /** `20261110170000` (#3939) — `p_assignments` is `jsonb`; `returns setof members`. */
      assign_member_pledge_classes: {
        Args: { p_chapter_id: string; p_assignments: PledgeClassAssignment[] };
        Returns: Member[];
      };
      /** `20260602210000` — `returns setof tasks`. */
      confirm_task_completion: {
        Args: { p_task_id: string; p_chapter_id: string };
        Returns: Task[];
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
      leave_group_dm: {
        Args: {
          p_channel_id: string;
          p_chapter_id: string;
          p_user_id: string;
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
      /** `20260803140000` — `returns setof users`. */
      anonymize_user: {
        Args: { p_user_id: string; p_rescan_cards?: boolean };
        Returns: User[];
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
       * `20260929230000` (#2878). Removes the member's link in the chapter and
       * returns how many imported rows went back to their Discord name, or
       * null when there was no link.
       */
      unlink_discord_author: {
        Args: { p_chapter_id: string; p_user_id: string };
        Returns: number | null;
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
       * `20261105220000`. Deletes the channel groups a `purging` import
       * created that now hold no channel, and returns their ids. A no-op for
       * any other status.
       */
      delete_empty_discord_import_categories: {
        Args: { p_import_id: string; p_chapter_id: string };
        Returns: string[];
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
