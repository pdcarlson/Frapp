import { BadRequestException } from '@nestjs/common';
import { Event } from '#domain/entities/event.entity';
import {
  baseEvent,
  createEventServiceFixture,
  type EventServiceFixture,
} from '#test/helpers/event-service.fixture';

// Moved out of `event.service.spec.ts` with the methods (#3270). Cases drive
// `EventService.create` / `update`, which announce through this service.
describe('EventAnnouncementService', () => {
  let service: EventServiceFixture['service'];
  let mockEventRepo: EventServiceFixture['mockEventRepo'];
  let mockNotificationService: EventServiceFixture['mockNotificationService'];
  let mockUserRepo: EventServiceFixture['mockUserRepo'];
  let mockMemberRepo: EventServiceFixture['mockMemberRepo'];
  let mockChatService: EventServiceFixture['mockChatService'];

  beforeEach(async () => {
    ({
      service,
      mockEventRepo,
      mockNotificationService,
      mockUserRepo,
      mockMemberRepo,
      mockChatService,
    } = await createEventServiceFixture());
  });

  describe('notifications', () => {
    it('should notify chapter when event is created', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
      });

      expect(mockNotificationService.notifyChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          title: 'New Event',
          priority: 'SILENT',
          category: 'events',
        }),
      );
    });

    it('should notify chapter when event time is updated', async () => {
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockEventRepo.update.mockResolvedValue({
        ...baseEvent,
        end_time: '2026-02-26T20:00:00.000Z',
      });

      await service.update('evt-1', 'ch-1', {
        end_time: '2026-02-26T20:00:00.000Z',
      });

      expect(mockNotificationService.notifyChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          title: 'Event Updated',
          priority: 'NORMAL',
          category: 'events',
        }),
      );
    });

    it('should notify chapter when event location is updated', async () => {
      mockEventRepo.update.mockResolvedValue({
        ...baseEvent,
        location: 'New Location',
      });

      await service.update('evt-1', 'ch-1', {
        location: 'New Location',
      });

      expect(mockNotificationService.notifyChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          title: 'Event Updated',
          priority: 'NORMAL',
          category: 'events',
        }),
      );
    });

    it('should not fail if notification throws on create', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);
      mockNotificationService.notifyChapter.mockRejectedValue(
        new Error('push failed'),
      );

      const result = await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
      });

      expect(result).toEqual(baseEvent);
    });

    // A role-targeted event's "New Event"/"Event Updated" push must not name
    // it to a member who now correctly 404s reading the event itself (#1463)
    // — only members whose role_ids intersect required_role_ids are notified.
    describe('role-targeted notifications (#1463)', () => {
      it('notifies only eligible members when a role-targeted event is created', async () => {
        mockEventRepo.create.mockResolvedValue({
          ...baseEvent,
          name: 'Exec Meeting',
          required_role_ids: ['role-officer'],
        });
        mockMemberRepo.findByChapter.mockResolvedValue([
          { user_id: 'user-officer', role_ids: ['role-officer'] },
          { user_id: 'user-member', role_ids: ['role-member'] },
        ]);

        await service.create({
          chapter_id: 'ch-1',
          name: 'Exec Meeting',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
          required_role_ids: ['role-officer'],
        });

        expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).toHaveBeenCalledTimes(1);
        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'user-officer',
          'ch-1',
          expect.objectContaining({ title: 'New Event' }),
        );
      });

      it('notifies only eligible members when a role-targeted event is updated', async () => {
        mockEventRepo.update.mockResolvedValue({
          ...baseEvent,
          name: 'Exec Meeting',
          required_role_ids: ['role-officer'],
          location: 'New Location',
        });
        mockMemberRepo.findByChapter.mockResolvedValue([
          { user_id: 'user-officer', role_ids: ['role-officer'] },
          { user_id: 'user-member', role_ids: ['role-member'] },
        ]);

        await service.update('evt-1', 'ch-1', { location: 'New Location' });

        expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).toHaveBeenCalledTimes(1);
        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'user-officer',
          'ch-1',
          expect.objectContaining({ title: 'Event Updated' }),
        );
      });
    });
  });

  describe('event card (slash command)', () => {
    const chatInput = {
      chapter_id: 'ch-1',
      name: 'Spring Formal',
      start_time: baseEvent.start_time,
      end_time: baseEvent.end_time,
      created_by: 'user-1',
      channel_id: 'chan-1',
      client_message_id: 'cmid-1',
    };

    it('posts a server-originated event card when chat fields are present', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);
      mockUserRepo.findByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Alice' },
      ]);

      await service.create(chatInput);

      expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);
      const arg = mockChatService.sendMessage.mock.calls[0][0];
      expect(arg).toMatchObject({
        chapter_id: 'ch-1',
        channel_id: 'chan-1',
        sender_id: 'user-1',
        kind: 'event',
        client_message_id: 'cmid-1',
        system_originated: true,
      });
      expect(arg.payload).toMatchObject({
        event_id: 'evt-1',
        name: 'Chapter Meeting',
        point_value: 10,
        location: null,
        is_mandatory: false,
      });
      expect(arg.content).toContain('Chapter Meeting');
    });

    it('does not post a card for a dashboard create (no chat fields)', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
      });

      expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    });

    it('is best-effort: a failed card post still returns the event', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);
      mockUserRepo.findByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Alice' },
      ]);
      mockChatService.sendMessage.mockRejectedValue(new Error('chat down'));

      const result = await service.create(chatInput);

      expect(result).toEqual({ ...baseEvent, card_posted: false });
    });

    // #1717: the client renders an optimistic `loading` placeholder keyed on
    // `client_message_id` and waits for the Realtime echo of the card to
    // reconcile it. A failed post means no echo ever arrives, so the caller
    // has to be told — otherwise the placeholder is permanent and an officer
    // cannot tell a committed create from a lost one.
    describe('card_posted (#1717)', () => {
      it('reports card_posted: true when the card posts', async () => {
        mockEventRepo.create.mockResolvedValue(baseEvent);
        mockUserRepo.findByIds.mockResolvedValue([
          { id: 'user-1', display_name: 'Alice' },
        ]);

        const result = await service.create(chatInput);

        expect(result).toEqual({ ...baseEvent, card_posted: true });
      });

      it('reports card_posted: false when the card post throws', async () => {
        mockEventRepo.create.mockResolvedValue(baseEvent);
        mockUserRepo.findByIds.mockResolvedValue([
          { id: 'user-1', display_name: 'Alice' },
        ]);
        mockChatService.sendMessage.mockRejectedValue(new Error('chat down'));

        const result = await service.create(chatInput);

        expect(result).toEqual({ ...baseEvent, card_posted: false });
      });

      it('omits card_posted entirely for a dashboard create', async () => {
        mockEventRepo.create.mockResolvedValue(baseEvent);

        const result = await service.create({
          chapter_id: 'ch-1',
          name: 'Chapter Meeting',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
        });

        expect(result).toEqual(baseEvent);
        expect('card_posted' in result).toBe(false);
        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });

      it('omits card_posted when only one half of the chat context is given', async () => {
        mockEventRepo.create.mockResolvedValue(baseEvent);

        const result = await service.create({
          chapter_id: 'ch-1',
          name: 'Chapter Meeting',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
          created_by: 'user-1',
          channel_id: 'chan-1',
        });

        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
        expect('card_posted' in result).toBe(false);
      });
    });

    // #1469: the card is broadcast to every reader of the channel, so it would
    // show an ineligible member exactly what #1463 made `GET /v1/events/:id`
    // 404 to hide. Refused before the write, so no event row is orphaned.
    describe('role-targeted events (#1469)', () => {
      it('refuses to create a role-targeted event that asks for a card', async () => {
        await expect(
          service.create({ ...chatInput, required_role_ids: ['role-officer'] }),
        ).rejects.toThrow(BadRequestException);

        expect(mockEventRepo.create).not.toHaveBeenCalled();
        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });

      // Neither half posts a card on its own today, but accepting the pair
      // piecemeal would make the guard depend on which key a caller omitted.
      // `it.each` rather than a loop so a regression on one key names that key
      // instead of aborting the other case.
      it.each([
        ['channel_id only', { channel_id: 'chan-1' }],
        ['client_message_id only', { client_message_id: 'cmid-1' }],
      ])('refuses a role-targeted event with %s', async (_label, chatKeys) => {
        await expect(
          service.create({
            chapter_id: 'ch-1',
            name: 'Exec Review',
            start_time: baseEvent.start_time,
            end_time: baseEvent.end_time,
            created_by: 'user-1',
            required_role_ids: ['role-officer'],
            ...chatKeys,
          }),
        ).rejects.toThrow(BadRequestException);

        expect(mockEventRepo.create).not.toHaveBeenCalled();
        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });

      it('still posts a card when required_role_ids is an empty array', async () => {
        // `[]` is untargeted per the spec's wire semantics, so it must not be
        // caught by a truthiness check on the array itself.
        mockEventRepo.create.mockResolvedValue(baseEvent);
        mockUserRepo.findByIds.mockResolvedValue([
          { id: 'user-1', display_name: 'Alice' },
        ]);

        await service.create({ ...chatInput, required_role_ids: [] });

        expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);
      });

      it('still creates a role-targeted event with no card requested', async () => {
        // The dashboard path — role targeting is a supported feature; only the
        // broadcast surface is refused. The stub must return a *targeted* row:
        // `create` feeds the returned row's `required_role_ids` into
        // `notifyEligibleMembers`, so resolving the untargeted `baseEvent`
        // here would silently exercise the chapter-wide notification branch.
        mockEventRepo.create.mockResolvedValue({
          ...baseEvent,
          required_role_ids: ['role-officer'],
        });

        await service.create({
          chapter_id: 'ch-1',
          name: 'Exec Review',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
          required_role_ids: ['role-officer'],
        });

        expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });
    });
  });
});
