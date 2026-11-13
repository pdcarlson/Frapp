import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DOCUMENT_TYPES_MAX } from '@repo/validation';
import type { IChapterDocumentTypeRepository } from '#domain/repositories/chapter-document-type.repository.interface';
import type { IChapterDocumentRepository } from '#domain/repositories/chapter-document.repository.interface';
import type { ChapterDocumentType } from '#domain/entities/chapter-document.entity';
import {
  ChapterDocumentTypeService,
  normalizeTypeName,
} from './chapter-document-type.service';

const type = (
  name: string,
  sort_order = 1,
  id = `t-${name}`,
): ChapterDocumentType => ({
  id,
  chapter_id: 'ch-1',
  name,
  sort_order,
  created_at: '2026-11-13T00:00:00.000Z',
});

describe('ChapterDocumentTypeService', () => {
  let typeRepo: jest.Mocked<IChapterDocumentTypeRepository>;
  let documentRepo: jest.Mocked<
    Pick<IChapterDocumentRepository, 'renameType' | 'clearType'>
  >;
  let service: ChapterDocumentTypeService;

  beforeEach(() => {
    typeRepo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      findByName: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    documentRepo = { renameType: jest.fn(), clearType: jest.fn() };
    service = new ChapterDocumentTypeService(
      typeRepo,
      documentRepo as unknown as IChapterDocumentRepository,
    );
  });

  describe('create', () => {
    it('appends a trimmed name after the last type', async () => {
      typeRepo.findByChapter.mockResolvedValue([
        type('Bylaws', 1),
        type('Form', 6),
      ]);
      typeRepo.create.mockResolvedValue(type('Rush schedule', 7));

      await service.create('ch-1', '  Rush   schedule ');

      expect(typeRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        name: 'Rush schedule',
        sort_order: 7,
      });
    });

    it('refuses a name the chapter has in another case', async () => {
      typeRepo.findByChapter.mockResolvedValue([type('Bylaws')]);
      await expect(service.create('ch-1', 'BYLAWS')).rejects.toThrow(
        ConflictException,
      );
      expect(typeRepo.create).not.toHaveBeenCalled();
    });

    it('reports a lost race on the unique index as a conflict', async () => {
      typeRepo.create.mockResolvedValue(null);
      await expect(service.create('ch-1', 'Minutes')).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses an empty name and a full list', async () => {
      await expect(service.create('ch-1', '   ')).rejects.toThrow(
        BadRequestException,
      );
      typeRepo.findByChapter.mockResolvedValue(
        Array.from({ length: DOCUMENT_TYPES_MAX }, (_, i) => type(`T${i}`, i)),
      );
      await expect(service.create('ch-1', 'One more')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('renames the type on its documents before renaming the row', async () => {
      const order: string[] = [];
      typeRepo.findById.mockResolvedValue(type('Mins'));
      documentRepo.renameType.mockImplementation(async () => {
        order.push('documents');
      });
      typeRepo.update.mockImplementation(async () => {
        order.push('type');
        return type('Minutes');
      });

      await service.update('t-Mins', 'ch-1', { name: 'Minutes' });

      expect(documentRepo.renameType).toHaveBeenCalledWith(
        'Mins',
        'Minutes',
        'ch-1',
      );
      expect(order).toEqual(['documents', 'type']);
    });

    it('lets a type change only its case', async () => {
      typeRepo.findById.mockResolvedValue(type('bylaws'));
      typeRepo.update.mockResolvedValue(type('Bylaws'));

      await service.update('t-bylaws', 'ch-1', { name: 'Bylaws' });

      expect(typeRepo.findByName).not.toHaveBeenCalled();
      expect(documentRepo.renameType).toHaveBeenCalledWith(
        'bylaws',
        'Bylaws',
        'ch-1',
      );
    });

    it('refuses a rename onto another type', async () => {
      typeRepo.findById.mockResolvedValue(type('Mins'));
      typeRepo.findByName.mockResolvedValue(type('Minutes'));
      await expect(
        service.update('t-Mins', 'ch-1', { name: 'minutes' }),
      ).rejects.toThrow(ConflictException);
      expect(documentRepo.renameType).not.toHaveBeenCalled();
    });

    it('moves without touching documents, and treats {} as a no-op', async () => {
      const row = type('Form', 6);
      typeRepo.findById.mockResolvedValue(row);
      typeRepo.update.mockResolvedValue({ ...row, sort_order: 0 });

      await service.update(row.id, 'ch-1', { sort_order: 0 });
      expect(documentRepo.renameType).not.toHaveBeenCalled();

      typeRepo.update.mockClear();
      await expect(service.update(row.id, 'ch-1', {})).resolves.toBe(row);
      expect(typeRepo.update).not.toHaveBeenCalled();
    });

    it('is a 404 for another chapter’s type', async () => {
      await expect(
        service.update('t-x', 'ch-1', { name: 'Anything' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('clears the type from its documents, then deletes it', async () => {
      typeRepo.findById.mockResolvedValue(type('Agenda'));
      await service.delete('t-Agenda', 'ch-1');
      expect(documentRepo.clearType).toHaveBeenCalledWith('Agenda', 'ch-1');
      expect(typeRepo.delete).toHaveBeenCalledWith('t-Agenda', 'ch-1');
    });

    it('is a 404 for a type not in the chapter', async () => {
      await expect(service.delete('t-x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(documentRepo.clearType).not.toHaveBeenCalled();
    });
  });

  describe('resolveForUpload', () => {
    it('returns the list spelling of a known type', async () => {
      typeRepo.findByName.mockResolvedValue(type('By-Laws'));
      await expect(service.resolveForUpload('ch-1', 'by-laws')).resolves.toBe(
        'By-Laws',
      );
    });

    it('uses the winner of a race to add the same new type', async () => {
      typeRepo.findByName
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(type('Contract'));
      typeRepo.create.mockResolvedValue(null);
      await expect(service.resolveForUpload('ch-1', 'contract')).resolves.toBe(
        'Contract',
      );
    });

    it('refuses a new type when the list is full, but files a known one', async () => {
      typeRepo.findByChapter.mockResolvedValue(
        Array.from({ length: DOCUMENT_TYPES_MAX }, (_, i) => type(`T${i}`, i)),
      );
      await expect(
        service.resolveForUpload('ch-1', 'New kind'),
      ).rejects.toThrow(BadRequestException);

      typeRepo.findByName.mockResolvedValue(type('T3'));
      await expect(service.resolveForUpload('ch-1', 't3')).resolves.toBe('T3');
    });

    it('is null for no type', async () => {
      await expect(service.resolveForUpload('ch-1', undefined)).resolves.toBe(
        null,
      );
      await expect(service.resolveForUpload('ch-1', ' ')).resolves.toBe(null);
    });
  });

  it('normalizeTypeName trims and collapses whitespace', () => {
    expect(normalizeTypeName('  Meeting \t minutes ')).toBe('Meeting minutes');
    expect(normalizeTypeName(null)).toBeNull();
  });
});
