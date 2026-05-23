# Chunk 02 — Data model + chapter directory + org-config + Edge Function scaffold

**Depends on:** Chunk 01 (merged).
**Unblocks:** 03, 04, 06, 09.

## Read first

1. `docs/internal/redesign/master-plan.md` — sections *Data model*, *API surface*, *System architecture for the chat hot path*, *Theming model*.
2. `design-handoff/project/org-config.jsx` (landed in Chunk 01) — the source for the TS port.
3. `apps/api/src/modules/` — at least one existing NestJS module to mirror style (look for one with REST + DTOs + guards).
4. `supabase/migrations/` — see how existing migrations are organized + named.
5. `packages/theme/src/accent.ts` — WCAG helper you'll reuse in `packages/chapter-theme/`.
6. `spec/architecture.md` (you will update it).
7. **`docs/internal/redesign/master-plan.md` → *Engineering principles*.** Non-negotiable for every chunk; the bullets below are this chunk's specific applications.

## Engineering principles applied here

- **`packages/org-archetypes/` exports are immutable; deep-clone on materialization.** The seed exports (`ARCHETYPES`, `MODULE_CATALOG`, `ROLE_PACKS`, `CUSTOM_FIELDS_SEED`, `WORKFLOWS_SEED`, `VOCABULARY_DEFAULTS`) are read-only references — freeze them with `Object.freeze` at the leaf level (or export `as const`). Any function that builds a chapter's initial config from a seed (`buildChapterConfigFromArchetype`, `seedCustomFields`, etc.) **must `structuredClone` the seed objects** so per-chapter edits never mutate the shared reference. The prototype's `org-config.jsx` uses `[...CUSTOM_FIELDS_SEED]` (shallow) — do not port that pattern.
- **`getArchetype(key)` / `getRolePack(key)` / `getModuleCatalogEntry(key)` helpers guard for missing keys** and return a defined fallback (default to the `ifc` archetype / always-on module set / archetype-default role pack). Document the fallback in the helper's JSDoc. Direct subscript like `ARCHETYPES[org.archetype]` without a fallback is forbidden — every consumer goes through the helper.
- **`packages/validation/` Zod schemas reject `NaN` and negative amounts** for any cents column (`active_amount_cents`, `late_fee_cents`, …). Use `z.number().int().nonnegative()` rather than `z.number()`. The cold-path API + Edge Functions both import these — input that would have produced NaN in the prototype is rejected at the boundary.
- **No `window.*` globals in the shared packages.** ES module exports only; the API and Edge Function imports must work without a DOM. The prototype assigns `window.ORG_ARCHETYPES`, `window.EVENTS_SEED`, etc. for static HTML hosting — the real packages do not.

## Branch

`claude/redesign-chunk-02-data-edge` — branch from `main`.

## Goal

Ship the database schema, the cold-path API endpoints, shared TS packages (`org-archetypes`, `chapter-theme`, `validation`), and the Edge Function scaffolds for the chat hot path. **No UI changes in this chunk.** Verify with curl + `supabase functions serve`.

## Tasks

### Migrations (use today's date in `YYYYMMDD` form)

1. **`<date>_chapter_customization.sql`** — new columns on `chapters` (see master plan *Data model*) and tables: `chapter_custom_fields`, `chapter_custom_roles`, `chapter_workflows`, `chapter_dues_config`. RLS via existing chapter membership pattern.
2. **`<date>_audit_log.sql`** — `chapter_audit_log` table + RLS + indexes on `(chapter_id, created_at desc)` and `(actor_user_id, created_at desc)`.
3. **`<date>_chapter_directory.sql`** — `chapter_directory` table. Loader script `supabase/seed/chapter_directory.csv` (~2000 row CSV; if not available, ship 50 well-known chapters as placeholder and file an issue). Indexes: `(university_short, org_letters)` and full-text on combined name.
4. **`<date>_chat_hotpath.sql`**:
   - `chat_messages.kind text not null default 'text'`, `payload jsonb`, `client_message_id text`, `deleted_at timestamptz`.
   - Unique index `(chapter_id, sender_id, client_message_id)` (partial: where `client_message_id is not null`).
   - Compound index `(chapter_id, channel_id, created_at desc)`.
   - New `chat_message_actions` table `(id, message_id, user_id, action_type, payload jsonb, created_at)` with indexes `(message_id, user_id)` and `(user_id, action_type, created_at desc)`.
   - RLS: select + insert for chapter members; soft-delete for admins only.

### Shared packages

