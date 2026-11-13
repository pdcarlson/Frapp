import {
  readOncePerRequest,
  readSharedInBurst,
  requestReadsActive,
  runWithRequestReads,
  sealRequestReadsForWrites,
} from './request-reads';

/**
 * The per-request read store (#3728). What it may never do is the point of
 * these cases: hand a second request the first's store (only an in-flight
 * read is shared, through `readSharedInBurst`, #3752), or answer a write's
 * handler from a read made before its write.
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

  // Requests that arrive together may join one membership or role read, within
  // IN_FLIGHT_JOIN_WINDOW_MS of its start (#3752, Paul 2026-11-13).
  describe('readSharedInBurst', () => {
    let caseNo = 0;
    let key: string;
    beforeEach(() => {
      caseNo += 1;
      key = `burst:${caseNo}`;
    });

    const inRequest = <T>(method: string, fn: () => Promise<T>) =>
      runWithRequestReads(method, fn);

    it("joins the same key's read across requests that arrive together", async () => {
      const read = counting({ id: 'member-1' });

      const [a, b] = await Promise.all([
        inRequest('GET', () =>
          readOncePerRequest(key, () => readSharedInBurst(key, read)),
        ),
        inRequest('GET', () =>
          readOncePerRequest(key, () => readSharedInBurst(key, read)),
        ),
      ]);

      expect(read).toHaveBeenCalledTimes(1);
      expect(a).toEqual({ id: 'member-1' });
      // Each request still gets its own copy.
      expect(a).not.toBe(b);
    });

    it('reads each key on its own', async () => {
      const read = counting('row');

      await Promise.all([
        inRequest('GET', () => readSharedInBurst(key, read)),
        inRequest('GET', () => readSharedInBurst(`${key}:other`, read)),
      ]);

      expect(read).toHaveBeenCalledTimes(2);
    });

    it('shares nothing outside a request', async () => {
      const read = counting('row');

      await Promise.all([
        readSharedInBurst(key, read),
        readSharedInBurst(key, read),
      ]);

      expect(read).toHaveBeenCalledTimes(2);
    });

    it("shares nothing with a write request's guards", async () => {
      const read = counting('row');

      await Promise.all([
        inRequest('GET', () => readSharedInBurst(key, read)),
        inRequest('DELETE', () => readSharedInBurst(key, read)),
      ]);

      expect(read).toHaveBeenCalledTimes(2);
    });

    it("shares nothing with a write's handler", async () => {
      const read = counting('row');

      await Promise.all([
        inRequest('POST', async () => {
          sealRequestReadsForWrites();
          return readSharedInBurst(key, read);
        }),
        inRequest('POST', async () => {
          sealRequestReadsForWrites();
          return readSharedInBurst(key, read);
        }),
      ]);

      expect(read).toHaveBeenCalledTimes(2);
    });
  });
});
