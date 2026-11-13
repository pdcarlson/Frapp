import { EventController } from './event.controller';
import type { EventService } from '../../application/services/event.service';

// #4808: the event read says when check-in needs an officer's code, so web
// says to scan rather than offering a Check in the server refuses.
describe('EventController.getOne', () => {
  it('adds check_in_needs_code from the live screens', async () => {
    const findById = jest
      .fn()
      .mockResolvedValue({ id: 'evt-1', chapter_id: 'ch-1', name: 'Meeting' });
    const checkInNeedsCode = jest.fn().mockResolvedValue(true);
    const controller = new EventController({
      findById,
      checkInNeedsCode,
    } as unknown as EventService);

    await expect(controller.getOne('ch-1', 'evt-1', 'user-1')).resolves.toEqual(
      {
        id: 'evt-1',
        chapter_id: 'ch-1',
        name: 'Meeting',
        check_in_needs_code: true,
      },
    );
    expect(findById).toHaveBeenCalledWith('evt-1', 'ch-1', 'user-1');
    expect(checkInNeedsCode).toHaveBeenCalledWith('evt-1', 'ch-1');
  });

  it('reads no screens for an event the viewer cannot see', async () => {
    const findById = jest.fn().mockRejectedValue(new Error('Event not found'));
    const checkInNeedsCode = jest.fn();
    const controller = new EventController({
      findById,
      checkInNeedsCode,
    } as unknown as EventService);

    await expect(controller.getOne('ch-1', 'evt-1', 'user-1')).rejects.toThrow(
      'Event not found',
    );
    expect(checkInNeedsCode).not.toHaveBeenCalled();
  });
});
