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

export interface IGifSearch {
  /** Whether a key is configured at all. */
  isConfigured(): boolean;
  /** The provider's name, for the picker's attribution mark. */
  readonly provider: string;
  /** The media host every rendition URL this provider returns lives on. */
  readonly mediaHost: string;
  trending(page: number, customerId: string): Promise<GifSearchOutcome>;
  search(
    query: string,
    page: number,
    customerId: string,
  ): Promise<GifSearchOutcome>;
  /** The member's own recently sent GIFs, as the provider remembers them. */
  recent(page: number, customerId: string): Promise<GifSearchOutcome>;
  /** Tells the provider a GIF was sent, which feeds `recent`. Never throws. */
  recordShare(id: string, customerId: string): Promise<void>;
}
