import { ProfilePhotoUrlService } from './profile-photo-url.service';
import type { IStorageProvider } from '#domain/adapters/storage.interface';

describe('ProfilePhotoUrlService', () => {
  let storage: jest.Mocked<Pick<IStorageProvider, 'getSignedDownloadUrls'>>;
  let service: ProfilePhotoUrlService;

  const own = 'chapters/ch-1/profiles/user-1/a.jpg';

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-29T12:00:00Z') });
    storage = {
      getSignedDownloadUrls: jest.fn(async (_bucket, paths) =>
        Object.fromEntries(
          paths.map((path) => [path, `signed:${path}@${Date.now()}`]),
        ),
      ),
    };
    service = new ProfilePhotoUrlService(storage);
  });

  afterEach(() => jest.useRealTimers());

  const row = (user_id: string, avatar_url: string | null) => ({
    user_id,
    avatar_url,
  });

  it("signs a path in the owner's own folder, in one batch", async () => {
    const other = 'chapters/ch-1/profiles/user-2/b.png';
    const result = await service.signRows(
      [row('user-1', own), row('user-2', other)],
      (r) => r.user_id,
    );

    expect(storage.getSignedDownloadUrls).toHaveBeenCalledTimes(1);
    expect(storage.getSignedDownloadUrls).toHaveBeenCalledWith(
      'profiles',
      [own, other],
      3600,
    );
    expect(result.map((r) => r.avatar_url)).toEqual([
      expect.stringMatching(/^signed:chapters\/ch-1\/profiles\/user-1\/a\.jpg/),
      expect.stringMatching(/^signed:chapters\/ch-1\/profiles\/user-2\/b\.png/),
    ]);
  });

  it.each([
    ["another member's folder", 'chapters/ch-1/profiles/user-2/a.jpg'],
    ['a nested key', 'chapters/ch-1/profiles/user-1/x/a.jpg'],
    ['a dot segment', 'chapters/ch-1/profiles/user-1/..'],
    ['another bucket layout', 'chapters/ch-1/documents/d/a.pdf'],
    ['a plain-http URL', 'http://example.com/a.jpg'],
    ['a javascript: URL', 'javascript:alert(1)'],
  ])('serves null for %s and signs nothing (#2519)', async (_label, value) => {
    const [result] = await service.signRows(
      [row('user-1', value)],
      (r) => r.user_id,
    );

    expect(result.avatar_url).toBeNull();
    expect(storage.getSignedDownloadUrls).not.toHaveBeenCalled();
  });

  it('passes an https URL through unsigned', async () => {
    const url = 'https://lh3.googleusercontent.com/a/photo';
    const [result] = await service.signRows(
      [row('user-1', url)],
      (r) => r.user_id,
    );

    expect(result.avatar_url).toBe(url);
    expect(storage.getSignedDownloadUrls).not.toHaveBeenCalled();
  });

  it('keeps the other fields and does not mutate the input', async () => {
    const input = { ...row('user-1', own), display_name: 'Ann' };
    const [result] = await service.signRows([input], (r) => r.user_id);

    expect(result.display_name).toBe('Ann');
    expect(input.avatar_url).toBe(own);
  });

  it('reuses a URL for half its lifetime, then re-signs', async () => {
    const [first] = await service.signRows(
      [row('user-1', own)],
      (r) => r.user_id,
    );
    jest.advanceTimersByTime(29 * 60_000);
    const [second] = await service.signRows(
      [row('user-1', own)],
      (r) => r.user_id,
    );
    jest.advanceTimersByTime(2 * 60_000);
    const [third] = await service.signRows(
      [row('user-1', own)],
      (r) => r.user_id,
    );

    expect(second.avatar_url).toBe(first.avatar_url);
    expect(third.avatar_url).not.toBe(first.avatar_url);
    expect(storage.getSignedDownloadUrls).toHaveBeenCalledTimes(2);
  });

  it('degrades to null when signing fails, without throwing', async () => {
    storage.getSignedDownloadUrls.mockRejectedValue(new Error('storage down'));

    const [result] = await service.signRows(
      [row('user-1', own)],
      (r) => r.user_id,
    );

    expect(result.avatar_url).toBeNull();
  });

  it('serves a URL past its reuse window when re-signing fails, but never an expired one', async () => {
    const [first] = await service.signRows(
      [row('user-1', own)],
      (r) => r.user_id,
    );
    storage.getSignedDownloadUrls.mockRejectedValue(new Error('storage down'));

    jest.advanceTimersByTime(40 * 60_000);
    const [stillLive] = await service.signRows(
      [row('user-1', own)],
      (r) => r.user_id,
    );
    jest.advanceTimersByTime(20 * 60_000);
    const [expired] = await service.signRows(
      [row('user-1', own)],
      (r) => r.user_id,
    );

    expect(stillLive.avatar_url).toBe(first.avatar_url);
    expect(expired.avatar_url).toBeNull();
  });

  it('serves null for a path storage could not sign', async () => {
    storage.getSignedDownloadUrls.mockResolvedValue({});

    const [result] = await service.signRows(
      [row('user-1', own)],
      (r) => r.user_id,
    );

    expect(result.avatar_url).toBeNull();
  });
});
