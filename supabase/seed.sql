-- Frapp: Seed Data
-- This file is run after migrations during `supabase db reset`.
-- It seeds default data used for local development and testing.

-- Note: Default system roles are seeded per-chapter at chapter creation time
-- by the API (ChapterOnboardingService). This file is kept minimal.
-- In production, the API handles all seeding logic.

-- The system role templates below are for reference only.
-- They document the default permission sets defined in spec/behavior.md Section 2.

/*
Default system roles seeded on chapter creation:

1. President (is_system: true, display_order: 1)
   permissions: ['*']

2. Treasurer (is_system: true, display_order: 2)
   permissions: ['billing:view', 'billing:manage', 'points:adjust', 'points:view_all',
                 'polls:view_all', 'members:view', 'reports:export', 'events:create', 'events:update']

3. Vice President (is_system: true, display_order: 3)
   permissions: ['members:view', 'polls:view_all']

4. Secretary (is_system: true, display_order: 4)
   permissions: ['members:view', 'polls:view_all']

5. Member (is_system: true, display_order: 5)
   permissions: ['members:view', 'backwork:upload', 'service:log', 'polls:create']

6. New Member (is_system: true, display_order: 6)
   permissions: ['members:view', 'backwork:upload']

7. Alumni (is_system: true, display_order: 7)
   permissions: ['members:view']

Default channels seeded on chapter creation:
- #general (PUBLIC)
- #announcements (PUBLIC, is_read_only: true)
- #alumni (ROLE_GATED, required_permissions: ['alumni_channel_access'])
*/
