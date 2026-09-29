/**
 * The keys that name a section of the chat sidebar (#2877), shared by the API
 * that stores a member's collapsed sections and by both clients that draw them.
 *
 * One grammar, because the server stores these strings and each client looks
 * its own sections up by them: a key one side spells differently from the
 * other is a fold that never applies, with nothing to say why.
 *
 * Four fixed groups have no row of their own, so they are named by word. A
 * chapter category is `category:<its uuid>`, lower-case, the way Postgres
 * prints a uuid. The rule is `spec/behavior/chat/README.md` § Sidebar
 * arrangement.
 */

/** The fixed groups, in the order the sidebar draws them around categories. */
export const SIDEBAR_FIXED_SECTION_KEYS = [
  "pinned",
  "channels",
  "direct",
  "system",
] as const;

export type SidebarFixedSectionKey =
  (typeof SIDEBAR_FIXED_SECTION_KEYS)[number];

/** A section key: a fixed group, or `category:<uuid>`. */
export type SidebarSectionKey = SidebarFixedSectionKey | `category:${string}`;

const CATEGORY_PREFIX = "category:";

const LOWER_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The section key for a chapter category. Lower-cases the id, so a key built
 * from an id a client received in upper case still matches the stored one.
 */
export function categorySectionKey(categoryId: string): SidebarSectionKey {
  return `${CATEGORY_PREFIX}${categoryId.toLowerCase()}`;
}

/**
 * The category id a key names, or `null` for a fixed group or a malformed key.
 */
export function categoryIdFromSectionKey(key: string): string | null {
  if (!key.startsWith(CATEGORY_PREFIX)) return null;
  const id = key.slice(CATEGORY_PREFIX.length);
  return LOWER_UUID.test(id) ? id : null;
}

/** Whether a string is a well-formed section key. */
export function isSidebarSectionKey(key: string): key is SidebarSectionKey {
  return (
    (SIDEBAR_FIXED_SECTION_KEYS as readonly string[]).includes(key) ||
    categoryIdFromSectionKey(key) !== null
  );
}
