import {
  readOncePerRequest,
  requestReadsActive,
  runWithRequestReads,
  sealRequestReadsForWrites,
} from './request-reads';

/**
 * The per-request read store (#3728). What it may never do is the point of
 * these cases: answer a second request from the first's read
 * (spec/behavior/rbac.md, #3752), or answer a write's handler from a read made
 * before its write.
 */
describe('request reads', () => {
  const counting = <T>(value: T) => {
    const read = jest.fn(() => Promise.resolve(value));
    return read;
  };

  it('reads straight through outside a request', async () => {
    const read = counting({ id: 'm1' });
    await readOncePerRequest('k', read);
    await readOncePerRequest('k', read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(requestReadsActive()).toBe(false);
  });

  it('shares one read within a GET, concurrent or not', async () => {
    const read = counting({ id: 'm1' });
    await runWithRequestReads('GET', async () => {
      await Promise.all([
        readOncePerRequest('k', read),
        readOncePerRequest('k', read),
      ]);
      await readOncePerRequest('k', read);
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('never shares a read between two requests', async () => {
    const read = counting({ id: 'm1' });
    await runWithRequestReads('GET', () => readOncePerRequest('k', read));
    await runWithRequestReads('GET', () => readOncePerRequest('k', read));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps distinct keys apart', async () => {
    const a = counting('a');
    const b = counting('b');
    const got = await runWithRequestReads('GET', () =>
      Promise.all([readOncePerRequest('a', a), readOncePerRequest('b', b)]),
    );
    expect(got).toEqual(['a', 'b']);
  });

  it('hands each caller its own copy', async () => {
    const read = counting({ role_ids: ['r1'] });
    await runWithRequestReads('GET', async () => {
      const first = await readOncePerRequest('k', read);
      first.role_ids.push('forged');
      const second = await readOncePerRequest('k', read);
      expect(second.role_ids).toEqual(['r1']);
    });
  });

  it('forgets a failed read, so the next caller tries again', async () => {
    const read = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('ok');
    await runWithRequestReads('GET', async () => {
      await expect(readOncePerRequest('k', read)).rejects.toThrow('timeout');
      await expect(readOncePerRequest('k', read)).resolves.toBe('ok');
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('shares a write request’s reads only until its handler', async () => {
    const read = counting({ role_ids: ['r1'] });
    await runWithRequestReads('POST', async () => {
      // Guards: shared.
      await readOncePerRequest('k', read);
      await readOncePerRequest('k', read);
      expect(read).toHaveBeenCalledTimes(1);

      // Handler: every read goes to the database.
      sealRequestReadsForWrites();
      expect(requestReadsActive()).toBe(false);
      await readOncePerRequest('k', read);
      await readOncePerRequest('k', read);
    });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('does not seal a read request at its handler', async () => {
    const read = counting('row');
    await runWithRequestReads('get', async () => {
      await readOncePerRequest('k', read);
      sealRequestReadsForWrites();
      expect(requestReadsActive()).toBe(true);
      await readOncePerRequest('k', read);
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
