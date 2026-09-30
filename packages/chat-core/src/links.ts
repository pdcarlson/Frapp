/**
 * Links in a message body, for both clients (#2775).
 *
 * Both render a body through react-markdown (`message-markdown.tsx` in each
 * app), which finds `[text](url)` and `<url>` links. This file holds what
 * decides whether one is a link at all (`isSafeHref`, and `isOpenableHref` on
 * a phone) and the bare-URL rule (`bareUrls`) that `remarkBareUrls` in
 * `./markdown` applies.
 */

const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto"]);

/** The scheme of an href, lowercased, or `null` for a schemeless one. */
function schemeOf(href: string): string | null {
  const scheme = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(href)?.[1];
  return scheme === undefined ? null : scheme.toLowerCase();
}

/**
 * A markdown link's `href` is user-typed text, not a vetted URL:
 * `[text](javascript:alert(1))` parses to a real link with that href.
 * react-markdown's own `urlTransform` already blocks a dangerous scheme before
 * any component sees `href` (including a control-character-obfuscated one like
 * `jav\tascript:`, which it neutralizes to `""` regardless of this function),
 * so on web this is defense in depth, not the only layer. It has to hold on its
 * own anyway, and on mobile it is the only layer.
 *
 * One thing neither layer stops on its own: a **protocol-relative** href
 * (`//attacker.example/login`) has no scheme to reject, so a naive check waves
 * it through as "relative". A browser resolves it against the current page's
 * scheme to a real, external, clickable link: a phishing vector, not code
 * execution, but exactly the kind of link a schemeless-href-is-safe assumption
 * misses. A same-origin relative href (`example.com`, `/path`) has no such risk
 * and is left alone.
 */
export function isSafeHref(href: string): boolean {
  // Strip the same control characters a browser ignores when parsing a URL
  // scheme, so `jav\tascript:` can't slip past the scheme match by breaking
  // the match rather than the intent.
  const normalized = href.replace(/[\t\n\r]/g, "");
  if (normalized.startsWith("//")) return false;
  const scheme = schemeOf(normalized);
  return scheme === null || SAFE_URL_SCHEMES.has(scheme);
}

/**
 * An href a native client can hand to the OS: safe, and absolute. A
 * schemeless href is safe on web, where it resolves against the page, but a
 * phone has no page to resolve it against, so it is not a link there.
 */
export function isOpenableHref(href: string): boolean {
  if (/[\t\n\r]/.test(href) || !isSafeHref(href)) return false;
  return schemeOf(href) !== null;
}

const URL_PREFIXES = ["https://", "http://"];

/** Punctuation that ends a sentence around a bare URL rather than belonging to it. */
const TRAILING_PUNCTUATION = new Set([
  ".",
  ",",
  ":",
  ";",
  "!",
  "?",
  "'",
  '"',
  "*",
  "_",
  "~",
  ">",
]);

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_]/u.test(char);
}

function urlPrefixAt(content: string, index: number): boolean {
  return URL_PREFIXES.some(
    (prefix) =>
      content.slice(index, index + prefix.length).toLowerCase() === prefix,
  );
}

/**
 * The end (exclusive) of a bare URL starting at `start`: up to whitespace,
 * `<` or `limit`, then trailing punctuation dropped, and a closing bracket
 * dropped when the URL does not open one (`(see https://x.test/a)` keeps its
 * paren out, `https://en.wikipedia.org/wiki/Frapp_(drink)` keeps it in). The
 * bracket counts are taken once and adjusted as characters drop, so a URL
 * ending in a long run of brackets is still one pass. `remarkBareUrls` also
 * measures a URL with it on the raw body, where the parser split it, and caps
 * it at the first thing a URL can't run through.
 */
export function bareUrlEnd(
  content: string,
  start: number,
  limit = content.length,
): number {
  let end = start;
  while (end < limit && !/[\s<]/.test(content[end]!)) end += 1;
  let openParens = 0;
  let closeParens = 0;
  let openBrackets = 0;
  let closeBrackets = 0;
  for (let i = start; i < end; i += 1) {
    const char = content[i];
    if (char === "(") openParens += 1;
    else if (char === ")") closeParens += 1;
    else if (char === "[") openBrackets += 1;
    else if (char === "]") closeBrackets += 1;
  }
  while (end > start) {
    const last = content[end - 1]!;
    if (TRAILING_PUNCTUATION.has(last)) {
      end -= 1;
    } else if (last === ")" && closeParens > openParens) {
      closeParens -= 1;
      end -= 1;
    } else if (last === "]" && closeBrackets > openBrackets) {
      closeBrackets -= 1;
      end -= 1;
    } else {
      break;
    }
  }
  return end;
}

/** A bare URL in a run of text: `text.slice(start, end)`, which is its href. */
export interface BareUrl {
  start: number;
  end: number;
  href: string;
}

/**
 * The bare `http://` and `https://` URLs in `text`, in order. CommonMark links
 * only `<url>` and `[text](url)`; this is the rule for a URL typed on its own,
 * which GFM's autolink extension would cover and neither client loads.
 *
 * A URL starts at a word boundary (`xhttps://` is not one) and needs a host
 * after its scheme. It runs to whitespace or `<`, then gives back trailing
 * punctuation and a closing bracket it didn't open (`bareUrlEnd`). It is
 * linked only when `isOpenableHref` accepts it.
 *
 * `text` is prose, never code: `remarkBareUrls` hands this the `text` nodes of
 * a parsed body, so markdown syntax and code spans are already gone.
 *
 * Linear in `text`: a URL that is linked is skipped past, and one that is not
 * is only its scheme followed by characters `bareUrlEnd` gives back, none of
 * which can start another.
 */
export function bareUrls(text: string): BareUrl[] {
  const found: BareUrl[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (
      (char === "h" || char === "H") &&
      !isWordChar(text[i - 1]) &&
      urlPrefixAt(text, i)
    ) {
      const end = bareUrlEnd(text, i);
      const href = text.slice(i, end);
      const hasHost = URL_PREFIXES.some(
        (prefix) =>
          href.length > prefix.length &&
          href.toLowerCase().startsWith(prefix),
      );
      if (hasHost && isOpenableHref(href)) {
        found.push({ start: i, end, href });
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return found;
}
