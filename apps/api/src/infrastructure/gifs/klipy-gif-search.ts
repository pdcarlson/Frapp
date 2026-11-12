import { Logger } from '@nestjs/common';
import type {
  GifPage,
  GifRendition,
  GifResult,
  GifSearchOutcome,
  IGifSearch,
} from '#domain/adapters/gif-search.interface';

/**
 * KLIPY (klipy.com), the GIF library Discord moved to when Google shut the
 * Tenor API down on 2026-06-30 (#4631).
 *
 * - The key is a path segment (`/api/v1/{key}/gifs/...`), so a request URL is
 *   a secret: never logged, never put on an error. KLIPY's own 404 for a bad
 *   key echoes the key in its body, so bodies are never logged either.
 * - `rating=pg-13` on every call is Frapp's ceiling, not a member's choice: a
 *   client can't raise it because a client never reaches KLIPY. The partner
 *   panel's content filter is the second lock on the same door.
 * - No ad parameters are ever sent, so KLIPY returns no ads; an item typed
 *   `ad` is dropped anyway, in case that changes.
 * - Media hotlinks from `static.klipy.com`. WebP is chosen over GIF: the same
 *   frames are several times smaller.
 */
const KLIPY_API = 'https://api.klipy.com/api/v1';
export const KLIPY_MEDIA_HOST = 'klipy.com';
const KLIPY_TIMEOUT_MS = 4_000;
const KLIPY_PER_PAGE = 24;

type Fetch = typeof fetch;

interface KlipyFileInfo {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}
type KlipyFileSize = Partial<Record<'gif' | 'webp' | 'mp4', KlipyFileInfo>>;
interface KlipyItem {
  slug?: unknown;
  title?: unknown;
  type?: unknown;
  file?: Partial<Record<'hd' | 'md' | 'sm' | 'xs', KlipyFileSize>>;
}

/**
 * Whether a rendition URL is KLIPY's own https media. Exported because the
 * send route holds a GIF message to the same rule: a message can't smuggle in
 * an arbitrary image URL by calling itself a GIF.
 */
export function isKlipyMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port) return false;
  const host = url.hostname.toLowerCase();
  return host === KLIPY_MEDIA_HOST || host.endsWith(`.${KLIPY_MEDIA_HOST}`);
}

function rendition(info: KlipyFileInfo | undefined): GifRendition | null {
  if (!info) return null;
  const { url, width, height } = info;
  if (typeof url !== 'string' || !isKlipyMediaUrl(url)) return null;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (!(width > 0 && height > 0)) return null;
  return { url, width: Math.round(width), height: Math.round(height) };
}

/** The first usable rendition, in order of preference. */
function firstOf(
  file: KlipyItem['file'],
  picks: ReadonlyArray<['hd' | 'md' | 'sm' | 'xs', 'webp' | 'gif']>,
): GifRendition | null {
  for (const [size, format] of picks) {
    const found = rendition(file?.[size]?.[format]);
    if (found) return found;
  }
  return null;
}

/** One KLIPY item as Frapp's result, or `null` for an ad or a broken item. */
export function klipyItemToResult(item: KlipyItem): GifResult | null {
  if (item.type === 'ad') return null;
  if (typeof item.slug !== 'string' || item.slug.length === 0) return null;
  // ~500px for a message, ~220px for a grid tile; GIF only when no WebP.
  const full = firstOf(item.file, [
    ['hd', 'webp'],
    ['md', 'webp'],
    ['hd', 'gif'],
    ['md', 'gif'],
  ]);
  const preview = firstOf(item.file, [
    ['sm', 'webp'],
    ['xs', 'webp'],
    ['sm', 'gif'],
  ]);
  if (!full) return null;
  return {
    id: item.slug,
    title: typeof item.title === 'string' ? item.title.slice(0, 200) : '',
    preview: preview ?? full,
    full,
  };
}

export class KlipyGifSearch implements IGifSearch {
  readonly provider = 'KLIPY';
  readonly mediaHost = KLIPY_MEDIA_HOST;
  private readonly logger = new Logger(KlipyGifSearch.name);

  constructor(
    private readonly apiKey: string | null,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  trending(page: number, customerId: string): Promise<GifSearchOutcome> {
    return this.list('trending', { page, customer_id: customerId });
  }

  search(
    query: string,
    page: number,
    customerId: string,
  ): Promise<GifSearchOutcome> {
    return this.list('search', { q: query, page, customer_id: customerId });
  }

  recent(page: number, customerId: string): Promise<GifSearchOutcome> {
    return this.list(`recent/${encodeURIComponent(customerId)}`, { page });
  }

  async recordShare(id: string, customerId: string): Promise<void> {
    if (!this.apiKey) return;
    try {
      const response = await this.fetchImpl(
        `${this.base()}/share/${encodeURIComponent(id)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer_id: customerId }),
          signal: AbortSignal.timeout(KLIPY_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        this.logger.warn(`KLIPY share answered ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`KLIPY share failed: ${errorName(error)}`);
    }
  }

  private base(): string {
    return `${KLIPY_API}/${encodeURIComponent(this.apiKey ?? '')}/gifs`;
  }

  private async list(
    path: string,
    params: Record<string, string | number>,
  ): Promise<GifSearchOutcome> {
    if (!this.apiKey) return { outcome: 'unavailable' };
    const query = new URLSearchParams({
      per_page: String(KLIPY_PER_PAGE),
      locale: 'en',
      rating: 'pg-13',
      content_filter: 'medium',
    });
    for (const [key, value] of Object.entries(params)) {
      query.set(key, String(value));
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base()}/${path}?${query}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(KLIPY_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`KLIPY ${label(path)} failed: ${errorName(error)}`);
      return { outcome: 'unavailable' };
    }
    if (!response.ok) {
      // Status only: the body of a 404 echoes the key.
      this.logger.warn(`KLIPY ${label(path)} answered ${response.status}`);
      return { outcome: 'unavailable' };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.warn(`KLIPY ${label(path)} sent a body that isn't JSON`);
      return { outcome: 'unavailable' };
    }
    const page = pageOf(body, Number(params.page) || 1);
    if (!page) {
      this.logger.warn(`KLIPY ${label(path)} sent an unexpected shape`);
      return { outcome: 'unavailable' };
    }
    return { outcome: 'ok', page };
  }
}

/** The route name for a log line, never the customer id in a recents path. */
function label(path: string): string {
  return path.split('/')[0] ?? 'call';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

/** `{ result, data: { data: [...], has_next } }` as a page, or `null`. */
export function pageOf(body: unknown, page: number): GifPage | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const items = (data as { data?: unknown }).data;
  if (!Array.isArray(items)) return null;
  const results = items
    .map((item) =>
      item && typeof item === 'object'
        ? klipyItemToResult(item as KlipyItem)
        : null,
    )
    .filter((result): result is GifResult => result !== null);
  const hasNext = (data as { has_next?: unknown }).has_next === true;
  return { results, next_page: hasNext ? page + 1 : null };
}
