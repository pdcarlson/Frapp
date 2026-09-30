import { classifySupabaseKey } from './supabase-key';

/** A JWT-shaped string whose payload carries `claims`; the signature is never checked. */
function jwtWith(claims: unknown): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.not-a-signature`;
}

describe('classifySupabaseKey', () => {
  it.each([
    ['sb_secret_not-a-real-key', 'secret'],
    ['sb_publishable_not-a-real-key', 'publishable'],
    [jwtWith({ role: 'service_role', ref: 'abc' }), 'service_role_jwt'],
    [jwtWith({ role: 'anon', ref: 'abc' }), 'client_jwt'],
    [jwtWith({ role: 'authenticated' }), 'client_jwt'],
  ])('classifies %s as %s', (key, kind) => {
    expect(classifySupabaseKey(key)).toBe(kind);
  });

  it('reads through surrounding whitespace, as an env value can carry', () => {
    expect(classifySupabaseKey('  sb_secret_not-a-real-key\n')).toBe('secret');
    expect(classifySupabaseKey(` ${jwtWith({ role: 'anon' })} `)).toBe(
      'client_jwt',
    );
  });

  // Stand-ins in tests and CI (`service-role-key`, `ci-not-a-real-key`) must
  // stay unclassified, so the boot guard built on this leaves them alone.
  it.each([
    'service-role-key',
    'ci-not-a-real-key',
    'a.b.c',
    jwtWith({ sub: 'no-role' }),
    jwtWith(['not', 'an', 'object']),
    '',
  ])('leaves %p unrecognized', (key) => {
    expect(classifySupabaseKey(key)).toBe('unrecognized');
  });
});
