/**
 * The name a sign-up page gives itself, read from the start of its HTML
 * (#4187). The page's `og:title` wins, since Google Forms and Calendly put
 * the form's or event's own name there; otherwise its `<title>`. What is left
 * after cleaning is the row's title on Activity, or null when it says nothing
 * a member could tell apart: a sign-in or error page, or only the product.
 */

/** Longer than any row draws; rows truncate, this only bounds what is stored. */
export const MAX_TITLE_LENGTH = 200;

/** The product's name after the page's own (`Dues - Google Sheets`). */
const PRODUCT_SUFFIX =
  /\s*[-–—|:·]\s*(google\s+(sheets|docs|forms|drive)|microsoft\s+forms|calendly|typeform|sign\s?up\s?genius(\.com)?)\s*$/i;
/** The product's name before it (`SignUpGenius: Rush BBQ`). */
const PRODUCT_PREFIX =
  /^\s*(google\s+(sheets|docs|forms)|microsoft\s+forms|calendly|typeform|sign\s?up\s?genius(\.com)?)\s*[-–—|:·]\s*/i;

/**
 * Titles that name only the product, or Google's placeholder for a file no
 * one named: a row titled by its kind ("Google Form") says as much.
 */
const NAMES_NOTHING = new Set([
  'google forms',
  'google sheets',
  'google docs',
  'google drive',
  'google',
  'microsoft forms',
  'forms',
  'calendly',
  'typeform',
  'signupgenius',
  'signupgenius.com',
  'sign up genius',
  'untitled form',
  'untitled spreadsheet',
  'untitled document',
]);

/**
 * A page that is not the form: Google's sign-in for a private file, an
 * access request, a missing or deleted page. Its title must never become the
 * row's ("Sign in"), so the row keeps its kind.
 */
const NOT_THE_PAGE: RegExp[] = [
  // "Sign in", "Sign in to your account"; not a "Sign-in sheet" someone named.
  /^(sign|log)[\s-]?in(\s+(to|with)\b.*)?$/i,
  /\b(sign|log)[\s-]?in\b.*\b(google|microsoft) accounts?\b/i,
  /^google accounts?$/i,
  /\b(you need|request) access\b/i,
  /\baccess denied\b/i,
  /\b(page|file|form) (not found|unavailable|does not exist)\b/i,
  /^(error|oops)\b/i,
  // "404", "403 Forbidden"; not "100 Days party".
  /^[45]\d{2}(\b.*\b(error|not found|forbidden|unauthori[sz]ed|gone)\b.*|)$/i,
  /\bno longer accepting responses\b/i,
];

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  middot: '·',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, entity: string) => {
      if (entity.startsWith('#')) {
        const code =
          entity[1] === 'x' || entity[1] === 'X'
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
          return '';
        }
        return String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    },
  );
}

/** One tag's attributes, names lower-cased. */
function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern =
    /([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const match of tag.matchAll(pattern)) {
    found.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return found;
}

function ogTitle(html: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const name = (
      attrs.get('property') ??
      attrs.get('name') ??
      ''
    ).toLowerCase();
    if (name === 'og:title') {
      const content = attrs.get('content');
      if (content) return content;
    }
  }
  return null;
}

function titleElement(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return match ? match[1] : null;
}

/** C0 and C1 controls, and the marks that reorder bidirectional text. */
function isHiddenControl(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * The text as one plain line: entities decoded, whitespace collapsed, and
 * control and bidirectional-override characters dropped, so a title can't
 * reorder the text drawn after it.
 */
function plainLine(text: string): string {
  const kept = Array.from(decodeEntities(text), (char) =>
    isHiddenControl(char.codePointAt(0) ?? 0) ? ' ' : char,
  ).join('');
  return kept.replace(/\s+/g, ' ').trim();
}

/** A raw title cleaned for a row, or null when it names nothing. */
export function cleanPageTitle(raw: string): string | null {
  let title = plainLine(raw);
  title = title.replace(PRODUCT_SUFFIX, '').replace(PRODUCT_PREFIX, '').trim();
  if (title === '') return null;
  if (NAMES_NOTHING.has(title.toLowerCase())) return null;
  if (NOT_THE_PAGE.some((pattern) => pattern.test(title))) return null;
  if (title.length > MAX_TITLE_LENGTH) {
    title = `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
  }
  return title;
}

/**
 * The page's name from its HTML, or null. Reads `og:title` first, then
 * `<title>`; a page whose `og:title` names nothing (a sign-in page's) is not
 * given a second chance from `<title>`, since both describe the same page.
 */
export function pageTitleFromHtml(html: string): string | null {
  const raw = ogTitle(html) ?? titleElement(html);
  return raw === null ? null : cleanPageTitle(raw);
}

/**
 * Whether enough of the page has arrived to read its title: the head has
 * closed, or the body has begun. The fetcher stops reading there.
 */
export function headIsComplete(html: string): boolean {
  return /<\/head\s*>|<body\b/i.test(html);
}
