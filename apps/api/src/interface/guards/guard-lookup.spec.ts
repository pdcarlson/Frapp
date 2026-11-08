import { InFlightLookups } from './guard-lookup';

describe('InFlightLookups (#3728)', () => {
  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('gives callers of a key already in flight that call’s result', async () => {
    const lookups = new InFlightLookups<string>();
    const pending = deferred<string>();
    const load = jest.fn(() => pending.promise);

    const first = lookups.run('k', load);
    const second = lookups.run('k', load);
    pending.resolve('row');

    await expect(Promise.all([first, second])).resolves.toEqual(['row', 'row']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing once the call settles, so a later caller loads afresh', async () => {
    const lookups = new InFlightLookups<number>();
    let calls = 0;
    const load = jest.fn(() => Promise.resolve(++calls));

    await expect(lookups.run('k', load)).resolves.toBe(1);
    expect(lookups.size).toBe(0);
    await expect(lookups.run('k', load)).resolves.toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('runs different keys separately', async () => {
    const lookups = new InFlightLookups<string>();
    const load = jest.fn((value: string) => Promise.resolve(value));

    await expect(
      Promise.all([
        lookups.run('a', () => load('a')),
        lookups.run('b', () => load('b')),
      ]),
    ).resolves.toEqual(['a', 'b']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares a rejection with every waiter, then forgets it', async () => {
    const lookups = new InFlightLookups<string>();
    const pending = deferred<string>();
    const failure = new Error('socket hang up');

    const first = lookups.run('k', () => pending.promise);
    const second = lookups.run('k', () => pending.promise);
    pending.reject(failure);

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(lookups.size).toBe(0);
    await expect(lookups.run('k', () => Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );
  });

  it('turns a load that throws synchronously into a rejection', async () => {
    const lookups = new InFlightLookups<string>();
    await expect(
      lookups.run('k', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(lookups.size).toBe(0);
  });

  describe('the join window', () => {
    it('starts a fresh call for a request arriving after the window, and keeps the newer entry', async () => {
      let clock = 0;
      const lookups = new InFlightLookups<string>({
        joinWindowMs: 250,
        now: () => clock,
      });
      const stalled = deferred<string>();
      const load = jest
        .fn<Promise<string>, []>()
        .mockReturnValueOnce(stalled.promise)
        .mockResolvedValueOnce('fresh');

      const first = lookups.run('k', load);
      clock = 250;
      const joiner = lookups.run('k', load);
      clock = 251;
      const late = lookups.run('k', load);

      await expect(late).resolves.toBe('fresh');
      expect(load).toHaveBeenCalledTimes(2);

      // The stalled call settling must not drop the key from under a newer call.
      clock = 300;
      const pendingAgain = deferred<string>();
      load.mockReturnValueOnce(pendingAgain.promise);
      const newest = lookups.run('k', load);
      stalled.resolve('stale');
      await expect(first).resolves.toBe('stale');
      await expect(joiner).resolves.toBe('stale');
      expect(lookups.size).toBe(1);
      expect(lookups.run('k', load)).toBe(newest);
      pendingAgain.resolve('newest');
      await expect(newest).resolves.toBe('newest');
      expect(lookups.size).toBe(0);
    });
  });
});
