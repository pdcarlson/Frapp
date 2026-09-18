/*
 * A value the preset can hand Tailwind as a bare `var(--token)` and have the
 * browser paint. `color-mix()` is in the set because the derived accent steps
 * (`--primary-pressed`, `--accent-subtle-hover`) are mixes of the accent slot
 * rather than fixed values — that is what keeps them tracking a chapter's
 * override instead of needing a second thing to re-derive.
 *
 * A regex alone is the wrong shape for `color-mix()`: its arguments nest
 * parens, and a pattern loose enough to cross them (`.+\)`) also accepts a
 * dropped closing paren or a single colour argument — both invalid CSS that
 * would paint nothing, which is precisely what this guard exists to catch.
 * Parens are therefore balanced by counting and the argument count checked.
 *
 * **This lives in its own module because two specs need it.** It was local to
 * `signet.css.spec.ts` until #2371 moved `--primary-pressed` and
 * `--accent-subtle-hover` into the shared preset, which put them inside
 * `tailwind.config.spec.ts`'s scanned surface for the first time. That file
 * had a weaker regex copy of the same idea; keeping both would have meant
 * hand-syncing two definitions of "is this a colour", and they had already
 * drifted once.
 */
export const SIMPLE_COLOR = /^(#[0-9a-f]{3,8}|(hsla?|rgba?)\([^)]*\))$/i;

function isBalanced(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

export function isCompleteColor(value: string): boolean {
  if (SIMPLE_COLOR.test(value)) return true;
  const mix = /^color-mix\(in ([\w-]+(?: [\w-]+)?),(.+)\)$/i.exec(value);
  if (!mix || !isBalanced(value)) return false;
  // Split the argument list on top-level commas only — `var(--a, fallback)`
  // and a nested mix both carry commas that are not argument separators.
  let depth = 0;
  const parts: string[] = [];
  let current = "";
  for (const char of mix[2]!) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  // `color-mix()` takes exactly two colours, each optionally with a percentage.
  return parts.length === 2 && parts.every((part) => part.trim().length > 0);
}
