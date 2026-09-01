import {
  ChannelCacheService,
  type CachedChannelRow,
} from './channel-cache.service';

describe('ChannelCacheService', () => {
  let service: ChannelCacheService;

  const row: CachedChannelRow = {
    id: 'ch-1',
    chapter_id: 'chap-1',
    name: 'general',
    is_read_only: false,
    type: 'PUBLIC',
    member_ids: null,
    required_permissions: null,
  };

  beforeEach(() => {
    service = new ChannelCacheService();
  });

  it('returns null for a channel that was never cached', () => {
    expect(service.get('ch-1')).toBeNull();
  });

  it('caches and returns a row set at the current epoch', () => {
    service.set('ch-1', row, service.getEpoch('ch-1'));
    expect(service.get('ch-1')).toEqual(row);
  });

  it('evicts a cached row on invalidate', () => {
    service.set('ch-1', row, service.getEpoch('ch-1'));
    service.invalidate('ch-1');
    expect(service.get('ch-1')).toBeNull();
  });

  // #988: `updateChannel` calls `invalidate` right after its write commits.
  // A push-worker read that began *before* that write can still resolve
  // after it — an in-flight SELECT racing an UPDATE — and a `set()` with no
  // fencing would silently re-cache the pre-write row, restoring the
  // staleness window `invalidate` exists to close.
  it('discards a set() whose epoch predates an intervening invalidate', () => {
    const staleEpoch = service.getEpoch('ch-1'); // captured before the "read" starts
    service.invalidate('ch-1'); // a write commits and evicts while the read is in flight
    service.set('ch-1', row, staleEpoch); // the stale read resolves and tries to cache

    expect(service.get('ch-1')).toBeNull();
  });

  it('accepts a set() at the current epoch even after a prior invalidate', () => {
    service.invalidate('ch-1');
    service.set('ch-1', row, service.getEpoch('ch-1'));
    expect(service.get('ch-1')).toEqual(row);
  });

  it('invalidating a never-cached channel does not throw and still bumps its epoch', () => {
    const before = service.getEpoch('ch-1');
    service.invalidate('ch-1');
    expect(service.getEpoch('ch-1')).toBe(before + 1);
  });
});
