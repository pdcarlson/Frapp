import { BadRequestException } from '@nestjs/common';
import { Event } from '#domain/entities/event.entity';
import {
  baseEvent,
  createEventServiceFixture,
  occurrenceRows,
  type EventServiceFixture,
} from '#test/helpers/event-service.fixture';

/**
 * An event's agenda and attachments (#4934, `spec/behavior/events.md`
 * § Agenda and attachments): validated and normalized on the way in, written
 * to one meeting only, and never copied across a series.
 */
describe('EventService — agenda and attachments', () => {
  let service: EventServiceFixture['service'];
  let mockEventRepo: EventServiceFixture['mockEventRepo'];
  let mockDocumentRepo: EventServiceFixture['mockDocumentRepo'];

  const DOC_ID = '11111111-1111-4111-8111-111111111111';
  const createBase = {
    chapter_id: 'ch-1',
    name: 'Chapter Meeting',
    start_time: '2026-12-01T18:00:00.000Z',
    end_time: '2026-12-01T19:00:00.000Z',
  };

  beforeEach(async () => {
    ({ service, mockEventRepo, mockDocumentRepo } =
      await createEventServiceFixture());
    mockEventRepo.create.mockImplementation(async (row) => ({
      ...baseEvent,
      ...row,
      id: 'evt-new',
    }));
    mockEventRepo.update.mockImplementation(async (id, _chapterId, data) => ({
      ...baseEvent,
      ...data,
      id,
    }));
  });

  describe('create', () => {
    it('stores the agenda and attachments, normalized', async () => {
      await service.create({
        ...createBase,
        agenda: [
          { id: 'a1', text: '  Treasurer   report ', done: false },
          { id: 'a2', text: 'Rush recap', done: true },
        ],
        attachments: [
          {
            id: 'x1',
            kind: 'link',
            url: ' https://docs.example.com/budget ',
            title: ' Budget ',
          },
          {
            id: 'x2',
            kind: 'document',
            document_id: DOC_ID,
            // A stray url on a document is dropped, not stored.
            url: 'https://ignored.example.com',
            title: 'Last week agenda',
          },
        ],
      });

      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agenda: [
            { id: 'a1', text: 'Treasurer report', done: false },
            { id: 'a2', text: 'Rush recap', done: true },
          ],
          attachments: [
            {
              id: 'x1',
              kind: 'link',
              url: 'https://docs.example.com/budget',
              title: 'Budget',
            },
            {
              id: 'x2',
              kind: 'document',
              document_id: DOC_ID,
              title: 'Last week agenda',
            },
          ],
        }),
      );
      expect(mockDocumentRepo.findByIds).toHaveBeenCalledWith([DOC_ID], 'ch-1');
    });

    it('stores empty lists when none are sent', async () => {
      await service.create(createBase);
      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ agenda: [], attachments: [] }),
      );
      expect(mockDocumentRepo.findByIds).not.toHaveBeenCalled();
    });

    it("gives a series' other meetings none of the first meeting's", async () => {
      await service.create({
        ...createBase,
        recurrence_rule: 'WEEKLY',
        agenda: [{ id: 'a1', text: 'Opening', done: false }],
        attachments: [
          { id: 'x1', kind: 'link', url: 'https://a.example', title: 'A' },
        ],
      });
      const rows = occurrenceRows(mockEventRepo);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.agenda).toBeUndefined();
        expect(row.attachments).toBeUndefined();
      }
    });

    it.each([
      [
        'an empty agenda item',
        { agenda: [{ id: 'a1', text: '   ', done: false }] },
        'An agenda item needs some text.',
      ],
      [
        'two agenda items with one id',
        {
          agenda: [
            { id: 'a1', text: 'One', done: false },
            { id: 'a1', text: 'Two', done: false },
          ],
        },
        'agenda has two entries with id a1.',
      ],
      [
        'a link that is not http or https',
        {
          attachments: [
            {
              id: 'x1',
              kind: 'link' as const,
              url: 'javascript:alert(1)',
              title: 'Bad',
            },
          ],
        },
        'A link attachment needs a web address starting with http:// or https://.',
      ],
      [
        'an attachment with no title',
        {
          attachments: [
            {
              id: 'x1',
              kind: 'link' as const,
              url: 'https://a.example',
              title: '  ',
            },
          ],
        },
        'Every attachment needs a title.',
      ],
      [
        'a document attachment with no document',
        {
          attachments: [
            { id: 'x1', kind: 'document' as const, title: 'Agenda' },
          ],
        },
        'A document attachment needs the document it points at.',
      ],
    ])('refuses %s with a 400 naming it', async (_label, extra, message) => {
      await expect(service.create({ ...createBase, ...extra })).rejects.toThrow(
        new BadRequestException(message),
      );
      expect(mockEventRepo.create).not.toHaveBeenCalled();
    });

    it("refuses a document that isn't one of the chapter's files", async () => {
      mockDocumentRepo.findByIds.mockResolvedValue([]);
      await expect(
        service.create({
          ...createBase,
          attachments: [
            {
              id: 'x1',
              kind: 'document',
              document_id: DOC_ID,
              title: 'Bylaws',
            },
          ],
        }),
      ).rejects.toThrow(
        new BadRequestException(
          `Document ${DOC_ID} isn't one of this chapter's files.`,
        ),
      );
      expect(mockEventRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('writes an instance edit with the rest of the patch', async () => {
      await service.update('evt-1', 'ch-1', {
        name: 'Renamed',
        agenda: [{ id: 'a1', text: ' Vote ', done: true }],
      });
      expect(mockEventRepo.update).toHaveBeenCalledTimes(1);
      expect(mockEventRepo.update).toHaveBeenCalledWith('evt-1', 'ch-1', {
        name: 'Renamed',
        agenda: [{ id: 'a1', text: 'Vote', done: true }],
      });
    });

    it("clears a meeting's attachments with an empty list", async () => {
      await service.update('evt-1', 'ch-1', { attachments: [] });
      expect(mockEventRepo.update).toHaveBeenCalledWith('evt-1', 'ch-1', {
        attachments: [],
      });
    });

    describe("with scope 'series'", () => {
      const head: Event = {
        ...baseEvent,
        id: 'head-1',
        recurrence_rule: 'WEEKLY',
        start_time: '2099-01-01T18:00:00.000Z',
        end_time: '2099-01-01T19:00:00.000Z',
      };
      const child: Event = {
        ...head,
        id: 'child-1',
        recurrence_rule: null,
        parent_event_id: 'head-1',
        start_time: '2099-01-08T18:00:00.000Z',
        end_time: '2099-01-08T19:00:00.000Z',
      };

      beforeEach(() => {
        mockEventRepo.findById.mockImplementation(
          async (id) => [head, child].find((row) => row.id === id) ?? null,
        );
        mockEventRepo.findChildren.mockResolvedValue([child]);
      });

      it('writes an agenda-only edit to the addressed meeting alone', async () => {
        const result = await service.update(
          'child-1',
          'ch-1',
          { agenda: [{ id: 'a1', text: 'Elections', done: false }] },
          'series',
        );
        expect(mockEventRepo.update).toHaveBeenCalledTimes(1);
        expect(mockEventRepo.update).toHaveBeenCalledWith('child-1', 'ch-1', {
          agenda: [{ id: 'a1', text: 'Elections', done: false }],
        });
        expect(mockEventRepo.updateMany).not.toHaveBeenCalled();
        expect(result.agenda).toEqual([
          { id: 'a1', text: 'Elections', done: false },
        ]);
      });

      it('sends the rest of the edit across the series without them', async () => {
        await service.update(
          'head-1',
          'ch-1',
          {
            name: 'Renamed',
            attachments: [
              { id: 'x1', kind: 'link', url: 'https://a.example', title: 'A' },
            ],
          },
          'series',
        );
        // The attachment lands on the head alone, first.
        expect(mockEventRepo.update).toHaveBeenNthCalledWith(
          1,
          'head-1',
          'ch-1',
          {
            attachments: [
              { id: 'x1', kind: 'link', url: 'https://a.example', title: 'A' },
            ],
          },
        );
        // Nothing the series path writes carries it.
        const writes = [
          ...mockEventRepo.update.mock.calls.slice(1).map(([, , data]) => data),
          ...mockEventRepo.updateMany.mock.calls.map(([, , data]) => data),
        ];
        expect(writes.length).toBeGreaterThan(0);
        for (const data of writes) {
          expect(data).not.toHaveProperty('attachments');
          expect(data).not.toHaveProperty('agenda');
        }
        // The rename itself still went out.
        expect(writes).toContainEqual(
          expect.objectContaining({ name: 'Renamed' }),
        );
      });
    });
  });
});
