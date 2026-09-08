import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  EXPECTED_REPOSITORY_COUNT,
  REPOSITORY_SRC_ROOT as SRC_ROOT,
  collectRepositories,
} from '#test/helpers/repository-corpus';

/**
 * Regression net for the write boundary: a repository passes `.insert` /
 * `.update` / `.upsert` a `TablesInsert` / `TablesUpdate` **with no cast and
 * no type suppression**. `nest build` is the real check that GenericSchema
 * stays bound; this spec keeps an erasure from coming back in a file nobody
 * type-checks as carefully.
 *
 * Match the shape, not a list of spellings. This spec used to name one
 * spelling — `as never` — which left `as unknown as TablesInsert<'…'>`,
 * `as Database['public']['Tables'][…]['Insert']`, `as any` and
 * `@ts-expect-error` all open, and two of those were live in the corpus while
 * it reported clean. Enumerating spellings is a proof that cannot fail
 * (`spec/engineering.md` § Changing existing code: match every form the thing
 * is written in). Widen this, never narrow it.
 *
 * Anchoring to the write call is also what keeps it honest in the other
 * direction: repositories legitimately cast on the **read** path
 * (`(data ?? []) as unknown as Row[]`), and prose in a comment may say "as
 * any" in plain English. Neither sits inside a write call's arguments, so
 * neither is matched.
 *
 * Known gaps, stated rather than left sharp — this is a text scan, not a type
 * checker, and it is better to name what it misses than to let a reader take
 * a green run for a proof it is not:
 *
 *  - A cast applied before the call (`const row = x as never; … .insert(row)`).
 *  - A cast behind a nested call inside the args (`.insert(build(x) as never)`)
 *    — `[^)]` cannot cross the inner `)`.
 *  - A write method whose parameter is annotated `any`, which erases the
 *    payload with no cast at all. `no-explicit-any` is off in this workspace,
 *    so nothing else objects either.
 *
 * All three need real parsing. Widen this when one turns up live; never
 * narrow it, and never describe it elsewhere as catching everything.
 *
 * If a repository ever legitimately holds no Supabase client, record it in a
 * backlog map here with its reason, the way `TENANT_SCOPE_BACKLOG` does next
 * door. Do **not** rename the file off `*.repository.ts` to escape: that also
 * drops it out of the tenant-scope denominator, which is the discovery hole
 * this spec exists to keep closed.
 */

const WRITE = String.raw`\.(?:insert|update|upsert)\(`;

/**
 * A cast inside a write call's argument list, in either syntax.
 *
 * `as const` is excepted: it narrows a literal rather than erasing the type,
 * so it is the one `as` in a payload that is not a defect.
 */
const CAST_IN_WRITE_ARGS = new RegExp(
  `${WRITE}\\s*[^)]*?(?:\\bas\\s+(?!const\\b)|<\\s*\\w+\\s*>)`,
);

/**
 * The schema binding erased upstream of the write, which reaches the same
 * place without touching the payload — `.from('t' as never)` when a table is
 * missing from `database.types.ts` is the standard workaround, and casting the
 * client itself defeats every rule below.
 */
const ERASED_BINDING = /\.from\(\s*[^)]*?\bas\s|\bsupabase\s+as\s+\w/;

/** A compiler suppression on a write call. */
const SUPPRESSED_WRITE = new RegExp(
  String.raw`@ts-(?:expect-error|ignore)[^\n]*\n(?:[^\n]*\n){0,2}?[^\n]*${WRITE}`,
);

describe('repository write typing', () => {
  const files = collectRepositories();

  it(`covers all ${EXPECTED_REPOSITORY_COUNT} repository files`, () => {
    expect(files).toHaveLength(EXPECTED_REPOSITORY_COUNT);
  });

  it('injects FrappSupabaseClient (not a bare SupabaseClient)', () => {
    const missing: string[] = [];
    const bare: string[] = [];
    for (const { fullPath } of files) {
      const text = readFileSync(fullPath, 'utf8');
      if (!/\bsupabase: FrappSupabaseClient\b/.test(text)) {
        missing.push(relative(SRC_ROOT, fullPath));
      }
      if (/\bsupabase: SupabaseClient\b/.test(text)) {
        bare.push(relative(SRC_ROOT, fullPath));
      }
    }
    expect({ missing, bare }).toEqual({ missing: [], bare: [] });
  });

  it('passes write payloads with the schema binding intact', () => {
    // Report the path and the matched text, not a basename: the corpus spans
    // three directories and two patterns, so a bare name leaves the reader to
    // re-derive which file and which rule.
    const hits: string[] = [];
    for (const { fullPath } of files) {
      const text = readFileSync(fullPath, 'utf8');
      for (const pattern of [
        CAST_IN_WRITE_ARGS,
        ERASED_BINDING,
        SUPPRESSED_WRITE,
      ]) {
        const found = pattern.exec(text);
        if (found) {
          hits.push(`${relative(SRC_ROOT, fullPath)}: ${found[0].trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
