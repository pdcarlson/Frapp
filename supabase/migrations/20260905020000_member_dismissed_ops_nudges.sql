-- #492: per-user-per-chapter dismissal state for the ops-module setup nudges.
--
-- `spec/product/modules.md` § "Ops-setup nudges" requires the dismissed state
-- to be persisted **per user per chapter**: one officer dismissing a nudge
-- neither hides it from the rest of the exec board nor carries across their
-- other chapters. `members` is `unique (user_id, chapter_id)`, so it is that
-- grain by construction — the same reason `has_completed_onboarding` already
-- lives here rather than in `user_settings`, which is `unique (user_id)` and
-- is asserted chapter-independent by `tenant-scope-coverage.spec.ts`.
--
-- Values are `MODULE_CATALOG` keys ('dues', 'events', 'tasks', 'points'). Kept
-- as an unconstrained `text[]` rather than an enum or FK: the catalog is a
-- TypeScript constant with no table to reference, and a key retired from the
-- catalog should decay to an ignored array entry rather than break a write.
-- The API validates against the catalog before it writes.
--
-- Additive only — no existing column, table, or policy changes. Needs no
-- account-deletion wiring: the row already cascades from `users`, which is
-- why this grain was chosen over a new table.

alter table members
  add column if not exists dismissed_ops_nudges text[] not null default '{}';
