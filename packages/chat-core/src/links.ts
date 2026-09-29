/**
 * Links in a message body, for both clients (#2775).
 *
 * Web renders a body through react-markdown (`message-markdown.tsx`) and reads
 * only `isSafeHref` from here. Mobile has no markdown renderer (a dependency
 * is an integrator change to its frozen `package.json`), so it draws a body as
 * text and makes the links in it tappable through `linkSegments`.
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

export type LinkSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

/** Longest markdown link label and target this looks for, like `reply-preview`'s caps. */
const MAX_LABEL_LENGTH = 300;
const MAX_TARGET_LENGTH = 2000;

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
 * The first `needle` in `content` at or after `from` and no more than
 * `maxLength` characters past it, or -1. Bounded so that a body full of
 * unmatched openers costs a fixed window per opener, not the rest of the body.
 */
function indexWithin(
  content: string,
  needle: string,
  from: number,
  maxLength: number,
): number {
  const found = content.slice(from, from + maxLength + 1).indexOf(needle);
  return found === -1 ? -1 : from + found;
}

/**
 * The end (exclusive) of a bare URL starting at `start`: up to whitespace or
 * `<`, then trailing punctuation dropped, and a closing bracket dropped when
 * the URL does not open one (`(see https://x.test/a)` keeps its paren out,
 * `https://en.wikipedia.org/wiki/Frapp_(drink)` keeps it in). The bracket
 * counts are taken once and adjusted as characters drop, so a URL ending in a
 * long run of brackets is still one pass.
 */
function bareUrlEnd(content: string, start: number): number {
  let end = start;
  while (end < content.length && !/[\s<]/.test(content[end]!)) end += 1;
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

/**
 * Split a message body into text and the links a reader can tap.
 *
 * Recognized, in the order a scan meets them:
 *
 * - **Code**, fenced (```` ``` ````) or inline (`` ` ``): kept as text, never
 *   linkified, as on web, where a URL in a code span is code.
 * - **`[label](target)`**: a link reading `label`. A target that is not
 *   openable (`isOpenableHref`) leaves the label as plain text, the way web
 *   renders an unsafe href as its children alone.
 * - **`<https://…>`**: CommonMark's autolink, reading as the URL.
 * - **A bare `http://` or `https://` URL** at a word boundary. Web does not
 *   link these yet (it renders CommonMark without the GFM autolink
 *   extension, #2862).
 *
 * Everything else, markdown emphasis included, stays as the text it was
 * typed as: mobile does not render formatting (see the module doc).
 *
 * Linear in the body: every search is bounded or advances past what it read,
 * and a backtick run with no closer is remembered so the next run of the same
 * length does not search the rest of the body again.
 */
export function linkSegments(content: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let text = "";
  const pushText = (value: string) => {
    text += value;
  };
  const pushLink = (label: string, href: string) => {
    if (text) segments.push({ kind: "text", text });
    text = "";
    segments.push({ kind: "link", text: label, href });
  };

  const unclosedTicks = new Set<number>();
  let i = 0;
  while (i < content.length) {
    const char = content[i]!;

    if (char === "`") {
      let run = 1;
      while (content[i + run] === "`") run += 1;
      const fence = "`".repeat(run);
      const close = unclosedTicks.has(run)
        ? -1
        : content.indexOf(fence, i + run);
      if (close === -1) {
        unclosedTicks.add(run);
        pushText(fence);
        i += run;
        continue;
      }
      pushText(content.slice(i, close + run));
      i = close + run;
      continue;
    }

    if (char === "[") {
      const labelEnd = indexWithin(content, "]", i + 1, MAX_LABEL_LENGTH);
      if (
        labelEnd > i + 1 &&
        content[labelEnd + 1] === "("
      ) {
        const label = content.slice(i + 1, labelEnd);
        const targetStart = labelEnd + 2;
        let targetEnd = indexWithin(
          content,
          ")",
          targetStart,
          MAX_TARGET_LENGTH,
        );
        // One level of balanced parens in the target, as CommonMark allows:
        // `[wiki](https://en.wikipedia.org/wiki/Frapp_(drink))`.
        if (
          targetEnd !== -1 &&
          content.slice(targetStart, targetEnd).includes("(") &&
          content[targetEnd + 1] === ")"
        ) {
          targetEnd += 1;
        }
        const target =
          targetEnd === -1 ? "" : content.slice(targetStart, targetEnd);
        if (
          !label.includes("[") &&
          targetEnd !== -1 &&
          target.length > 0 &&
          !/\s/.test(target)
        ) {
          if (isOpenableHref(target)) pushLink(label, target);
          else pushText(label);
          i = targetEnd + 1;
          continue;
        }
      }
      pushText(char);
      i += 1;
      continue;
    }

    if (char === "<" && urlPrefixAt(content, i + 1)) {
      const close = indexWithin(content, ">", i + 1, MAX_TARGET_LENGTH);
      const target = close === -1 ? "" : content.slice(i + 1, close);
      if (
        close !== -1 &&
        !/[\s<]/.test(target) &&
        isOpenableHref(target)
      ) {
        pushLink(target, target);
        i = close + 1;
        continue;
      }
      pushText(char);
      i += 1;
      continue;
    }

    if (
      (char === "h" || char === "H") &&
      !isWordChar(content[i - 1]) &&
      urlPrefixAt(content, i)
    ) {
      const end = bareUrlEnd(content, i);
      const url = content.slice(i, end);
      const hasHost = URL_PREFIXES.some(
        (prefix) => url.length > prefix.length && url.toLowerCase().startsWith(prefix),
      );
      if (hasHost && isOpenableHref(url)) {
        pushLink(url, url);
        i = end;
        continue;
      }
    }

    pushText(char);
    i += 1;
  }
  if (text) segments.push({ kind: "text", text });
  return segments;
}
