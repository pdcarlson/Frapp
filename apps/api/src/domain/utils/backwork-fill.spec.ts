import { z } from 'zod';
import {
  BACKWORK_FILL_MAX_CHARS,
  BackworkFillOutputSchema,
  backworkFillSystem,
  backworkFillText,
  checkBackworkFill,
  type BackworkFillOutput,
  type BackworkFillTaxonomy,
} from './backwork-fill';

const TAXONOMY: BackworkFillTaxonomy = {
  departments: [{ id: 'd1', code: 'CHEM', name: 'Chemistry' }],
  courses: [
    {
      department_id: 'd1',
      course_number: '1010',
      name: 'General Chemistry I',
      nicknames: ['Gen Chem'],
    },
    { department_id: 'd1', course_number: '2080', name: null, nicknames: [] },
  ],
  professors: [{ name: 'Dr. Alvarez' }],
};

const EMPTY: BackworkFillOutput = {
  title: null,
  department_code: null,
  course_number: null,
  course_name: null,
  professor_name: null,
  year: null,
  semester: null,
  assignment_type: null,
  assignment_number: null,
  document_variant: null,
  tags: [],
};

function check(
  output: Partial<BackworkFillOutput>,
  draft: Record<string, unknown> = {},
  isRedacted = true,
) {
  return checkBackworkFill(
    { ...EMPTY, ...output },
    { draft, isRedacted, taxonomy: TAXONOMY, currentYear: 2026 },
  );
}

describe('backworkFillText', () => {
  it('labels pages and joins them', () => {
    const text = backworkFillText([
      { heading: null, page: 1, text: 'CHEM 1010   Exam 2, Spring 2024' },
      { heading: null, page: 2, text: '1. Balance the equation below.' },
    ]);
    expect(text).toBe(
      'Page 1:\nCHEM 1010 Exam 2, Spring 2024\n\nPage 2:\n1. Balance the equation below.',
    );
  });

  it('is empty for a file with almost no text, like a scan', () => {
    expect(backworkFillText([{ heading: null, page: 1, text: '  3  ' }])).toBe(
      '',
    );
  });

  it('stops at the character cap', () => {
    const page = 'word '.repeat(5_000);
    const text = backworkFillText([
      { heading: null, page: 1, text: page },
      { heading: null, page: 2, text: page },
    ]);
    expect(text.length).toBeLessThanOrEqual(BACKWORK_FILL_MAX_CHARS + 2);
    expect(text).not.toContain('Page 2:');
  });
});

describe('BackworkFillOutputSchema', () => {
  it('converts to JSON Schema, as the gateway needs', () => {
    expect(() => z.toJSONSchema(BackworkFillOutputSchema)).not.toThrow();
  });
});

describe('backworkFillSystem', () => {
  it("lists the chapter's courses with their department code and names", () => {
    const system = backworkFillSystem(TAXONOMY, 2026);
    expect(system).toContain('CHEM 1010 (General Chemistry I; Gen Chem)');
    expect(system).toContain('Dr. Alvarez');
    expect(system).toContain('between 1950 and 2026');
  });

  it('says when a list is empty', () => {
    const system = backworkFillSystem(
      { departments: [], courses: [], professors: [] },
      2026,
    );
    expect(system).toContain('(none yet)');
  });
});

describe('checkBackworkFill', () => {
  it("uses the chapter's spelling for a known department, course and professor", () => {
    const { fields, filled } = check({
      department_code: 'chem',
      course_number: '1010',
      course_name: 'Gen Chem',
      professor_name: 'dr. alvarez',
    });
    expect(fields).toEqual({
      department_code: 'CHEM',
      course_number: '1010',
      professor_name: 'Dr. Alvarez',
    });
    // The course already has a name; the fill never renames one.
    expect(filled).not.toContain('course_name');
  });

  it('proposes a name for a known course that has none, and new codes upper-cased', () => {
    expect(
      check({
        department_code: 'chem',
        course_number: '2080',
        course_name: 'Organic',
      }).fields.course_name,
    ).toBe('Organic');
    expect(check({ department_code: ' bio ' }).fields.department_code).toBe(
      'BIO',
    );
  });

  it('never replaces a field the draft already has', () => {
    const { fields, filled } = check(
      {
        title: 'CHEM 1010 Exam 2',
        year: 2024,
        semester: 'Spring',
        tags: ['acids'],
      },
      { title: 'My title', year: 2023 },
    );
    expect(fields).toEqual({ semester: 'Spring', tags: ['acids'] });
    expect(filled).toEqual(['semester', 'tags']);
  });

  it('fills a field the draft has only as a blank', () => {
    expect(check({ title: 'Quiz 3' }, { title: '  ' }).fields.title).toBe(
      'Quiz 3',
    );
  });

  it('drops values outside their bounds', () => {
    expect(check({ year: 2031 }).fields).toEqual({});
    expect(check({ year: 1900 }).fields).toEqual({});
    expect(check({ assignment_number: 0 }).fields).toEqual({});
    expect(check({ assignment_number: 400 }).fields).toEqual({});
  });

  it('does not propose a Student Copy for a file uploaded as-is', () => {
    expect(
      check({ document_variant: 'Student Copy' }, {}, false).fields,
    ).toEqual({});
    expect(
      check({ document_variant: 'Student Copy' }, {}, true).fields,
    ).toEqual({ document_variant: 'Student Copy' });
  });

  it('lower-cases and de-duplicates tags', () => {
    expect(
      check({ tags: ['Acids', 'acids ', '', 'Bases'] }).fields.tags,
    ).toEqual(['acids', 'bases']);
  });

  it('proposes nothing from an empty answer', () => {
    expect(check({})).toEqual({ fields: {}, filled: [] });
  });
});
