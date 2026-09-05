import { CreateCustomFieldSchema } from '@repo/validation';
import type { CustomFieldEntry } from '@repo/org-archetypes';
import type { TablesInsert } from '../../infrastructure/supabase/database.types';

/**
 * Maps the archetype's `CUSTOM_FIELDS_SEED` entries onto `chapter_custom_fields`
 * rows for a newly onboarded chapter (#572).
 *
 * The seed model and the persistence model differ, so the mapping is explicit:
 *   seed `id`        → `key` (via {@link slugifyFieldKey}, slugified id as fallback)
 *   seed `visibleTo` → `visibility`
 *   seed `options`   → `options.choices` (jsonb)
 *   array order      → `sort`
 *
 * Every candidate row is validated with `CreateCustomFieldSchema` — the same
 * shared schema the `POST /custom-fields` contract uses — rather than
 * re-implementing the key charset and select-requires-choices rules here. A
 * seeded row is therefore always one the Fields tab could also have created,
 * and the seed path cannot drift from the CRUD boundary as that schema tightens.
 *
 * Kept as a pure function — separate from the service that writes it — so the
 * mapping is testable without a Supabase double.
 */

/** Runs of anything outside the `key` charset collapse to a single underscore. */
const NON_KEY_CHARS = /[^a-z0-9]+/g;
const EDGE_UNDERSCORES = /^_+|_+$/g;

/**
 * Where seeded `sort` values start. `CustomFieldService.create` appends a
 * hand-added field at `max(sort) + 1`, so seeded and hand-added rows share one
 * ascending sequence and the Fields tab always appends at the bottom.
 */
export const SEED_SORT_BASE = 0;

/**
 * Derive a `chapter_custom_fields.key` from a seed label.
 *
 * `key` must match `/^[a-z0-9_]+$/` and is immutable after creation, so this
 * only ever produces characters in that set. Returns `''` for a label with no
 * alphanumerics; callers fall back to the slugified seed id.
 */
export function slugifyFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(NON_KEY_CHARS, '_')
    .replace(EDGE_UNDERSCORES, '');
}

export type CustomFieldSeedRows = {
  rows: TablesInsert<'chapter_custom_fields'>[];
  /**
   * Entries that could not be turned into a row, as `<id>: <reason>`. Always a
   * bug in `CUSTOM_FIELDS_SEED` itself rather than anything a chapter did, so
   * the caller logs them and seeds the rest.
   */
  skipped: string[];
};

/**
 * First key derived from `entry` that is well-formed and not already taken:
 * the label slug, else the slugified seed id. Returns `''` when neither
 * yields an unused key, which the caller reports rather than guessing.
 *
 * The id is slugified rather than trusted verbatim — nothing constrains the
 * shape of a seed id, and an id like `cf-9` would otherwise be written as a
 * `key` that `CreateCustomFieldSchema` rejects and that is immutable once
 * stored.
 */
function deriveKey(entry: CustomFieldEntry, usedKeys: Set<string>): string {
  const candidates = [slugifyFieldKey(entry.label), slugifyFieldKey(entry.id)];
  return candidates.find((key) => key && !usedKeys.has(key)) ?? '';
}

/** Build the insert rows for one chapter's seeded custom fields. */
export function buildCustomFieldRows(
  chapterId: string,
  entries: readonly CustomFieldEntry[],
): CustomFieldSeedRows {
  const rows: TablesInsert<'chapter_custom_fields'>[] = [];
  const skipped: string[] = [];
  const usedKeys = new Set<string>();
  const seenIds = new Set<string>();

  entries.forEach((entry, index) => {
    // Two entries sharing an id is a copy-paste bug in the seed. Without this
    // the second one still lands (its label slug is taken, so it falls back to
    // the shared id, which nothing has reserved) and every chapter gets a
    // duplicate field with no warning.
    if (seenIds.has(entry.id)) {
      skipped.push(`${entry.id}: duplicate seed id`);
      return;
    }
    seenIds.add(entry.id);

    const key = deriveKey(entry, usedKeys);
    if (!key) {
      skipped.push(
        `${entry.id}: no unused key could be derived from its label or id`,
      );
      return;
    }

    const candidate = {
      key,
      label: entry.label,
      type: entry.type,
      required: entry.required,
      visibility: entry.visibleTo,
      sensitive: entry.sensitive ?? false,
      // A freshly built object over a copied array — the persisted jsonb shares
      // no reference with the frozen seed, so a later per-chapter edit can never
      // reach back into `CUSTOM_FIELDS_SEED` or another chapter's row.
      ...(entry.options?.length
        ? { options: { choices: [...entry.options] } }
        : {}),
      sort: SEED_SORT_BASE + index,
    };

    // The shared contract schema is the single source of the key charset and
    // the select-requires-choices rule; `chapter_id` is ours, not the body's.
    const parsed = CreateCustomFieldSchema.safeParse(candidate);
    if (!parsed.success) {
      skipped.push(
        `${entry.id}: ${parsed.error.issues[0]?.message ?? 'failed CreateCustomFieldSchema'}`,
      );
      return;
    }

    usedKeys.add(key);
    rows.push({
      chapter_id: chapterId,
      ...candidate,
      options: candidate.options ?? null,
    });
  });

  return { rows, skipped };
}