5. **`packages/org-archetypes/`** — TS port of `design-handoff/project/org-config.jsx`. Export `ARCHETYPES`, `MODULE_CATALOG` (revised — see master plan *Module catalog*), `ROLE_PACKS`, `CUSTOM_FIELDS_SEED`, `WORKFLOWS_SEED`, `VOCABULARY_DEFAULTS`. Set up so it's consumable by web, mobile, and API (check `packages/theme/package.json` for the existing convention).
6. **`packages/chapter-theme/`** — `derivePalette({dark, accent})` returning the token map listed in master plan *Theming model*. Uses `packages/theme/src/accent.ts` for WCAG. Falls back to bronze for failing tokens only.
7. **`packages/validation/`** — **already exists** at `packages/validation/src/index.ts` (Chunk 01 added `CurrentChapterPayloadSchema` there). Extend it; do not recreate the package. Add `chapter-config` + `chat-messages` Zod schemas. **These schemas are imported by NestJS *and* by Edge Functions** — keep them dependency-light so the Deno import works. (`@repo/hooks` similarly already exists — `useCurrentChapter` lives in `packages/hooks/src/use-chapters.ts`; extend rather than recreate any hook you need.)

### NestJS modules (cold path only)

8. **`apps/api/src/modules/chapter-config/`** — `GET /chapters/:id/config` returns merged archetype defaults + chapter overrides; `PATCH /chapters/:id/config` writes diff to `chapter_audit_log` and (best-effort) posts a `system_audit` message into `#chapter-audit` for the chapter.
9. **`apps/api/src/modules/chapter-directory/`** — `GET /chapter-directory/search?q=...&university=...` returns top 20 matches.
10. **`apps/api/src/modules/chat/`** — REST backfill only: `GET /chat/channels/:id/messages?since=<id>&limit=<n>`. **Do not add hot-path POST routes here** — those live in Edge Functions.
11. **`POST /chapters/:id/theme-palette`** in `chapter-config` module — recomputes derived palette from `branding.colors`, persists to `chapters.theme_palette`, returns the token map.

### Edge Functions (Deno)

12. **`supabase/functions/chat-send/`** — POST handler: validate via Zod (from `packages/validation`), insert with `client_message_id` dedupe (use `ON CONFLICT DO NOTHING RETURNING *`, then `SELECT` the existing row if no insert), broadcast via Supabase Realtime. One happy-path test + one dedupe test.
13. **`supabase/functions/chat-react/`** — POST handler: insert into `chat_message_actions` with idempotent unique-key dedupe.

### Hooks + helpers (web)

14. `apps/web/lib/hooks/use-org-config.ts` — TanStack Query wrapper around `GET /chapters/:id/config`. Returns merged config + per-chapter overrides + helpers.
15. `apps/web/lib/hooks/use-chapter-theme.ts` — fetches `chapters.theme_palette`, writes CSS vars on `:root` per active chapter.
16. `apps/web/lib/vocabulary.ts` — `vocab(key, chapterConfig)` helper.
17. **Wire `ChapterLockup` to real branding.** Chunk 01 shipped `apps/web/components/layout/chapter-lockup.tsx` with `designation` hardcoded `null` and the crest derived from name-initials, because `chapters.branding` didn't exist yet. Now that this chunk adds the `branding` jsonb (`greek_letters`, `designation`, `school_short`), extend the current-chapter payload (`CurrentChapterPayloadSchema` + the endpoint that feeds it) to include those fields, and update `ChapterLockup` to render `greek_letters` as the crest, plus the real `designation` and `school_short`. Keep the existing four states (loaded / pending / load-failed / empty) and the initials fallback for chapters whose branding is still empty.

### Spec updates

17. `spec/architecture.md` — add the four ADRs from master plan *System architecture* (hot/cold split, Broadcast for presence, optimistic+idempotent UUIDs, presence-aware push).
18. `spec/behavior.md` — chapter config endpoints, directory search shape, chat message kinds + actions.
19. `spec/product.md` — module catalog (always-on vs paid).

## Verification

- [ ] Migrations run cleanly on a fresh local Supabase (`npx supabase db reset`).
- [ ] `curl 'http://localhost:3001/chapter-directory/search?q=sigma+phi'` returns matches.
- [ ] `curl 'http://localhost:3001/chapters/<id>/config'` returns the merged shape (defaults + overrides).
- [ ] `supabase functions serve chat-send`; POST a message with a `client_message_id` → row inserted; POST same payload twice → only one row (verify in DB).
- [ ] In a node REPL or quick script: `derivePalette({dark:'#2A1A2E', accent:'#C49A3A'})` returns a full token map with WCAG-validated values.
- [ ] `npm run typecheck` passes across the workspace; `packages/validation` is consumable from both NestJS and Deno (note any caveats in the PR body).

## Handoff

- Commit per concern (migrations / packages / api / edge functions / docs).
- Push: `git push -u origin claude/redesign-chunk-02-data-edge`.
- PR title: `Chunk 02 — Data model + chapter directory + Edge Function scaffold`. Body: link this brief, paste the four curl outputs, mention any Deno import gotchas.
- Update `STATUS.md`.
