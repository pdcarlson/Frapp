export const LINK_TITLE_FETCHER = 'LINK_TITLE_FETCHER';

/**
 * What one read of a sign-up page came to.
 *
 * - `title`: the page's own name.
 * - `none`: a definite answer that there is no name to show. The URL is
 *   refused (off the sign-up list, or a host that resolves to a non-public
 *   address), the page redirects off the list (a private file's sign-in), it
 *   answers a 4xx or something other than HTML, or its title is a sign-in or
 *   error page or names only the product.
 * - `failed`: the read broke on the way (a timeout, a network or TLS error,
 *   a 5xx, a rate limit), so trying again later may still find the name.
 *   `reason` is low-cardinality, for a report tag.
 */
export type LinkTitleResult =
  | { outcome: 'title'; title: string }
  | { outcome: 'none' }
  | {
      outcome: 'failed';
      reason: 'timeout' | 'network' | 'server-error' | 'unexpected';
    };

/**
 * Reads the name of a sign-up page posted in chat (#4187,
 * `spec/behavior/activity.md` § Links), for the title of its row on Activity.
 *
 * The one place the API opens a URL a member posted, so every guard lives
 * behind this seam: only the sign-up hosts Activity gathers, never a private
 * or loopback address, no redirect off those hosts, and a short timeout and
 * size cap. Called only by the background title sweep, never on a read.
 */
export interface ILinkTitleFetcher {
  /** Reads the page once. Never throws. */
  fetchTitle(url: string): Promise<LinkTitleResult>;
}
