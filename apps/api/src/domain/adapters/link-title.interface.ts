export const LINK_TITLE_FETCHER = 'LINK_TITLE_FETCHER';

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
  /**
   * The page's own name, or null when there is none worth showing: the URL
   * is refused, the fetch fails or times out, the page is a sign-in page, or
   * it names only the product ("Microsoft Forms"). Never throws.
   */
  fetchTitle(url: string): Promise<string | null>;
}
