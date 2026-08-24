import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression net for the write-boundary typing: every Supabase repository
 * must pass `.insert` / `.update` / `.upsert` as `TablesInsert` /
 * `TablesUpdate` with no `as never`. `nest build` is the real check that
 * GenericSchema stays bound; this spec just keeps a cast from coming back
 * in a file nobody type-checks as carefully.
 */
describe('Supabase repository write typing', () => {
  const files = readdirSync(__dirname).filter(
    (name) => name.startsWith('supabase-') && name.endsWith('.repository.ts'),
  );

  it('covers all 35 repository files', () => {
    expect(files).toHaveLength(35);
  });

  it('injects FrappSupabaseClient (not a bare SupabaseClient)', () => {
    const missing: string[] = [];
    const bare: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(__dirname, file), 'utf8');
      if (!/\bsupabase: FrappSupabaseClient\b/.test(text)) {
        missing.push(file);
      }
      if (/\bsupabase: SupabaseClient\b/.test(text)) {
        bare.push(file);
      }
    }
    expect({ missing, bare }).toEqual({ missing: [], bare: [] });
  });

  it('contains no as never (or as any as never) write casts', () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(__dirname, file), 'utf8');
      if (/\bas never\b/.test(text)) {
        hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });
});
