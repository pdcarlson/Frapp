-- Free-to-paid activation funnel (#267).
--
-- One row the first time a chapter reaches an activation milestone, and never
-- again. The unique key IS the "first" semantics: the API attempts an insert on
-- every candidate action, and whether the insert *wins* is what distinguishes
-- "first invite created" from the four hundredth. Nothing has to read-then-write
-- and race, and nothing has to ask the analytics provider what it has seen
-- before.
--
-- Why a table at all, when events already go to PostHog:
--
--  * The analytics event is emitted only when the row is won, so a Stripe
--    webhook redelivery or a client retry cannot double-count a milestone.
--    Idempotence lives here rather than in each of the seven call sites.
--  * Conversion between milestones stays answerable in plain SQL with
--    POSTHOG_API_KEY unset — local, CI, and any environment where the
--    provider-side automation is unverified (#709). The funnel is a product
--    question; it should not be answerable only through a vendor.
--
-- Bookkeeping, not member data: nothing here is user-visible and no row carries
-- a user id. `chapter_id` is the only identifier, and it never leaves the
-- database in raw form — the analytics event carries an HMAC of it, per
-- spec/behavior/observability.md.

create table chapter_activation_milestones (
  id           uuid        primary key default gen_random_uuid(),
  chapter_id   uuid        not null references chapters (id) on delete cascade,
  -- Values come from ACTIVATION_MILESTONES in @repo/validation and are used
  -- verbatim as analytics event names too. Constrained rather than free text so
  -- a typo at a call site fails loudly instead of creating a phantom step that
  -- silently reads as 0% conversion.
  milestone    text        not null
                 check (milestone in (
                   'activation-onboarding-submitted',
                   'activation-first-invite-created',
                   'activation-first-invite-redeemed',
                   'activation-first-chat-message',
                   'activation-first-paid-module-enabled',
                   'activation-checkout-started',
                   'activation-checkout-completed'
                 )),
  occurred_at  timestamptz not null default now(),

  -- The whole mechanism. Insert-once per chapter per milestone.
  unique (chapter_id, milestone)
);

-- Funnel queries scan by milestone and bucket by time ("how many chapters
-- reached step N in July"), which is the opposite order from the unique index's
-- (chapter_id, milestone) leading column.
create index idx_chapter_activation_milestones_milestone_occurred
  on chapter_activation_milestones (milestone, occurred_at);

alter table chapter_activation_milestones enable row level security;
-- No client policies, matching stripe_webhook_events and
-- chapter_directory_requests: rows are written exclusively by the API through
-- the service-role client, and read by operators via SQL. Default-deny with
-- zero policies is the entire access model. A member has no reason to read
-- another chapter's activation timeline, and no reason to write their own.
