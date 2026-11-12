/**
 * The port chat's GIF picker searches through (#4631).
 *
 * One adapter per provider under `infrastructure/gifs/`. The shapes here are
 * Frapp's own, so a provider's response never leaves its adapter and swapping
 * providers is one file. The provider key lives only behind this port: clients
 * search through `/v1/gifs/*`, never the provider directly.
 */
export const GIF_SEARCH = 'GIF_SEARCH';

/** One rendition of a GIF, sized for a place on screen. */
export interface GifRendition {
  url: string;
  width: number;
  height: number;
}

/** One result, as the picker draws it and as a message stores it. */
export interface GifResult {
  /** The provider's own id, a string whatever the provider uses. */
  id: string;
  /** Short words for screen readers and push text; may be empty. */
  title: string;
  /** Small and light: the picker grid's tile. */
  preview: GifRendition;
  /** What a message shows. */
  full: GifRendition;
}

export interface GifPage {
  results: GifResult[];
  /** The page after this one, or `null` at the end. */
  next_page: number | null;
}

/**
 * What one call came to. `unavailable` covers a provider that refused or
 * broke (a bad key, a rate limit, a timeout); the caller answers it as a
 * soft failure, never as an empty list a member would read as "no GIFs".
 */
export type GifSearchOutcome =
  { outcome: 'ok'; page: GifPage } | { outcome: 'unavailable' };

/** The longest edge a GIF message may have; any provider's renditions fit. */
export const MAX_GIF_EDGE = 4096;

/** The last page a client may ask for; a provider's `next_page` stops here. */
export const GIF_PAGE_MAX = 50;

export interface IGifSearch {
  /** Whether a key is configured at all. */
  isConfigured(): boolean;
  /** The provider's name, for the picker's attribution mark. */
  readonly provider: string;
  /** Whether a URL is this provider's own https media. */
  isMediaUrl(url: string): boolean;
  trending(page: number): Promise<GifSearchOutcome>;
  search(query: string, page: number): Promise<GifSearchOutcome>;
  /** Tells the provider a GIF was sent, which tunes its results. Never throws. */
  recordShare(id: string): Promise<void>;
  /**
   * An HMAC of `message` under a key only this server holds (derived from the
   * provider key), or `null` when no key is configured. Signs the results the
   * server hands out, so a send can prove its GIF came from a search here.
   */
  sign(message: string): string | null;
}
