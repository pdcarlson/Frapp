import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `boot.ts` exists so the env is filled before `main` is even imported:
 * `instrument.ts` reads SENTRY_DSN as it loads. Nothing else catches a
 * regression here, because CI's image boot probe holds no Infisical identity
 * and takes the skip path. Read from source, since importing it would boot.
 */
const source = readFileSync(join(__dirname, 'boot.ts'), 'utf8');

describe('boot.ts', () => {
  it('statically imports only the secrets loader and its error helper', () => {
    const staticImports = [
      ...source.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms),
    ].map(([, from]) => from);
    expect(staticImports).toEqual([
      './infrastructure/observability/reportable-error',
      './infrastructure/secrets/infisical-boot-secrets',
    ]);
    expect(source).not.toMatch(/^import\s+'/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('imports main only after the env is filled', () => {
    const load = source.indexOf('await loadBootSecrets(process.env);');
    const main = source.indexOf("await import('./main.js');");
    expect(load).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(load);
    expect(source.match(/main(\.js)?'/g)).toHaveLength(1);
  });
});
