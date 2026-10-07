import { Test, TestingModule } from '@nestjs/testing';
import { CustomFieldService } from './custom-field.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import { createAuditLogServiceMock } from '#test/helpers/audit-log.mock';
import { CUSTOM_FIELD_REPOSITORY } from '#domain/repositories/custom-field.repository.interface';
import type { CustomFieldVisibility } from '#domain/entities/chapter-custom-field.entity';

const CHAPTER_ID = 'chapter-1';
const MEMBER_ID = 'member-1';

/**
 * Repository double for the two reads `findVisibleValuesForMember` makes: the
 * visibility-filtered definitions, then the member's values for those ids.
 */
function makeRepo(opts: {
  defs?: unknown[];
  values?: { field_id: string; value: string | null }[];
}) {
  return {
    findByVisibility: jest.fn().mockResolvedValue(opts.defs ?? []),
    findValuesForMember: jest.fn().mockResolvedValue(opts.values ?? []),
  };
}

describe('CustomFieldService.findVisibleValuesForMember', () => {
  async function build(
    repo: ReturnType<typeof makeRepo>,
  ): Promise<CustomFieldService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomFieldService,
        { provide: CUSTOM_FIELD_REPOSITORY, useValue: repo },
        // Read-only path: nothing here audits, but the service now injects the
        // one audit writer (#2167), so the container needs it bound.
        {
          provide: ChapterAuditLogService,
          useValue: createAuditLogServiceMock(),
        },
      ],
    }).compile();
    return module.get(CustomFieldService);
  }

  it('only queries definitions in the allowed visibility set', async () => {
    const repo = makeRepo({ defs: [], values: [] });
    const service = await build(repo);

    const allowed = new Set<CustomFieldVisibility>(['chapter']);
    await service.findVisibleValuesForMember(CHAPTER_ID, MEMBER_ID, allowed);

    expect(repo.findByVisibility).toHaveBeenCalledWith(CHAPTER_ID, ['chapter']);
    // No visible definitions, so no value lookup at all.
    expect(repo.findValuesForMember).not.toHaveBeenCalled();
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
    const service = await build(
      makeRepo({ defs, values: [{ field_id: 'f1', value: '3.9' }] }),
    );

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
    const repo = makeRepo({ defs, values: [] });
    const service = await build(repo);

    await service.findVisibleValuesForMember(
      CHAPTER_ID,
      MEMBER_ID,
      new Set<CustomFieldVisibility>(['chapter']),
    );

    expect(repo.findValuesForMember).toHaveBeenCalledWith(MEMBER_ID, [
      'f1',
      'f2',
    ]);
  });

  it('short-circuits to empty (no query) when no visibility tier is allowed', async () => {
    const repo = makeRepo({ defs: [{ id: 'f1' }] });
    const service = await build(repo);

    const result = await service.findVisibleValuesForMember(
      CHAPTER_ID,
      MEMBER_ID,
      new Set(),
    );

    expect(result).toEqual([]);
    expect(repo.findByVisibility).not.toHaveBeenCalled();
    expect(repo.findValuesForMember).not.toHaveBeenCalled();
  });
});
