import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EVENT_TYPES_MAX } from '@repo/validation';
import type { IEventTypeRepository } from '#domain/repositories/event-type.repository.interface';
import type { EventType } from '#domain/entities/event-type.entity';
import { EventTypeService } from './event-type.service';

const type = (overrides: Partial<EventType> = {}): EventType => ({
  id: 'type-1',
  chapter_id: 'ch-1',
  name: 'Chapter meeting',
  point_value: 10,
  is_mandatory: true,
  position: 1,
  created_at: '2026-11-11T00:00:00.000Z',
  updated_at: '2026-11-11T00:00:00.000Z',
  ...overrides,
});

describe('EventTypeService', () => {
  let repo: jest.Mocked<IEventTypeRepository>;
  let service: EventTypeService;

  beforeEach(() => {
    repo = {
      findByChapter: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    service = new EventTypeService(repo);
  });

  describe('create', () => {
    it('adds the type after the last one, trimmed, with its defaults', async () => {
      repo.findByChapter.mockResolvedValue([
        type({ position: 3 }),
        type({ id: 'type-2', position: 7 }),
      ]);
      repo.create.mockImplementation(async (data) => type(data));

      await service.create('ch-1', { name: '  Work party ' });

      expect(repo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        name: 'Work party',
        point_value: 0,
        is_mandatory: false,
        position: 8,
      });
    });

    it('refuses a name the chapter already has', async () => {
      repo.create.mockResolvedValue(null);
      await expect(
        service.create('ch-1', { name: 'Social' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses past the cap', async () => {
      repo.findByChapter.mockResolvedValue(
        Array.from({ length: EVENT_TYPES_MAX }, (_, i) =>
          type({ id: `t-${i}`, position: i }),
        ),
      );
      await expect(
        service.create('ch-1', { name: 'One more' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('writes only the fields sent', async () => {
      repo.update.mockResolvedValue(type({ point_value: 15 }));
      await service.update('type-1', 'ch-1', { point_value: 15 });
      expect(repo.update).toHaveBeenCalledWith('type-1', 'ch-1', {
        point_value: 15,
      });
    });

    it('is a 404 for a type outside the chapter', async () => {
      repo.update.mockResolvedValue(undefined);
      await expect(
        service.update('type-x', 'ch-1', { name: 'Formal' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a 409 for a taken name', async () => {
      repo.update.mockResolvedValue(null);
      await expect(
        service.update('type-1', 'ch-1', { name: 'Social' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reads the type back for an empty patch, writing nothing', async () => {
      repo.findById.mockResolvedValue(type());
      await expect(service.update('type-1', 'ch-1', {})).resolves.toEqual(
        type(),
      );
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes a type of the chapter', async () => {
      repo.findById.mockResolvedValue(type());
      await service.remove('type-1', 'ch-1');
      expect(repo.delete).toHaveBeenCalledWith('type-1', 'ch-1');
    });

    it('is a 404 for a type outside the chapter', async () => {
      await expect(service.remove('type-x', 'ch-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('assertBelongs', () => {
    it('passes no type at all without a read', async () => {
      await service.assertBelongs(null, 'ch-1');
      await service.assertBelongs(undefined, 'ch-1');
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it("refuses another chapter's type with a 400", async () => {
      await expect(
        service.assertBelongs('type-other', 'ch-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.findById).toHaveBeenCalledWith('type-other', 'ch-1');
    });
  });
});
