import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';

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
