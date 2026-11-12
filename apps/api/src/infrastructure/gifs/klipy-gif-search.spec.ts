import {
  isKlipyMediaUrl,
  KlipyGifSearch,
  klipyItemToResult,
  pageOf,
} from './klipy-gif-search';

const rendition = (url: string, width = 498, height = 280) => ({
  url,
  width,
  height,
  size: 1000,
});

const item = (slug: string, extra: Record<string, unknown> = {}) => ({
  id: 1,
  slug,
  title: 'Happy dance',
  type: 'gif',
  file: {
    hd: {
      webp: rendition(`https://static.klipy.com/ii/${slug}/hd.webp`),
      gif: rendition(`https://static.klipy.com/ii/${slug}/hd.gif`),
    },
    sm: {
      webp: rendition(`https://static.klipy.com/ii/${slug}/sm.webp`, 220, 124),
    },
  },
  ...extra,
});

describe('isKlipyMediaUrl', () => {
  it.each([
    ['https://static.klipy.com/a.webp', true],
    ['https://klipy.com/a.webp', true],
    ['http://static.klipy.com/a.webp', false],
    ['https://static.klipy.com.evil.test/a.webp', false],
    ['https://evilklipy.com/a.webp', false],
    ['https://user:pass@static.klipy.com/a.webp', false],
    ['https://static.klipy.com:8443/a.webp', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isKlipyMediaUrl(url)).toBe(expected);
  });
});

describe('klipyItemToResult', () => {
  it('takes the WebP renditions: hd for the message, sm for the grid', () => {
    expect(klipyItemToResult(item('dance'))).toEqual({
      id: 'dance',
      title: 'Happy dance',
      full: {
        url: 'https://static.klipy.com/ii/dance/hd.webp',
        width: 498,
        height: 280,
      },
      preview: {
        url: 'https://static.klipy.com/ii/dance/sm.webp',
        width: 220,
        height: 124,
      },
    });
  });

  it('drops an ad, an item with no slug, and one whose media is off KLIPY', () => {
    expect(klipyItemToResult(item('ad', { type: 'ad' }))).toBeNull();
    expect(klipyItemToResult(item('', {}))).toBeNull();
    expect(
      klipyItemToResult({
        slug: 'x',
        file: { hd: { webp: rendition('https://evil.test/x.webp') } },
      }),
    ).toBeNull();
  });
});

describe('pageOf', () => {
  it('reads the envelope and the next page', () => {
    const page = pageOf(
      { result: true, data: { data: [item('a'), item('b')], has_next: true } },
      2,
    );
    expect(page?.results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page?.next_page).toBe(3);
  });

  it('is null for a shape it does not know', () => {
    expect(pageOf({ result: false }, 1)).toBeNull();
    expect(pageOf(null, 1)).toBeNull();
  });
});

describe('KlipyGifSearch', () => {
  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it('is unavailable without a key, and calls nothing', async () => {
    const fetchImpl = jest.fn();
    const gifs = new KlipyGifSearch(null, fetchImpl);
    expect(gifs.isConfigured()).toBe(false);
    await expect(gifs.trending(1, 'c')).resolves.toEqual({
      outcome: 'unavailable',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('searches with the PG-13 ceiling and never asks for ads', async () => {
    const fetchImpl = jest.fn(() =>
      ok({ result: true, data: { data: [item('a')], has_next: false } }),
    );
    const gifs = new KlipyGifSearch('key-123', fetchImpl);
    const outcome = await gifs.search('party', 1, 'cust');
    expect(outcome).toMatchObject({ outcome: 'ok' });
    const url = new URL((fetchImpl.mock.calls[0] as unknown[])[0] as string);
    expect(url.pathname).toBe('/api/v1/key-123/gifs/search');
    expect(url.searchParams.get('q')).toBe('party');
    expect(url.searchParams.get('rating')).toBe('pg-13');
    expect(url.searchParams.get('customer_id')).toBe('cust');
    expect([...url.searchParams.keys()].some((k) => k.startsWith('ad'))).toBe(
      false,
    );
  });

  it('answers unavailable on an error status, a throw, or a bad body', async () => {
    const statuses = [
      () => Promise.resolve(new Response('key-123 not found', { status: 404 })),
      () => Promise.reject(new Error('timeout')),
      () => Promise.resolve(new Response('nope', { status: 200 })),
    ];
    for (const answer of statuses) {
      const gifs = new KlipyGifSearch('key-123', jest.fn(answer));
      await expect(gifs.trending(1, 'c')).resolves.toEqual({
        outcome: 'unavailable',
      });
    }
  });

  it('records a share without throwing when KLIPY is down', async () => {
    const fetchImpl = jest.fn(() => Promise.reject(new Error('down')));
    const gifs = new KlipyGifSearch('key-123', fetchImpl);
    await expect(gifs.recordShare('dance', 'cust')).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.klipy.com/api/v1/key-123/gifs/share/dance');
    expect(JSON.parse(init.body as string)).toEqual({ customer_id: 'cust' });
  });
});
