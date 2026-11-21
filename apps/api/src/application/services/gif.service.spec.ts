import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type {
  GifPage,
  GifResult,
  GifSearchOutcome,
  IGifSearch,
} from '#domain/adapters/gif-search.interface';
import { isKlipyMediaUrl } from '../../infrastructure/gifs/klipy-gif-search';
import type { GifFavorite } from '#domain/entities';
import type { IGifFavoriteRepository } from '#domain/repositories/gif-favorite.repository.interface';
import { GIF_FAVORITES_MAX, GifService } from './gif.service';

const dance: GifResult = {
  id: 'dance',
  title: 'Happy dance',
  preview: { url: 'https://static.klipy.com/s.webp', width: 220, height: 124 },
  full: { url: 'https://static.klipy.com/h.webp', width: 498, height: 280 },
};

function pageOf(results: GifResult[], next_page: number | null = 2): GifPage {
  return { results, next_page };
}

function okOutcome(page: GifPage = pageOf([dance])): GifSearchOutcome {
  return { outcome: 'ok', page };
}

function fakeSearch(configured = true) {
  return {
    provider: 'KLIPY',
    isConfigured: jest.fn(() => configured),
    isMediaUrl: jest.fn(isKlipyMediaUrl),
    trending: jest.fn<Promise<GifSearchOutcome>, [number]>(() =>
      Promise.resolve(okOutcome()),
    ),
    search: jest.fn<Promise<GifSearchOutcome>, [string, number]>(() =>
      Promise.resolve(okOutcome()),
    ),
    recordShare: jest.fn<Promise<void>, [string]>(() => Promise.resolve()),
    sign: jest.fn((message: string) =>
      configured
        ? createHmac('sha256', 'test').update(message).digest('base64url')
        : null,
    ),
  } satisfies IGifSearch;
}

function fakeFavorites(
  rows: GifFavorite[] = [],
  count = rows.length,
  starred = false,
) {
  return {
    listByUser: jest.fn((_user: string, provider: string) =>
      Promise.resolve(rows.filter((row) => row.provider === provider)),
    ),
    countByUser: jest.fn(() => Promise.resolve(count)),
    has: jest.fn(() => Promise.resolve(starred)),
    add: jest.fn(() => Promise.resolve()),
    remove: jest.fn(() => Promise.resolve()),
  } satisfies IGifFavoriteRepository;
}

