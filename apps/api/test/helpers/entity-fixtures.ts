import type { Chapter } from '#domain/entities/chapter.entity';
import type { Member } from '#domain/entities/member.entity';
import type { Role } from '#domain/entities/role.entity';
import type { User } from '#domain/entities/user.entity';

/**
 * The one complete-row factory per high-traffic entity (#3005).
 *
 * Since #2821 every spec is type-checked, so a full literal of an entity has
 * to carry every required field. Hand-written, that meant adding a required
 * column to `Member` touched eighty literals in thirteen files, and #2821 had
 * to codemod about 150 of them for two fields nobody had backfilled. Built
 * here, the next required field is one compile error in this file.
 *
 * Each default is what a freshly inserted row holds (the column defaults in
 * `supabase/migrations`: `subscription_status: 'incomplete'`,
 * `has_completed_onboarding: false`, `is_system: false`, empty arrays, null
 * nullable columns), plus stable placeholder ids that agree with one another
 * (`ch-1`, `user-1`, `member-1`, `role-1`). Anything a test depends on goes in
 * `overrides` at the call site, so a reader sees what the test exercises and a
 * change to a default can't silently move a test onto another path.
 *
 * Optional columns (`Chapter`'s customization and legal columns, `User`'s
 * legal ones) are left out, not nulled: narrower projections omit them, and
 * code under test distinguishes `undefined` from `null` there. Pass them as
 * overrides when a test needs them.
 *
 * A fixture that deliberately reads only a field or two keeps the partial
 * idiom (`{ id: 'ch-1' } as Chapter`) instead of building a full row.
 */

const CREATED_AT = '2024-01-01';

export function chapterFixture(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    name: 'Alpha',
    university: 'State U',
    stripe_customer_id: null,
    subscription_status: 'incomplete',
    subscription_id: null,
    past_due_since: null,
    last_stripe_webhook_at: null,
    accent_color: null,
    logo_path: null,
    donation_url: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

export function memberFixture(overrides: Partial<Member> = {}): Member {
  return {
    id: 'member-1',
    user_id: 'user-1',
    chapter_id: 'ch-1',
    role_ids: [],
    custom_role_ids: [],
    has_completed_onboarding: false,
    dismissed_ops_nudges: [],
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

/** Defaults to a custom role: `is_system: false`, `system_key: null`. */
export function roleFixture(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-1',
    chapter_id: 'ch-1',
    name: 'Custom',
    system_key: null,
    permissions: [],
    is_system: false,
    display_order: 0,
    color: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

export function userFixture(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    supabase_auth_id: 'auth-1',
    email: 'user-1@example.com',
    display_name: 'Test User',
    avatar_url: null,
    bio: null,
    graduation_year: null,
    current_city: null,
    current_company: null,
    active_chapter_id: null,
    deleted_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}
