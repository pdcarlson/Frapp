import {
  buildCustomFieldRows,
  slugifyFieldKey,
} from './custom-field-provisioning';
import type { CustomFieldEntry } from '@repo/org-archetypes';

// `@repo/org-archetypes` ships ESM-only dist that the API's jest setup doesn't
// transform, and the module under test imports only its *types* (erased at
// compile time). So these fixtures mirror the real CUSTOM_FIELDS_SEED shape
// rather than importing it — the mapping is what's under test here, not the
// seed's contents.
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

    expect(skipped).toEqual(['cf_4']);
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
    expect(rows[0].key).toMatch(/^[a-z0-9_]+$/);
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
