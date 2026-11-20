import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GIF_FAVORITE_REPOSITORY,
  type IGifFavoriteRepository,
} from '#domain/repositories/gif-favorite.repository.interface';
import { timingSafeEqual } from 'node:crypto';
import {
  GIF_PAGE_MAX,
  GIF_SEARCH,
  MAX_GIF_EDGE,
  type GifPage,
  type GifResult,
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
  /** The `token` the result carried when this server handed it out. */
  token: string;
}

/** How many GIFs a member may star; Favorites lists them all, unpaged. */
export const GIF_FAVORITES_MAX = 200;

/** What a star sends: a picker result as the client got it. */
export interface GifFavoriteRequest {
  id: string;
  title?: string;
  preview: { url: string; width: number; height: number };
  full: { url: string; width: number; height: number };
  token: string;
}

/** A result as a client gets it: signed, so a send can prove where it came from. */
interface SignedGifResult extends GifResult {
  token: string;
}

export interface SignedGifPage {
  results: SignedGifResult[];
  next_page: number | null;
}

const TRENDING_TTL_MS = 5 * 60_000;
const SEARCH_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 300;
/** Wider or taller than this draws as a sliver, so a send is refused. */
const MAX_GIF_ASPECT = 8;

interface CacheEntry {
  page: SignedGifPage;
  expires: number;
}

/**
 * GIF search for the chat picker (#4631): the provider behind
 * {@link IGifSearch}, a small cache, and the check a GIF message passes.
 *
 * The cache matters because a KLIPY test key allows 100 calls an hour for the
 * whole app: trending is the same for everyone and searches repeat ("lol",
 * "congrats"), so most picker opens never reach the provider. It is one cache
 * per API process, shared by every chapter: nothing in it is a member's.
 *
 * Every result carries a `token`, an HMAC of what a message would store, and
 * a send must bring it back. That holds a GIF message to what this server's
 * own PG-13 search returned: a client can't send an arbitrary item from the
 * provider's media host by naming its URL.
 */