describe('GifService', () => {
  it('says whether GIFs are set up, and by whom', () => {
    expect(
      new GifService(fakeSearch(false), fakeFavorites()).availability(),
    ).toEqual({
      available: false,
      provider: 'KLIPY',
    });
  });

  it('answers 503, not an empty list, when no key is set', async () => {
    const service = new GifService(fakeSearch(false), fakeFavorites());
    await expect(service.trending(1)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('answers 503 when the provider is down', async () => {
    const search = fakeSearch();
    search.search.mockResolvedValue({ outcome: 'unavailable' });
    await expect(
      new GifService(search, fakeFavorites()).search('party', 1),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('caches trending and repeated searches', async () => {
    const search = fakeSearch();
    const service = new GifService(search, fakeFavorites());
    await service.trending(1);
    await service.trending(1);
    await service.search('Party ', 1);
    await service.search('party', 1);
    expect(search.trending).toHaveBeenCalledTimes(1);
    expect(search.search).toHaveBeenCalledTimes(1);
    expect(search.search).toHaveBeenCalledWith('party', 1);
  });

  it('serves trending for a blank search', async () => {
    const search = fakeSearch();
    await new GifService(search, fakeFavorites()).search('   ', 1);
    expect(search.trending).toHaveBeenCalled();
    expect(search.search).not.toHaveBeenCalled();
  });

  it('signs every result it hands out', async () => {
    const page = await new GifService(fakeSearch(), fakeFavorites()).trending(
      1,
    );
    expect(page.results).toHaveLength(1);
    expect(page.results[0]?.token).toMatch(/^[\w-]{43}$/);
  });

  it('leaves out a result a send would refuse', async () => {
    const search = fakeSearch();
    const sliver = {
      ...dance,
      id: 'sliver',
      full: { ...dance.full, width: 4000, height: 10 },
    };
    search.trending.mockResolvedValue(okOutcome(pageOf([sliver, dance])));
    const page = await new GifService(search, fakeFavorites()).trending(1);
    expect(page.results.map((gif) => gif.id)).toEqual(['dance']);
  });

  it('ends the list at the last page a client may ask for', async () => {
    const search = fakeSearch();
    search.trending.mockResolvedValue(okOutcome(pageOf([dance], 51)));
    expect(
      (await new GifService(search, fakeFavorites()).trending(50)).next_page,
    ).toBeNull();
  });

  it('tells the provider about a share only when set up', () => {
    const on = fakeSearch();
    new GifService(on, fakeFavorites()).recordShare('dance');
    expect(on.recordShare).toHaveBeenCalledWith('dance');
    const off = fakeSearch(false);
    new GifService(off, fakeFavorites()).recordShare('dance');
    expect(off.recordShare).not.toHaveBeenCalled();
  });

  describe('messageGif', () => {
    const service = new GifService(fakeSearch(), fakeFavorites());
    let sent: {
      id: string;
      title: string;
      url: string;
      width: number;
      height: number;
      token: string;
    };

    beforeAll(async () => {
      const [gif] = (await service.trending(1)).results;
      sent = {
        ...gif.full,
        id: gif.id,
        title: '  Happy dance ',
        token: gif.token,
      };
    });

    it('normalizes a GIF this server handed out', () => {
      expect(service.messageGif(sent)).toEqual({
        provider: 'klipy',
        id: 'dance',
        title: 'Happy dance',
        url: 'https://static.klipy.com/h.webp',
        width: 498,
        height: 280,
      });
    });

    it('refuses a GIF its search never returned (the PG-13 lock)', () => {
      const other = 'https://static.klipy.com/unrated.webp';
      expect(() => service.messageGif({ ...sent, url: other })).toThrow(
        BadRequestException,
      );
      expect(() => service.messageGif({ ...sent, id: 'other' })).toThrow(
        BadRequestException,
      );
      expect(() => service.messageGif({ ...sent, width: 497 })).toThrow(
        BadRequestException,
      );
      expect(() => service.messageGif({ ...sent, token: 'forged' })).toThrow(
        BadRequestException,
      );
    });

    it.each([
      'https://evil.test/h.webp',
      'http://static.klipy.com/h.webp',
      'https://static.klipy.com.evil.test/h.webp',
      'javascript:alert(1)',
    ])('refuses %s', (url) => {
      expect(() => service.messageGif({ ...sent, url })).toThrow(
        BadRequestException,
      );
    });

    it('refuses a size out of range or too thin to draw', () => {
      expect(() => service.messageGif({ ...sent, width: 0 })).toThrow(
        BadRequestException,
      );
      expect(() => service.messageGif({ ...sent, height: 5000 })).toThrow(
        BadRequestException,
      );
      expect(() =>
        service.messageGif({ ...sent, width: 4096, height: 1 }),
      ).toThrow(BadRequestException);
    });

    it('answers 503 when GIFs are not set up', () => {
      expect(() =>
        new GifService(fakeSearch(false), fakeFavorites()).messageGif(sent),
      ).toThrow(ServiceUnavailableException);
    });
  });

  describe('favorites (#5772)', () => {
    const starred: GifFavorite = {
      id: 'f1',
      user_id: 'u1',
      provider: 'klipy',
      gif_id: dance.id,
      title: dance.title,
      full_url: dance.full.url,
      full_width: dance.full.width,
      full_height: dance.full.height,
      preview_url: dance.preview.url,
      preview_width: dance.preview.width,
      preview_height: dance.preview.height,
      created_at: '2026-11-20T00:00:00Z',
    };

    it('lists them signed, so a send from Favorites passes the check', async () => {
      const service = new GifService(fakeSearch(), fakeFavorites([starred]));
      const page = await service.listFavorites('u1');
      expect(page.next_page).toBeNull();
      expect(page.results).toHaveLength(1);
      const [gif] = page.results;
      expect(gif.preview).toEqual(dance.preview);
      expect(() =>
        service.messageGif({
          id: gif.id,
          url: gif.full.url,
          width: gif.full.width,
          height: gif.full.height,
          token: gif.token,
        }),
      ).not.toThrow();
    });

    it("asks only for this server's provider", async () => {
      const favorites = fakeFavorites([{ ...starred, provider: 'tenor' }]);
      const service = new GifService(fakeSearch(), favorites);
      expect((await service.listFavorites('u1')).results).toEqual([]);
      expect(favorites.listByUser).toHaveBeenCalledWith('u1', 'klipy');
    });

    it('stars only a GIF this server handed out', async () => {
      const favorites = fakeFavorites();
      const service = new GifService(fakeSearch(), favorites);
      const [signed] = (await service.trending(1)).results;
      await service.addFavorite('u1', signed);
      expect(favorites.add).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          provider: 'klipy',
          gif_id: 'dance',
          full_url: dance.full.url,
          preview_url: dance.preview.url,
        }),
      );
      await expect(
        service.addFavorite('u1', { ...signed, token: 'forged' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.addFavorite('u1', {
          ...signed,
          preview: { ...signed.preview, url: 'https://evil.test/s.webp' },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a star past the limit, with the reason', async () => {
      const favorites = fakeFavorites([], GIF_FAVORITES_MAX);
      const service = new GifService(fakeSearch(), favorites);
      const [signed] = (await service.trending(1)).results;
      await expect(service.addFavorite('u1', signed)).rejects.toThrow(
        /up to 200 favorite GIFs/,
      );
      expect(favorites.add).not.toHaveBeenCalled();
      expect(favorites.countByUser).toHaveBeenCalledWith('u1', 'klipy');
    });

    it('lets a re-star through at the limit as a no-op', async () => {
      const favorites = fakeFavorites([], GIF_FAVORITES_MAX, true);
      const service = new GifService(fakeSearch(), favorites);
      const [signed] = (await service.trending(1)).results;
      await expect(service.addFavorite('u1', signed)).resolves.toBeUndefined();
      expect(favorites.has).toHaveBeenCalledWith('u1', 'klipy', 'dance');
      expect(favorites.add).not.toHaveBeenCalled();
    });

    it("unstars by this server's provider", async () => {
      const favorites = fakeFavorites();
      await new GifService(fakeSearch(), favorites).removeFavorite(
        'u1',
        'dance',
      );
      expect(favorites.remove).toHaveBeenCalledWith('u1', 'klipy', 'dance');
    });
  });
});
