import type { CustomFieldEntry } from '@repo/org-archetypes';
import type { TablesInsert } from '../../infrastructure/supabase/database.types';

/**
 * Maps the archetype's `CUSTOM_FIELDS_SEED` entries onto `chapter_custom_fields`
 * rows for a newly onboarded chapter (#572).
 *
 * The seed model and the persistence model differ, so the mapping is explicit:
 *   seed `id`        → `key` (via {@link slugifyFieldKey}, `id` as fallback)
 *   seed `visibleTo` → `visibility`
 *   seed `options`   → `options.choices` (jsonb)
 *   array order      → `sort`
 *
 * Kept as a pure function — separate from the service that writes it — so the
 * mapping is testable without a Supabase double.
 */

/** Runs of anything outside the `key` charset collapse to a single underscore. */
const NON_KEY_CHARS = /[^a-z0-9]+/g;
const EDGE_UNDERSCORES = /^_+|_+$/g;

/**
 * Derive a `chapter_custom_fields.key` from a seed label.
 *
 * `key` must match `/^[a-z0-9_]+$/` (CreateCustomFieldDto) and is immutable
 * after creation. A label slug — `"T-shirt size"` → `t_shirt_size` — is what an
 * officer creating the same field by hand through the Fields tab would produce,
 * which keeps seeded and hand-made rows indistinguishable.
 *
 * Returns `''` for a label with no alphanumerics; callers fall back to the seed
 * `id`, which is already a valid slug.
 */
export function slugifyFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(NON_KEY_CHARS, '_')
    .replace(EDGE_UNDERSCORES, '');
}

export type CustomFieldSeedRows = {
  rows: TablesInsert<'chapter_custom_fields'>[];
  /** Seed ids dropped as malformed, for the caller to log. */
  skipped: string[];
};

/**
 * Build the insert rows for one chapter's seeded custom fields.
 *
 * A `select` entry carrying no choices is **skipped rather than inserted**: the
 * CRUD layer rejects that shape on both create and update
 * (`CustomFieldService.create`), so persisting one here would seed a row the
 * Fields tab could never save again. Skipping one malformed entry still seeds
 * the rest, which is why this reports them instead of throwing.
 */
export function buildCustomFieldRows(
  chapterId: string,
  entries: readonly CustomFieldEntry[],
): CustomFieldSeedRows {
  const rows: TablesInsert<'chapter_custom_fields'>[] = [];
  const skipped: string[] = [];
  const usedKeys = new Set<string>();

  entries.forEach((entry, index) => {
    const isSelect = entry.type === 'select';
    const choices = entry.options ?? [];
    if (isSelect && choices.length === 0) {
      skipped.push(entry.id);
      return;
    }

    // Prefer the label slug; fall back to the seed id when the label yields no
    // slug or when an earlier entry already took it. Both branches are
    // deterministic, so re-running provisioning derives the same keys.
    const slug = slugifyFieldKey(entry.label);
    const key = !slug || usedKeys.has(slug) ? entry.id : slug;
    if (usedKeys.has(key)) {
      skipped.push(entry.id);
      return;
    }
    usedKeys.add(key);

    rows.push({
      chapter_id: chapterId,
      key,
      label: entry.label,
      type: entry.type,
      required: entry.required,
      visibility: entry.visibleTo,
      sensitive: entry.sensitive ?? false,
      // A freshly built object over a copied array — the persisted jsonb shares
      // no reference with the frozen seed, so a later per-chapter edit can never
      // reach back into `CUSTOM_FIELDS_SEED` or another chapter's row. (The
      // sibling CRUD path deep-clones instead because its input is an arbitrary
      // caller-supplied DTO; here the wrapper is constructed from a string list.)
      options: choices.length > 0 ? { choices: [...choices] } : null,
      sort: index,
    });
  });

  return { rows, skipped };
}
