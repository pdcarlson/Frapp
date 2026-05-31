import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CustomRoleService } from './custom-role.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

const CHAPTER_ID = 'chapter-1';
const ACTOR_ID = 'user-1';

type AuditRow = Record<string, unknown>;

/**
 * Builds a Supabase test double tailored to the chains CustomRoleService uses:
 * - chapter_custom_roles: insert/update/delete + select/maybeSingle/order
 * - chapter_audit_log: insert (captured)
 * `roleResult` / `insertResult` let a test inject a row or an error.
 */
function makeSupabase(opts: {
  /** Row returned by the single-row read used before update/delete. */
  existingRole?: Record<string, unknown> | null;
  /** Result of insert().select().single() on chapter_custom_roles. */
  insertResult?: { data?: unknown; error?: unknown };
  /** Result of update().eq().eq().select().single(). */
  updateResult?: { data?: unknown; error?: unknown };
  /** Rows returned by the list query. */
  listRows?: unknown[];
}) {
  const auditInserts: AuditRow[] = [];
  const customRoleInsert = jest.fn();

  const from = jest.fn((table: string) => {
    if (table === 'chapter_audit_log') {
      return {
        insert: jest.fn((row: AuditRow) => {
          auditInserts.push(row);
          return Promise.resolve({ error: null });
        }),
      };
    }

    if (table === 'chapter_custom_roles') {
      // Each call to from() returns a fresh builder; the terminal method
      // resolves with the configured result for the operation under test.
      const builder: Record<string, jest.Mock> = {};
      builder.select = jest.fn(() => builder);
      builder.order = jest.fn(() =>
        Promise.resolve({ data: opts.listRows ?? [], error: null }),
      );
      builder.eq = jest.fn(() => builder);
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: opts.existingRole ?? null, error: null }),
      );
      builder.single = jest.fn(() =>
        Promise.resolve(
          opts.updateResult ?? opts.insertResult ?? { data: null, error: null },
        ),
      );
      builder.insert = jest.fn((payload: unknown) => {
        customRoleInsert(payload);
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

  return { from, auditInserts, customRoleInsert };
}

async function buildService(supabase: { from: jest.Mock }) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CustomRoleService,
      { provide: SUPABASE_CLIENT, useValue: supabase },
    ],
  }).compile();
  return module.get(CustomRoleService);
}

describe('CustomRoleService', () => {
  describe('findByChapter', () => {
    it('returns chapter custom roles ordered by rank', async () => {
      const rows = [{ id: 'r1', rank: 1 }];
      const supabase = makeSupabase({ listRows: rows });
      const service = await buildService(supabase);

      const result = await service.findByChapter(CHAPTER_ID);

      expect(result).toEqual(rows);
      expect(supabase.from).toHaveBeenCalledWith('chapter_custom_roles');
    });
  });

  describe('create', () => {
    it('inserts a role and writes an audit row', async () => {
      const created = {
        id: 'r1',
        chapter_id: CHAPTER_ID,
        key: 'pledge_educator',
        label: 'Pledge Educator',
        rank: 9,
        capabilities: ['members:view'],
        core: false,
      };
      const supabase = makeSupabase({
        insertResult: { data: created, error: null },
      });
      const service = await buildService(supabase);

      const result = await service.create(CHAPTER_ID, ACTOR_ID, {
        key: 'pledge_educator',
        label: 'Pledge Educator',
        rank: 9,
        capabilities: ['members:view'],
      });

      expect(result).toEqual(created);
      // Insert defaults applied + chapter scoping.
      expect(supabase.customRoleInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: CHAPTER_ID,
          key: 'pledge_educator',
          rank: 9,
          capabilities: ['members:view'],
          core: false,
        }),
      );
      // Audit emitted.
      expect(supabase.auditInserts).toHaveLength(1);
      expect(supabase.auditInserts[0]).toMatchObject({
        chapter_id: CHAPTER_ID,
        actor_user_id: ACTOR_ID,
        action: 'chapter_custom_role_created',
        target_type: 'chapter_custom_role',
        member_visible: true,
      });
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
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(supabase.auditInserts).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('refuses to delete a core role', async () => {
      const supabase = makeSupabase({
        existingRole: { id: 'r1', chapter_id: CHAPTER_ID, core: true },
      });
      const service = await buildService(supabase);

      await expect(
        service.remove('r1', CHAPTER_ID, ACTOR_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(supabase.auditInserts).toHaveLength(0);
    });

    it('deletes a non-core role and audits the deletion', async () => {
      const supabase = makeSupabase({
        existingRole: { id: 'r1', chapter_id: CHAPTER_ID, core: false },
      });
      const service = await buildService(supabase);

      const result = await service.remove('r1', CHAPTER_ID, ACTOR_ID);

      expect(result).toEqual({ success: true });
      expect(supabase.auditInserts[0]).toMatchObject({
        action: 'chapter_custom_role_deleted',
      });
    });

    it('throws 404 when the role is missing', async () => {
      const supabase = makeSupabase({ existingRole: null });
      const service = await buildService(supabase);

      await expect(
        service.remove('missing', CHAPTER_ID, ACTOR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('applies a partial patch and audits the change', async () => {
      const existing = {
        id: 'r1',
        chapter_id: CHAPTER_ID,
        label: 'Old',
        rank: 5,
        capabilities: [],
        core: false,
      };
      const updated = { ...existing, label: 'New' };
      const supabase = makeSupabase({
        existingRole: existing,
        updateResult: { data: updated, error: null },
      });
      const service = await buildService(supabase);

      const result = await service.update('r1', CHAPTER_ID, ACTOR_ID, {
        label: 'New',
      });

      expect(result).toEqual(updated);
      expect(supabase.auditInserts[0]).toMatchObject({
        action: 'chapter_custom_role_updated',
      });
    });

    it('returns the existing role without auditing when the patch is empty', async () => {
      const existing = { id: 'r1', chapter_id: CHAPTER_ID, core: false };
      const supabase = makeSupabase({ existingRole: existing });
      const service = await buildService(supabase);

      const result = await service.update('r1', CHAPTER_ID, ACTOR_ID, {});

      expect(result).toEqual(existing);
      expect(supabase.auditInserts).toHaveLength(0);
    });
  });
});
