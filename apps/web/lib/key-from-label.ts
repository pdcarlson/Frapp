/**
 * The longest key `keyFromLabel` returns. It was the API's cap on a custom role
 * key; custom roles went in #4075, and custom field keys keep it as a sane bound.
 */
const KEY_MAX_LENGTH = 64;

/**
 * The key for a new custom field, derived from its name so the
 * officer never types one (principles.md P2.2): `"Pledge Educator"` becomes
 * `pledge_educator`, and a key the chapter already uses gets `_2`, `_3`, ….
 * The API accepts `^[a-z0-9_]+$`; a name with no letters or digits falls back
 * to `fallback`.
 */
export function keyFromLabel(
  label: string,
  existingKeys: readonly string[],
  fallback = "role",
): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, KEY_MAX_LENGTH - 4)
      .replace(/_+$/, "") || fallback;
  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
