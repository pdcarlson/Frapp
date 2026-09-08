import { readFileSync } from 'node:fs';
import { collectRepositories } from '#test/helpers/repository-corpus';

/**
 * Regression net for the write-boundary typing: every repository must pass
 * `.insert` / `.update` / `.upsert` a `TablesInsert` / `TablesUpdate` with no
 * cast that erases the schema type. `nest build` is the real check that
 * GenericSchema stays bound; this spec just keeps a cast from coming back in a
 * file nobody type-checks as carefully.
 *
 * Two things this spec got wrong for long enough to be worth stating, because
 * both made it green while the rule it names was being broken inside the very
 * files it was reading:
 *
 * 1. **Discovery.** It read its own directory and filtered on a `supabase-`
 *    filename prefix, which reached 38 of the 40 repositories and exempted the
 *    two module-local ones outright. It now shares
 *    `#test/helpers/repository-corpus` with `tenant-scope-coverage.spec.ts`, so
 *    a repository added anywhere under `apps/api/src` joins both ledgers at
 *    once.
 * 2. **The cast form.** It matched `as never` alone, and `as unknown as
 *    TablesInsert<'…'>` erases exactly as much — two of those were sitting in
 *    `supabase-discord-import.repository.ts` while this spec reported clean.
 *
 * Both are the same mistake: `spec/engineering.md` § Changing existing code
 * requires a search that could actually fail, matching every form the thing is
 * written in. A guard that reads part of the corpus, or one form of the cast,
 * is a proof that cannot fail. Widen this rather than narrow it.
 */

/**
 * Every cast that puts a value past the PostgREST write boundary unchecked.
 *
 * `as never` is the historical form. `as unknown as Tables…` is the same
 * erasure spelled through `unknown`, and `as any` reaches the same place — a
 * correctly typed payload needs none of them, so matching all three costs
 * nothing and closes the substitutions.
 */
const ERASING_WRITE_CAST =
  /\bas never\b|\bas unknown as Tables(Insert|Update)\b|\bas any\b/;

describe('repository write typing', () => {
  const files = collectRepositories();

  it('covers all 40 repository files', () => {
    expect(files).toHaveLength(40);
  });

  it('injects FrappSupabaseClient (not a bare SupabaseClient)', () => {
    const missing: string[] = [];
    const bare: string[] = [];
    for (const { fileName, fullPath } of files) {
      const text = readFileSync(fullPath, 'utf8');
      if (!/\bsupabase: FrappSupabaseClient\b/.test(text)) {
        missing.push(fileName);
      }
      if (/\bsupabase: SupabaseClient\b/.test(text)) {
        bare.push(fileName);
      }
    }
    expect({ missing, bare }).toEqual({ missing: [], bare: [] });
  });

  it('contains no cast that erases the write payload type', () => {
    const hits: string[] = [];
    for (const { fileName, fullPath } of files) {
      if (ERASING_WRITE_CAST.test(readFileSync(fullPath, 'utf8'))) {
        hits.push(fileName);
      }
    }
    expect(hits).toEqual([]);
  });
});
