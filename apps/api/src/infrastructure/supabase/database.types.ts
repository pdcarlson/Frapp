import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BackworkDepartment,
  BackworkProfessor,
  BackworkResource,
  Chapter,
  ChapterDocument,
  ChannelReadReceipt,
  ChatChannel,
  ChatChannelCategory,
  ChatMessage,
  Event,
  EventAttendance,
  FinancialInvoice,
  FinancialTransaction,
  Invite,
  Member,
  MessageReaction,
  Notification,
  NotificationPreference,
  PointTransaction,
  PollVote,
  PushToken,
  Role,
  SemesterArchive,
  ServiceEntry,
  StudyGeofence,
  StudySession,
  Task,
  User,
  UserSettings,
} from '../../domain/entities';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TableDefinition<Row> = {
  Row: Row;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
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
      semester_archives: TableDefinition<SemesterArchive>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type FrappSupabaseClient = SupabaseClient<Database>;
