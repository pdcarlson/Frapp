import { GoogleCalendarController } from './google-calendar.controller';
import type { GoogleCalendarService } from '../../application/services/google-calendar/google-calendar.service';

describe('GoogleCalendarController.connect (#5407)', () => {
  function setup() {
    const connect = jest
      .fn()
      .mockResolvedValue({ authorize_url: 'https://accounts.google.com/x' });
    const controller = new GoogleCalendarController({
      connect,
    } as unknown as GoogleCalendarService);
    return { controller, connect };
  }

  it('passes the screen a web sign-in started on through to the service', async () => {
    const { controller, connect } = setup();

    await controller.connect('chapter-1', 'user-1', {
      client: 'web',
      web_return: 'linked_apps',
    });

    expect(connect).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      'web',
      null,
      'linked_apps',
    );
  });

  it('leaves the screen to the service default when the client sends none', async () => {
    const { controller, connect } = setup();

    await controller.connect('chapter-1', 'user-1', { client: 'web' });

    expect(connect).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      'web',
      null,
      undefined,
    );
  });
});
