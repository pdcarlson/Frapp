import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CustomFieldService } from './custom-field.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

const CHAPTER_ID = 'chapter-1';
const ACTOR_ID = 'user-1';

type AuditRow = Record<string, unknown>;

/**
 * Builds a Supabase test double tailored to the chains CustomFieldService uses:
 * - chapter_custom_fields: insert/update/delete + select/maybeSingle/order
 * - chapter_audit_log: insert (captured)
 */
function makeSupabase(opts: {
  /** Row returned by the single-row read used before update/delete. */
  existingField?: Record<string, unknown> | null;
  /** Result of insert().select().single() on chapter_custom_fields. */
  insertResult?: { data?: unknown; error?: unknown };
  /** Result of update().eq().eq().select().single(). */
  updateResult?: { data?: unknown; error?: unknown };
  /** Rows returned by the list query. */
  listRows?: unknown[];
}) {
  const auditInserts: AuditRow[] = [];
  const customFieldInsert = jest.fn();

  const from = jest.fn((table: string) => {
    if (table === 'chapter_audit_log') {
      return {
        insert: jest.fn((row: AuditRow) => {
          auditInserts.push(row);
          return Promise.resolve({ error: null });
        }),
      };
    }

    if (table === 'chapter_custom_fields') {
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn(() => builder);
      // findByChapter chains .order().order() — the second order resolves.
      builder.order = jest.fn(() => {
        const resolved = Promise.resolve({
          data: opts.listRows ?? [],
          error: null,
        });
        return Object.assign(resolved, { order: jest.fn(() => resolved) });
      });
      builder.eq = jest.fn(() => builder);
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: opts.existingField ?? null, error: null }),
      );
      builder.single = jest.fn(() =>
        Promise.resolve(
          opts.updateResult ?? opts.insertResult ?? { data: null, error: null },
        ),
      );
      builder.insert = jest.fn((payload: unknown) => {
        customFieldInsert(payload);
        return builder;
      });
      builder.update = jest.fn(() => builder);
      builder.delete = jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        })),
      }));
      return builder;
    }

    return {};
  });

  return { from, auditInserts, customFieldInsert };
}

async function buildService(supabase: { from: jest.Mock }) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CustomFieldService,
      { provide: SUPABASE_CLIENT, useValue: supabase },
    ],
  }).compile();
  return module.get(CustomFieldService);
}

