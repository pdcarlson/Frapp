import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  GIF_SEARCH,
  type GifPage,
  type GifSearchOutcome,
  type IGifSearch,
} from '#domain/adapters/gif-search.interface';

/**
 * What a GIF message stores in `metadata.gif` (#4631). Server-written only:
 * `ChatService` drops a client's own `metadata.gif`, so the only way in is
 * {@link GifService.messageGif}, which holds the URL to the provider's media
 * host and the size to sane bounds.
 */
export interface MessageGif {
  provider: string;
  id: string;
  title: string;
  url: string;
  width: number;
  height: number;
}

/** What a client sends with a GIF message, before it is checked. */
export interface MessageGifInput {
  id: string;
  title?: string;
  url: string;
  width: number;
  height: number;
}

const TRENDING_TTL_MS = 5 * 60_000;
const SEARCH_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 300;
/** Trending is the same for everyone, so its pages are cached under this id. */
const SHARED_CUSTOMER = 'frapp';
const MAX_DIMENSION = 4096;

interface CacheEntry {
  page: GifPage;
  expires: number;
}

/**
 * GIF search for the chat picker (#4631): the provider behind
 * {@link IGifSearch}, a member's pseudonymous provider id, and a small cache.
 *
 * The cache matters because a KLIPY test key allows 100 calls an hour for the
 * whole app: trending is shared by everyone and searches repeat ("lol",
 * "congrats"), so most picker opens never reach the provider.
 */
@Injectable()
export class GifService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Inject(GIF_SEARCH) private readonly gifs: IGifSearch) {}

  availability(): { available: boolean; provider: string } {
    return {
      available: this.gifs.isConfigured(),
      provider: this.gifs.provider,
    };
  }

  async trending(page: number): Promise<GifPage> {
    return this.cached(`t:${page}`, TRENDING_TTL_MS, () =>
      this.gifs.trending(page, SHARED_CUSTOMER),
    );
  }

  async search(userId: string, query: string, page: number): Promise<GifPage> {
    const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) return this.trending(page);
    return this.cached(`s:${page}:${q}`, SEARCH_TTL_MS, () =>
      this.gifs.search(q, page, this.customerId(userId)),
    );
  }

  /** Never cached: it's one member's own list, and it changes as they send. */
  async recent(userId: string, page: number): Promise<GifPage> {
    this.assertConfigured();
    return this.unwrap(await this.gifs.recent(page, this.customerId(userId)));
  }

  /** Fire and forget: a provider that's down never fails a send. */
  recordShare(userId: string, gifId: string): void {
    if (!this.gifs.isConfigured()) return;
    void this.gifs.recordShare(gifId, this.customerId(userId));
  }

  /**
   * A client's GIF, checked and normalized for `metadata.gif`, or a 400.
   * Not checked against the provider: a member who has the URL of a KLIPY
   * GIF may send it, as they could paste it as a link.
   */
  messageGif(input: MessageGifInput): MessageGif {
    if (!this.isMediaUrl(input.url)) {
      throw new BadRequestException(
        "gif.url must be the GIF provider's own https media URL",
      );
    }
    const width = Math.round(input.width);
    const height = Math.round(input.height);
    if (
      !(width > 0 && width <= MAX_DIMENSION) ||
      !(height > 0 && height <= MAX_DIMENSION)
    ) {
      throw new BadRequestException('gif width and height are out of range');
    }
    return {
      provider: this.gifs.provider.toLowerCase(),
      id: input.id,
      title: (input.title ?? '').trim().slice(0, 200),
      url: input.url,
      width,
      height,
    };
  }

  private isMediaUrl(raw: string): boolean {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
      return false;
    const host = url.hostname.toLowerCase();
    const media = this.gifs.mediaHost.toLowerCase();
    return host === media || host.endsWith(`.${media}`);
  }

  /**
   * A stable id the provider can key a member's recents on that isn't their
   * Frapp id: an HMAC of the user id under the provider key, which the
   * provider never sees in this form.
   */
  private customerId(userId: string): string {
    const secret =
      process.env.ANALYTICS_HMAC_SALT?.trim() ||
      process.env.KLIPY_API_KEY?.trim() ||
      'frapp-gifs';
    return createHmac('sha256', secret)
      .update(`gif:${userId}`)
      .digest('hex')
      .slice(0, 32);
  }

  private assertConfigured(): void {
    if (!this.gifs.isConfigured()) {
      throw new ServiceUnavailableException("GIFs aren't set up yet");
    }
  }

  private unwrap(outcome: GifSearchOutcome): GifPage {
    if (outcome.outcome === 'ok') return outcome.page;
    throw new ServiceUnavailableException("GIFs couldn't load right now");
  }

  private async cached(
    key: string,
    ttl: number,
    load: () => Promise<GifSearchOutcome>,
  ): Promise<GifPage> {
    this.assertConfigured();
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && hit.expires > now) return hit.page;
    const page = this.unwrap(await load());
    this.cache.delete(key);
    this.cache.set(key, { page, expires: now + ttl });
    // Oldest first, as a Map keeps insertion order.
    for (const oldest of Array.from(this.cache.keys())) {
      if (this.cache.size <= CACHE_MAX_ENTRIES) break;
      this.cache.delete(oldest);
    }
    return page;
  }
}
