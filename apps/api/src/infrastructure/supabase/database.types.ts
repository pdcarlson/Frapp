import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BackworkDepartment,
  BackworkProfessor,
  BackworkResource,
  Chapter,
  ChapterActivationMilestone,
  ChapterAuditLog,
  ChapterCustomField,
  ChapterCustomRole,
  ChapterDirectoryEntry,
  ChapterDirectoryRequest,
  ChapterDocument,
  ChapterDocumentFolder,
  ChapterDuesConfig,
  ChapterServiceConfig,
  ChapterWorkflow,
  ChannelReadReceipt,
  ChatChannel,
  ChatChannelCategory,
  ChatMessage,
  ChatMessageAction,
  ChatMessageAttachment,
  ChatNotificationPreference,
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
  ScheduledNotificationDispatch,
  SemesterArchive,
  ServiceEntry,
  ServiceLeaderboardRow,
  StripeWebhookEvent,
  StudyGeofence,
  StudySession,
  Task,
  User,
  UserSettings,
} from '../../domain/entities';
import type { StripeWebhookClaimOutcome } from '../../domain/repositories/stripe-webhook-event.repository.interface';

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
      invites: TableDefinition<Invite>;
      backwork_departments: TableDefinition<BackworkDepartment>;
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
      message_reactions: TableDefinition<MessageReaction>;
      channel_read_receipts: TableDefinition<ChannelReadReceipt>;
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
      chapter_documents: TableDefinition<ChapterDocument>;
      chapter_document_folders: TableDefinition<ChapterDocumentFolder>;
      semester_archives: TableDefinition<SemesterArchive>;
      chapter_custom_roles: TableDefinition<ChapterCustomRole>;
      stripe_webhook_events: TableDefinition<StripeWebhookEvent>;
      chapter_audit_log: TableDefinition<ChapterAuditLog>;
      chapter_custom_fields: TableDefinition<ChapterCustomField>;
      chapter_workflows: TableDefinition<ChapterWorkflow>;
      chapter_dues_config: TableDefinition<ChapterDuesConfig>;
      chapter_service_config: TableDefinition<ChapterServiceConfig>;
      chapter_directory: TableDefinition<ChapterDirectoryEntry>;
      chapter_directory_requests: TableDefinition<ChapterDirectoryRequest>;
      chat_notification_preferences: TableDefinition<ChatNotificationPreference>;
      member_custom_field_values: TableDefinition<MemberCustomFieldValueRow>;
      scheduled_notification_dispatches: TableDefinition<ScheduledNotificationDispatch>;
      chapter_activation_milestones: TableDefinition<ChapterActivationMilestone>;
    };
    Views: Record<string, never>;
    Functions: {
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
       * `20250226120000`, re-signed by `20260604140000`: the old
       * `p_window text` overload is dropped, so this is the only signature.
       * `p_since` is an exclusive lower bound on `created_at`; null is
       * all-time.
       */
      get_points_report: {
        Args: {
          p_chapter_id: string;
          p_user_id?: string | null;
          p_since?: string | null;
        };
        Returns: {
          member_name: string;
          /** `bigint` in SQL; PostgREST serializes it as a JSON number. */
          total_points: number;
          breakdown_by_category: Record<string, number>;
        }[];
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
