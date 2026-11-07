import { TimeZoneSyncService } from './time-zone-sync.service';
import type { IUserSettingsRepository } from '#domain/repositories/notification.repository.interface';

describe('TimeZoneSyncService', () => {
  let setTimeZone: jest.Mock;
  let service: TimeZoneSyncService;

  beforeEach(() => {
    setTimeZone = jest.fn().mockResolvedValue(undefined);
    service = new TimeZoneSyncService({
      setTimeZone,
    } as unknown as IUserSettingsRepository);
  });

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('records a new zone once, and not again while it is unchanged', async () => {
    service.record('u-1', 'America/Chicago');
    service.record('u-1', 'America/Chicago');
    await flush();

    expect(setTimeZone).toHaveBeenCalledTimes(1);
    expect(setTimeZone).toHaveBeenCalledWith('u-1', 'America/Chicago');
  });

  it('records again when the member travels', async () => {
    service.record('u-1', 'America/Chicago');
    service.record('u-1', 'Europe/London');
    await flush();

    expect(setTimeZone).toHaveBeenLastCalledWith('u-1', 'Europe/London');
  });

  it.each([undefined, '', '-05:00', 'Not/AZone', ['America/Chicago']])(
    'ignores %p',
    async (header) => {
      service.record('u-1', header);
      await flush();

      expect(setTimeZone).not.toHaveBeenCalled();
    },
  );

  it('tries again on the next request after a failed write', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setTimeZone.mockRejectedValueOnce(new Error('db down'));

    service.record('u-1', 'America/Chicago');
    await flush();
    service.record('u-1', 'America/Chicago');
    await flush();

    expect(setTimeZone).toHaveBeenCalledTimes(2);
  });

  it('writes the same zone again after a while, in case another instance changed it', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0);
    service.record('u-1', 'America/Chicago');
    now.mockReturnValue(7 * 60 * 60 * 1000);
    service.record('u-1', 'America/Chicago');
    await flush();
    now.mockRestore();

    expect(setTimeZone).toHaveBeenCalledTimes(2);
  });
});