@Injectable()
export class GifService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(GIF_SEARCH) private readonly gifs: IGifSearch,
    @Inject(GIF_FAVORITE_REPOSITORY)
    private readonly favorites: IGifFavoriteRepository,
  ) {}

  /**
   * The member's favorites (#5772), newest first, each signed as a search
   * result is, so a send from Favorites passes the same check. A favorite
   * from another provider than this server's is left out: its token could
   * never match.
   */
  async listFavorites(userId: string): Promise<SignedGifPage> {
    if (!this.gifs.isConfigured()) {
      throw new ServiceUnavailableException("GIFs aren't set up yet");
    }
    const provider = this.gifs.provider.toLowerCase();
    const rows = await this.favorites.listByUser(userId);
    return this.signed({
      results: rows
        .filter((row) => row.provider === provider)
        .map((row) => ({
          id: row.gif_id,
          title: row.title,
          preview: {
            url: row.preview_url,
            width: row.preview_width,
            height: row.preview_height,
          },
          full: {
            url: row.full_url,
            width: row.full_width,
            height: row.full_height,
          },
        })),
      next_page: null,
    });
  }

  /**
   * Stars a GIF (#5772). Only a result this server handed out: the full
   * rendition must carry its token, as a send must, and the preview must be
   * the provider's own media too. Starring one already starred is a no-op;
   * past {@link GIF_FAVORITES_MAX} the star is refused with a reason.
   */
  async addFavorite(userId: string, input: GifFavoriteRequest): Promise<void> {
    const gif = this.messageGif({
      id: input.id,
      title: input.title,
      url: input.full.url,
      width: input.full.width,
      height: input.full.height,
      token: input.token,
    });
    const { url, width, height } = input.preview;
    if (!this.gifs.isMediaUrl(url) || !isEdge(width) || !isEdge(height)) {
      throw new BadRequestException(
        "gif.preview must be the GIF provider's own https media",
      );
    }
    if ((await this.favorites.countByUser(userId)) >= GIF_FAVORITES_MAX) {
      throw new BadRequestException(
        `You can keep up to ${GIF_FAVORITES_MAX} favorite GIFs. Remove one to add another.`,
      );
    }
    await this.favorites.add(userId, {
      provider: gif.provider,
      gif_id: gif.id,
      title: gif.title,
      full_url: gif.url,
      full_width: gif.width,
      full_height: gif.height,
      preview_url: url,
      preview_width: width,
      preview_height: height,
    });
  }

  removeFavorite(userId: string, gifId: string): Promise<void> {
    return this.favorites.remove(
      userId,
      this.gifs.provider.toLowerCase(),
      gifId,
    );
  }

  availability(): { available: boolean; provider: string } {
    return {
      available: this.gifs.isConfigured(),
      provider: this.gifs.provider,
    };
  }

  trending(page: number): Promise<SignedGifPage> {
    return this.cached(`t:${page}`, TRENDING_TTL_MS, () =>
      this.gifs.trending(page),
    );
  }

  search(query: string, page: number): Promise<SignedGifPage> {
    const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) return this.trending(page);
    return this.cached(`s:${page}:${q}`, SEARCH_TTL_MS, () =>
      this.gifs.search(q, page),
    );
  }

  /** Fire and forget: a provider that's down never fails a send. */
  recordShare(gifId: string): void {
    if (!this.gifs.isConfigured()) return;
    void this.gifs.recordShare(gifId);
  }

  /**
   * A client's GIF, checked and normalized for `metadata.gif`: a 400 unless
   * it is a result this server handed out (its token matches), on the
   * provider's media host, at a size that draws.
   */
  messageGif(input: MessageGifInput): MessageGif {
    if (!this.gifs.isConfigured()) {
      throw new ServiceUnavailableException("GIFs aren't set up yet");
    }
    if (!this.gifs.isMediaUrl(input.url)) {
      throw new BadRequestException(
        "gif.url must be the GIF provider's own https media URL",
      );
    }
    const { width, height } = input;
    if (!isEdge(width) || !isEdge(height)) {
      throw new BadRequestException('gif width and height are out of range');
    }
    if (width > height * MAX_GIF_ASPECT || height > width * MAX_GIF_ASPECT) {
      throw new BadRequestException('gif is too narrow to draw');
    }
    const expected = this.gifs.sign(
      tokenMessage(input.id, input.url, width, height),
    );
    if (!expected || !sameToken(expected, input.token)) {
      throw new BadRequestException(
        "That GIF can't be sent. Pick it again from the GIF picker.",
      );
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

  private signed(page: GifPage): SignedGifPage {
    const results: SignedGifResult[] = [];
    for (const gif of page.results) {
      const { url, width, height } = gif.full;
      const token = this.gifs.sign(tokenMessage(gif.id, url, width, height));
      // A result a send would refuse is never offered.
      if (!token || !isEdge(width) || !isEdge(height)) continue;
      if (width > height * MAX_GIF_ASPECT || height > width * MAX_GIF_ASPECT)
        continue;
      results.push({ ...gif, token });
    }
    return {
      results,
      next_page:
        page.next_page !== null && page.next_page <= GIF_PAGE_MAX
          ? page.next_page
          : null,
    };
  }

  private unwrap(outcome: GifSearchOutcome): GifPage {
    if (outcome.outcome === 'ok') return outcome.page;
    throw new ServiceUnavailableException("GIFs couldn't load right now");
  }

  private async cached(
    key: string,
    ttl: number,
    load: () => Promise<GifSearchOutcome>,
  ): Promise<SignedGifPage> {
    if (!this.gifs.isConfigured()) {
      throw new ServiceUnavailableException("GIFs aren't set up yet");
    }
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && hit.expires > now) return hit.page;
    const page = this.signed(this.unwrap(await load()));
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

function isEdge(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_GIF_EDGE;
}

/** What a token signs: everything a message stores but the free-text title. */
function tokenMessage(
  id: string,
  url: string,
  width: number,
  height: number,
): string {
  return JSON.stringify(['gif', id, url, width, height]);
}

function sameToken(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