describe('CustomFieldService', () => {
  describe('findByChapter', () => {
    it('returns chapter custom fields ordered by sort', async () => {
      const rows = [{ id: 'f1', sort: 0 }];
      const supabase = makeSupabase({ listRows: rows });
      const service = await buildService(supabase);

      const result = await service.findByChapter(CHAPTER_ID);

      expect(result).toEqual(rows);
      expect(supabase.from).toHaveBeenCalledWith('chapter_custom_fields');
    });
  });

  describe('create', () => {
    it('inserts a field with defaults and writes an audit row', async () => {
      const created = {
        id: 'f1',
        chapter_id: CHAPTER_ID,
        key: 'major',
        label: 'Major',
        type: 'text',
        required: false,
        visibility: 'chapter',
        sensitive: false,
        options: null,
        sort: 0,
      };
      const supabase = makeSupabase({
        insertResult: { data: created, error: null },
      });
      const service = await buildService(supabase);

      const result = await service.create(CHAPTER_ID, ACTOR_ID, {
        key: 'major',
        label: 'Major',
        type: 'text',
      });

      expect(result).toEqual(created);
      expect(supabase.customFieldInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: CHAPTER_ID,
          key: 'major',
          type: 'text',
          required: false,
          visibility: 'chapter',
          sensitive: false,
          options: null,
          sort: 0,
        }),
      );
      expect(supabase.auditInserts).toHaveLength(1);
      expect(supabase.auditInserts[0]).toMatchObject({
        chapter_id: CHAPTER_ID,
        actor_user_id: ACTOR_ID,
        action: 'chapter_custom_field_created',
        target_type: 'chapter_custom_field',
        target_id: created.id,
        member_visible: true,
      });
    });

    it('rejects a select field with no choices and does not audit', async () => {
      const supabase = makeSupabase({});
      const service = await buildService(supabase);

      await expect(
        service.create(CHAPTER_ID, ACTOR_ID, {
          key: 'shirt',
          label: 'Shirt size',
          type: 'select',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(supabase.customFieldInsert).not.toHaveBeenCalled();
      expect(supabase.auditInserts).toHaveLength(0);
    });

    it('deep-clones options so the persisted row never shares a reference', async () => {
      const supabase = makeSupabase({
        insertResult: {
          data: { id: 'f1', chapter_id: CHAPTER_ID },
          error: null,
        },
      });
      const service = await buildService(supabase);

      const options = { choices: ['S', 'M', 'L'] };
      await service.create(CHAPTER_ID, ACTOR_ID, {
        key: 'shirt',
        label: 'Shirt size',
        type: 'select',
        options,
      });

      const persisted = supabase.customFieldInsert.mock.calls[0][0] as {
        options: { choices: string[] };
      };
      expect(persisted.options).toEqual(options);
      expect(persisted.options).not.toBe(options);
      expect(persisted.options.choices).not.toBe(options.choices);
    });

    it('maps a unique-violation to 409 Conflict and does not audit', async () => {
      const supabase = makeSupabase({
        insertResult: { data: null, error: { code: '23505' } },
      });
      const service = await buildService(supabase);

      await expect(
        service.create(CHAPTER_ID, ACTOR_ID, {
          key: 'dup',
          label: 'Dup',
          type: 'text',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(supabase.auditInserts).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('deletes any field and audits the deletion (no core guard)', async () => {
      const supabase = makeSupabase({
        existingField: { id: 'f1', chapter_id: CHAPTER_ID },
      });
      const service = await buildService(supabase);

      const result = await service.remove('f1', CHAPTER_ID, ACTOR_ID);

      expect(result).toEqual({ success: true });
      expect(supabase.auditInserts[0]).toMatchObject({
        action: 'chapter_custom_field_deleted',
        target_type: 'chapter_custom_field',
      });
    });

    it('throws 404 when the field is missing', async () => {
      const supabase = makeSupabase({ existingField: null });
      const service = await buildService(supabase);

      await expect(
        service.remove('missing', CHAPTER_ID, ACTOR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies a partial patch and audits the change', async () => {
      const existing = {
        id: 'f1',
        chapter_id: CHAPTER_ID,
        label: 'Old',
        required: false,
      };
      const updated = { ...existing, label: 'New' };
      const supabase = makeSupabase({
        existingField: existing,
        updateResult: { data: updated, error: null },
      });
      const service = await buildService(supabase);

      const result = await service.update('f1', CHAPTER_ID, ACTOR_ID, {
        label: 'New',
      });

      expect(result).toEqual(updated);
      expect(supabase.auditInserts[0]).toMatchObject({
        action: 'chapter_custom_field_updated',
      });
    });

    it('returns the existing field without auditing when the patch is empty', async () => {
      const existing = { id: 'f1', chapter_id: CHAPTER_ID };
      const supabase = makeSupabase({ existingField: existing });
      const service = await buildService(supabase);

      const result = await service.update('f1', CHAPTER_ID, ACTOR_ID, {});

      expect(result).toEqual(existing);
      expect(supabase.auditInserts).toHaveLength(0);
    });

    it('refuses to strip the choices off an existing select field', async () => {
      const existing = {
        id: 'f1',
        chapter_id: CHAPTER_ID,
        type: 'select',
        options: { choices: ['S', 'M'] },
      };
      // Nulling options on a select field would leave it with no choices —
      // the same invariant create() enforces.
      for (const body of [
        { options: null },
        { options: { choices: [] } },
      ] as const) {
        const supabase = makeSupabase({ existingField: existing });
        const service = await buildService(supabase);
        await expect(
          service.update('f1', CHAPTER_ID, ACTOR_ID, body),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(supabase.auditInserts).toHaveLength(0);
      }
    });
  });
});
