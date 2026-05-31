import { Test, TestingModule } from '@nestjs/testing';
import { CustomFieldService } from './custom-field.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { CustomFieldVisibility } from '../../domain/entities/chapter-custom-field.entity';

const CHAPTER_ID = 'chapter-1';
const MEMBER_ID = 'member-1';

/**
 * Per-table thenable builder: every chain method (select/eq/in/order) returns
 * the same builder, and awaiting it resolves with the configured result. This
 * covers both terminal shapes `findVisibleValuesForMember` uses — `.order()`
 * (definitions) and `.eq()` (values).
 */
function makeSupabase(opts: {
  defs?: unknown[];
  values?: { field_id: string; value: string | null }[];
}) {
  // Capture the `.in('visibility', [...])` argument so tests can assert that
  // out-of-tier definitions are never even queried.
  const inCalls: { column: string; values: unknown }[] = [];

  function builder(result: { data: unknown; error: unknown }) {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = jest.fn(chain);
    b.eq = jest.fn(chain);
    b.order = jest.fn(chain);
    b.in = jest.fn((column: string, values: unknown) => {
      inCalls.push({ column, values });
      return b;
    });
    b.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return b;
  }

  const from = jest.fn((table: string) => {
    if (table === 'chapter_custom_fields') {
      return builder({ data: opts.defs ?? [], error: null });
    }
    if (table === 'member_custom_field_values') {
      return builder({ data: opts.values ?? [], error: null });
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { client: { from } as never, inCalls };
}

describe('CustomFieldService.findVisibleValuesForMember', () => {
  async function build(supabase: never): Promise<CustomFieldService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomFieldService,
        { provide: SUPABASE_CLIENT, useValue: supabase },
      ],
    }).compile();
    return module.get(CustomFieldService);
  }

  it('only queries definitions in the allowed visibility set', async () => {
    const { client, inCalls } = makeSupabase({ defs: [], values: [] });
    const service = await build(client);

    const allowed = new Set<CustomFieldVisibility>(['chapter']);
    await service.findVisibleValuesForMember(CHAPTER_ID, MEMBER_ID, allowed);

    expect(inCalls).toHaveLength(1);
    expect(inCalls[0]).toEqual({ column: 'visibility', values: ['chapter'] });
  });

  it('joins each visible definition to the member value (null when unset)', async () => {
    const defs = [
      {
        id: 'f1',
        key: 'gpa',
        label: 'GPA',
        type: 'decimal',
        visibility: 'chapter',
      },
      {
        id: 'f2',
        key: 'major',
        label: 'Major',
        type: 'text',
        visibility: 'chapter',
      },
    ];
    const { client } = makeSupabase({
      defs,
      values: [{ field_id: 'f1', value: '3.9' }],
    });
    const service = await build(client);

    const result = await service.findVisibleValuesForMember(
      CHAPTER_ID,
      MEMBER_ID,
      new Set<CustomFieldVisibility>(['chapter']),
    );

    expect(result).toEqual([
      {
        field_id: 'f1',
        key: 'gpa',
        label: 'GPA',
        type: 'decimal',
        visibility: 'chapter',
        value: '3.9',
      },
      {
        field_id: 'f2',
        key: 'major',
        label: 'Major',
        type: 'text',
        visibility: 'chapter',
        value: null,
      },
    ]);
  });

  it('restricts the value lookup to the visibility-filtered field IDs', async () => {
    // Defense-in-depth: out-of-tier / sensitive values are never even selected
    // server-side — the value query is narrowed to the visible definitions.
    const defs = [
      {
        id: 'f1',
        key: 'gpa',
        label: 'GPA',
        type: 'decimal',
        visibility: 'chapter',
      },
      {
        id: 'f2',
        key: 'major',
        label: 'Major',
        type: 'text',
        visibility: 'chapter',
      },
    ];
    const { client, inCalls } = makeSupabase({ defs, values: [] });
    const service = await build(client);

    await service.findVisibleValuesForMember(
      CHAPTER_ID,
      MEMBER_ID,
      new Set<CustomFieldVisibility>(['chapter']),
    );

    expect(inCalls).toContainEqual({
      column: 'field_id',
      values: ['f1', 'f2'],
    });
  });

  it('short-circuits to empty (no query) when no visibility tier is allowed', async () => {
    const { client, inCalls } = makeSupabase({ defs: [{ id: 'f1' }] });
    const service = await build(client);

    const result = await service.findVisibleValuesForMember(
      CHAPTER_ID,
      MEMBER_ID,
      new Set(),
    );

    expect(result).toEqual([]);
    expect(inCalls).toHaveLength(0);
  });
});
