import { getRequestId, runWithRequestLogStore } from './request-als';

describe('request ALS', () => {
  it('is empty outside a request', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('returns the store inside runWithRequestLogStore', () => {
    runWithRequestLogStore({ requestId: 'req_inner' }, () => {
      expect(getRequestId()).toBe('req_inner');
    });
    expect(getRequestId()).toBeUndefined();
  });

  it('does not leak across overlapping async work', async () => {
    const seen: string[] = [];
    await Promise.all(
      ['req_a', 'req_b', 'req_c'].map(
        (requestId) =>
          new Promise<void>((resolve) => {
            runWithRequestLogStore({ requestId }, () => {
              setImmediate(() => {
                seen.push(getRequestId() ?? 'missing');
                resolve();
              });
            });
          }),
      ),
    );
    expect(seen.sort()).toEqual(['req_a', 'req_b', 'req_c']);
  });
});
