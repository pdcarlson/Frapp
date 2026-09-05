import {
  buildCustomFieldRows,
  slugifyFieldKey,
  SEED_SORT_BASE,
} from './custom-field-provisioning';
import { CUSTOM_FIELDS_SEED } from '@repo/org-archetypes';
import type { CustomFieldEntry } from '@repo/org-archetypes';

// The fixtures below exercise the mapping's branches; the `CUSTOM_FIELDS_SEED`
// block at the bottom pins the real seed, which `packages/org-archetypes` has
// no tests of its own for.
const CHAPTER = 'ch-1';

function entry(over: Partial<CustomFieldEntry> = {}): CustomFieldEntry {
  return {
    id: 'cf_1',
    label: 'Major',
    type: 'text',
    required: true,
    visibleTo: 'chapter',
    ...over,
  };
}

describe('slugifyFieldKey', () => {
  it.each([
    ['Major', 'major'],
    ['Graduation year', 'graduation_year'],
    ['T-shirt size', 't_shirt_size'],
    ['Emergency contact (name)', 'emergency_contact_name'],
    ['Emergency contact (phone)', 'emergency_contact_phone'],
    ['Cumulative GPA', 'cumulative_gpa'],
  ])('slugifies %j to %j', (label, expected) => {
    expect(slugifyFieldKey(label)).toBe(expected);
  });

  it('produces keys the create DTO would accept', () => {
    // CreateCustomFieldDto enforces /^[a-z0-9_]+$/ — a seeded row must be one
    // the Fields tab could also have produced, or it is unsaveable afterwards.
    for (const label of ['T-shirt size', 'Emergency contact (phone)', 'GPA?']) {
      expect(slugifyFieldKey(label)).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('collapses runs of separators and trims edge underscores', () => {
    expect(slugifyFieldKey('  Weird   --  Label!! ')).toBe('weird_label');
  });

  it('returns empty string when a label has no alphanumerics', () => {
    expect(slugifyFieldKey('!!!')).toBe('');
  });
});

describe('buildCustomFieldRows', () => {
  it('maps every seed attribute onto the row shape', () => {
    const { rows, skipped } = buildCustomFieldRows(CHAPTER, [
      entry({
        id: 'cf_3',
        label: 'Allergies',
        type: 'text',
        required: false,
        visibleTo: 'exec',
        sensitive: true,
      }),
    ]);

    expect(skipped).toEqual([]);
    expect(rows).toEqual([
      {
        chapter_id: CHAPTER,
        key: 'allergies',
        label: 'Allergies',
        type: 'text',
        required: false,
        // seed `visibleTo` lands on the column named `visibility`
        visibility: 'exec',
        sensitive: true,
        options: null,
        sort: 0,
      },
    ]);
  });

  it('defaults sensitive to false when the seed omits it', () => {
    const { rows } = buildCustomFieldRows(CHAPTER, [entry()]);
    expect(rows[0].sensitive).toBe(false);
  });

  it('assigns sort from array order', () => {
    const { rows } = buildCustomFieldRows(CHAPTER, [
      entry({ id: 'cf_1', label: 'One' }),
      entry({ id: 'cf_2', label: 'Two' }),
      entry({ id: 'cf_3', label: 'Three' }),
    ]);
    expect(rows.map((r) => r.sort)).toEqual([0, 1, 2]);
  });

  it('persists a select field with a non-empty options.choices', () => {
    const { rows, skipped } = buildCustomFieldRows(CHAPTER, [
      entry({
        id: 'cf_4',
        label: 'T-shirt size',
        type: 'select',
        required: false,
        options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
      }),
    ]);

    expect(skipped).toEqual([]);
    expect(rows[0].key).toBe('t_shirt_size');
    expect(rows[0].options).toEqual({
      choices: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    });
  });

  it('never shares an options reference with the seed entry', () => {
    // The seed is frozen and shared process-wide; a per-chapter edit reaching
    // back into it would corrupt every subsequently onboarded chapter.
    const choices = Object.freeze(['XS', 'S']) as unknown as string[];
    const seedEntry = entry({
      id: 'cf_4',
      label: 'T-shirt size',
      type: 'select',
      options: choices,
    });

    const { rows } = buildCustomFieldRows(CHAPTER, [seedEntry]);
    const written = rows[0].options as { choices: string[] };

    expect(written.choices).not.toBe(choices);
    expect(() => written.choices.push('M')).not.toThrow();
    expect(choices).toEqual(['XS', 'S']);
  });

  it('gives two chapters independent options structures', () => {
    const seedEntry = entry({
      id: 'cf_4',
      label: 'T-shirt size',
      type: 'select',
      options: ['XS', 'S'],
    });

    const a = buildCustomFieldRows('ch-a', [seedEntry]).rows[0].options as {
      choices: string[];
    };
    const b = buildCustomFieldRows('ch-b', [seedEntry]).rows[0].options as {
      choices: string[];
    };

    expect(a).not.toBe(b);
    a.choices.push('MUTATED');
    expect(b.choices).toEqual(['XS', 'S']);
  });

  it('skips a select entry carrying no choices rather than seeding it', () => {
    // The CRUD layer rejects a select with no choices on create AND update, so
    // an inserted one would be a row the Fields tab could never save again.
    const { rows, skipped } = buildCustomFieldRows(CHAPTER, [
      entry({ id: 'cf_4', label: 'Broken', type: 'select' }),
      entry({ id: 'cf_1', label: 'Major' }),
    ]);

    expect(skipped).toEqual([
      'cf_4: A select field requires a non-empty options.choices list',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('major');
    // The surviving entry keeps its original seed index, not a re-packed one.
    expect(rows[0].sort).toBe(1);
  });

  it('falls back to the seed id when a label yields no slug', () => {
    const { rows, skipped } = buildCustomFieldRows(CHAPTER, [
      entry({ id: 'cf_9', label: '???' }),
    ]);

    expect(skipped).toEqual([]);
    expect(rows[0].key).toBe('cf_9');
  });

  it('slugifies the fallback id rather than trusting it verbatim', () => {
    // `key` is immutable after creation and the create contract enforces
    // /^[a-z0-9_]+$/, so writing a raw `cf-9` would be a row no officer could
    // have made and that cannot be edited afterwards.
    const { rows, skipped } = buildCustomFieldRows(CHAPTER, [
      entry({ id: 'cf-9', label: '???' }),
    ]);

    expect(skipped).toEqual([]);
    expect(rows[0].key).toBe('cf_9');
  });

  it('skips an entry when neither its label nor its id yields a usable key', () => {
    const { rows, skipped } = buildCustomFieldRows(CHAPTER, [
      entry({ id: '???', label: '!!!' }),
    ]);

    expect(rows).toEqual([]);
    expect(skipped).toEqual([
      '???: no unused key could be derived from its label or id',
    ]);
  });

  it('skips a duplicate seed id instead of seeding two fields for it', () => {
    // Copy-pasting a seed line without bumping the id: the second entry's label
    // slug is taken, so it would otherwise fall back to the shared id -- which
    // nothing had reserved -- and land as a duplicate field, silently.
    const { rows, skipped } = buildCustomFieldRows(CHAPTER, [
      entry({ id: 'cf_5', label: 'Dietary' }),
      entry({ id: 'cf_5', label: 'Dietary' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(skipped).toEqual(['cf_5: duplicate seed id']);
  });

  it('falls back to the seed id when two labels slugify identically', () => {
    const { rows, skipped } = buildCustomFieldRows(CHAPTER, [
      entry({ id: 'cf_1', label: 'Major' }),
      entry({ id: 'cf_2', label: 'major' }),
    ]);

    expect(skipped).toEqual([]);
    expect(rows.map((r) => r.key)).toEqual(['major', 'cf_2']);
  });

  it('is deterministic — the same seed yields the same keys every run', () => {
    const seed = [
      entry({ id: 'cf_1', label: 'Major' }),
      entry({ id: 'cf_2', label: 'major' }),
      entry({ id: 'cf_9', label: '???' }),
    ];

    expect(buildCustomFieldRows(CHAPTER, seed)).toEqual(
      buildCustomFieldRows(CHAPTER, seed),
    );
  });

  it('produces unique keys, which is what (chapter_id, key) requires', () => {
    const { rows } = buildCustomFieldRows(CHAPTER, [
      entry({ id: 'cf_1', label: 'Major' }),
      entry({ id: 'cf_2', label: 'Major' }),
      entry({ id: 'cf_3', label: '???' }),
      entry({ id: 'cf_4', label: '!!!' }),
    ]);

    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns nothing for an empty seed', () => {
    expect(buildCustomFieldRows(CHAPTER, [])).toEqual({
      rows: [],
      skipped: [],
    });
  });
});

// The fixture tests above prove the mapping's branches; these prove the thing
// that actually ships. `packages/org-archetypes` has no test files, so without
// this block a bad seed edit -- a `select` with no choices, two labels
// slugifying together, a hyphenated id -- would be dropped from every newly
// onboarded chapter with nothing but a log line, and the suite would stay green.
describe('CUSTOM_FIELDS_SEED (the real seed, as shipped)', () => {
  const { rows, skipped } = buildCustomFieldRows(CHAPTER, CUSTOM_FIELDS_SEED);

  it('maps every entry — nothing is silently dropped', () => {
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(CUSTOM_FIELDS_SEED.length);
  });

  it('derives a unique, contract-legal key for every entry', () => {
    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9_]+$/);
  });

  it('gives every select entry a non-empty options.choices', () => {
    const selects = rows.filter((row) => row.type === 'select');
    expect(selects.length).toBeGreaterThan(0);
    for (const row of selects) {
      expect(
        (row.options as { choices: string[] }).choices.length,
      ).toBeGreaterThan(0);
    }
  });

  it('numbers sort contiguously from the seed base', () => {
    expect(rows.map((row) => row.sort)).toEqual(
      CUSTOM_FIELDS_SEED.map((_, index) => SEED_SORT_BASE + index),
    );
  });
});
