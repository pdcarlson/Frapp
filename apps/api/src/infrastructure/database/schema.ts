import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  boolean,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const chapters = pgTable('chapters', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  university: text('university'),
  clerkOrganizationId: text('clerk_organization_id').unique(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  subscriptionStatus: text('subscription_status')
    .default('incomplete')
    .notNull(),
  subscriptionId: text('subscription_id').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const members = pgTable('members', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  roleIds: text('role_ids').array(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const invites = pgTable('invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  token: text('token').notNull().unique(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  role: text('role').default('member').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const backworkCourses = pgTable('backwork_courses', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const backworkProfessors = pgTable('backwork_professors', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const backworkResources = pgTable('backwork_resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  courseId: uuid('course_id')
    .notNull()
    .references(() => backworkCourses.id),
  professorId: uuid('professor_id')
    .notNull()
    .references(() => backworkProfessors.id),
  uploaderId: uuid('uploader_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  term: text('term').notNull(),
  s3Key: text('s3_key').notNull().unique(),
  fileHash: text('file_hash').notNull(),
  tags: text('tags').array().default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const pointTransactions = pgTable('point_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  amount: integer('amount').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  name: text('name').notNull(),
  description: text('description'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  pointValue: integer('point_value').default(10).notNull(),
  isMandatory: boolean('is_mandatory').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const eventAttendance = pgTable(
  'event_attendance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull(), // PRESENT, EXCUSED, ABSENT, LATE
    checkInTime: timestamp('check_in_time'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    unq: unique().on(t.eventId, t.userId),
  }),
);

export const pushTokens = pgTable('push_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  token: text('token').notNull().unique(),
  deviceName: text('device_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: jsonb('data'),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    category: text('category').notNull(), // e.g., 'CHAT', 'POINTS', 'EVENTS'
    isEnabled: boolean('is_enabled').default(true).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    unq: unique().on(t.userId, t.category),
  }),
);

export const chatChannels = pgTable('chat_channels', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').default('PUBLIC').notNull(), // PUBLIC, PRIVATE, ROLE_GATED
  allowedRoleIds: text('allowed_role_ids').array(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => chatChannels.id),
  senderId: uuid('sender_id')
    .notNull()
    .references(() => users.id),
  content: text('content').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const studyGeofences = pgTable('study_geofences', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  name: text('name').notNull(),
  coordinates: jsonb('coordinates').notNull(), // Array of {lat, lng}
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const studySessions = pgTable('study_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  geofenceId: uuid('geofence_id')
    .notNull()
    .references(() => studyGeofences.id),
  status: text('status').notNull(), // 'ACTIVE', 'COMPLETED', 'EXPIRED'
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
  lastHeartbeatAt: timestamp('last_heartbeat_at').notNull(),
  totalMinutes: integer('total_minutes').default(0).notNull(),
  pointsAwarded: boolean('points_awarded').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
