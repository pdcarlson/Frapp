import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  GifPage,
  GifSearchOutcome,
  IGifSearch,
} from '#domain/adapters/gif-search.interface';
import { GifService } from './gif.service';

const page: GifPage = {
  results: [
    {
      id: 'dance',
      title: 'Happy dance',
      preview: {
        url: 'https://static.klipy.com/s.webp',
        width: 220,
        height: 124,
      },
      full: { url: 'https://static.klipy.com/h.webp', width: 498, height: 280 },
    },
  ],
  next_page: 2,
};

const ok: GifSearchOutcome = { outcome: 'ok', page };

function fakeSearch(configured = true): jest.Mocked<IGifSearch> {
  return {
    provider: 'KLIPY',
    mediaHost: 'klipy.com',
    isConfigured: jest.fn(() => configured),
    trending: jest.fn<ReturnType<IGifSearch['trending']>, [number, string]>(
      () => Promise.resolve(ok),
    ),
    search: jest.fn<ReturnType<IGifSearch['search']>, [string, number, string]>(
      () => Promise.resolve(ok),
    ),
    recent: jest.fn<ReturnType<IGifSearch['recent']>, [number, string]>(() =>
      Promise.resolve(ok),
    ),
    recordShare: jest.fn<Promise<void>, [string, string]>(() =>
      Promise.resolve(),
    ),
  };
}

describe('GifService', () => {
  it('says whether GIFs are set up, and by whom', () => {
    expect(new GifService(fakeSearch(false)).availability()).toEqual({
      available: false,
      provider: 'KLIPY',
    });
  });

  it('answers 503, not an empty list, when no key is set', async () => {
    const service = new GifService(fakeSearch(false));
    await expect(service.trending(1)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('answers 503 when the provider is down', async () => {
    const search = fakeSearch();
    search.search.mockResolvedValue({ outcome: 'unavailable' });
    await expect(
      new GifService(search).search('u-1', 'party', 1),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('caches trending and repeated searches', async () => {
    const search = fakeSearch();
    const service = new GifService(search);
    await service.trending(1);
    await service.trending(1);
    await service.search('u-1', 'Party ', 1);
    await service.search('u-2', 'party', 1);
    expect(search.trending).toHaveBeenCalledTimes(1);
    expect(search.search).toHaveBeenCalledTimes(1);
  });

  it('serves trending for a blank search', async () => {
    const search = fakeSearch();
    await new GifService(search).search('u-1', '   ', 1);
    expect(search.trending).toHaveBeenCalled();
    expect(search.search).not.toHaveBeenCalled();
  });

  it('sends the provider a pseudonymous id, never the user id', async () => {
    const search = fakeSearch();
    await new GifService(search).recent('user-123', 1);
    const customerId = search.recent.mock.calls[0]?.[1];
    expect(customerId).toMatch(/^[0-9a-f]{32}$/);
    expect(customerId).not.toContain('user-123');
  });

  describe('messageGif', () => {
    const service = new GifService(fakeSearch());
    const base = {
      id: 'dance',
      title: '  Happy dance ',
      url: 'https://static.klipy.com/h.webp',
      width: 498,
      height: 280,
    };

    it('normalizes a GIF from the provider', () => {
      expect(service.messageGif(base)).toEqual({
        provider: 'klipy',
        id: 'dance',
        title: 'Happy dance',
        url: 'https://static.klipy.com/h.webp',
        width: 498,
        height: 280,
      });
    });

    it.each([
      'https://evil.test/h.webp',
      'http://static.klipy.com/h.webp',
      'https://static.klipy.com.evil.test/h.webp',
      'javascript:alert(1)',
    ])('refuses %s', (url) => {
      expect(() => service.messageGif({ ...base, url })).toThrow(
        BadRequestException,
      );
    });

    it('refuses a size out of range', () => {
      expect(() => service.messageGif({ ...base, width: 0 })).toThrow(
        BadRequestException,
      );
      expect(() => service.messageGif({ ...base, height: 5000 })).toThrow(
        BadRequestException,
      );
    });
  });
});
