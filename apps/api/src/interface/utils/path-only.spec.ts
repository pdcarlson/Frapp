import { pathOnly } from './path-only';

describe('pathOnly', () => {
  it('strips a query string', () => {
    expect(pathOnly('/v1/tasks?limit=20')).toBe('/v1/tasks');
  });

  it('strips the OAuth callback query that motivated this (#1260)', () => {
    // The state value is the CSRF token itself, so neither it nor the code may
    // survive into a log record.
    const stripped = pathOnly(
      '/v1/discord/connect/callback?code=abc123&state=deadbeef',
    );
    expect(stripped).toBe('/v1/discord/connect/callback');
    expect(stripped).not.toContain('deadbeef');
    expect(stripped).not.toContain('abc123');
  });

  it('strips a fragment', () => {
    expect(pathOnly('/v1/tasks#section')).toBe('/v1/tasks');
  });

  it('cuts at whichever separator comes first', () => {
    // A fragment before a `?` makes the rest of the string fragment content,
    // not a query — cutting at the earliest separator is right either way.
    expect(pathOnly('/v1/tasks#a?b=c')).toBe('/v1/tasks');
    expect(pathOnly('/v1/tasks?b=c#a')).toBe('/v1/tasks');
  });

  it('drops scheme, host and userinfo from an absolute-form target (#1260)', () => {
    // Node hands `req.url` the request line verbatim, so this is a real shape a
    // caller can send. The userinfo is the reason this matters: keeping it
    // would log a credential in the stream this helper exists to keep clean.
    const stripped = pathOnly(
      'http://user:hunter2@api.frapp.live/v1/health?x=1',
    );
    expect(stripped).toBe('/v1/health');
    expect(stripped).not.toContain('hunter2');
    expect(stripped).not.toContain('api.frapp.live');
  });

  it('groups an absolute-form target with its origin-form equivalent', () => {
    expect(pathOnly('https://api.frapp.live/v1/tasks')).toBe(
      pathOnly('/v1/tasks'),
    );
  });

  it('leaves a //-leading origin-form path intact, first segment and all', () => {
    // `absolute-path = 1*( "/" segment )` and a segment may be empty, so this is
    // a legal request target. Treating it as protocol-relative and discarding
    // `x` as an authority would log `GET //x/v1/chapters/join` — which 404s — as
    // `/v1/chapters/join`, a real route, indistinguishable in the path field
    // from a genuine request. That is log forgery in the helper whose subject
    // is log integrity.
    expect(pathOnly('//x/v1/chapters/join')).toBe('//x/v1/chapters/join');
    expect(pathOnly('//v1/tasks?q=1')).toBe('//v1/tasks');
  });

  it('yields / for an absolute-form target with no path', () => {
    expect(pathOnly('http://api.frapp.live')).toBe('/');
    expect(pathOnly('http://api.frapp.live?q=1')).toBe('/');
  });

  it('leaves asterisk-form and authority-form alone rather than inventing a path', () => {
    expect(pathOnly('*')).toBe('*');
    expect(pathOnly('api.frapp.live:443')).toBe('api.frapp.live:443');
  });

  it('leaves a path with neither untouched', () => {
    expect(pathOnly('/v1/tasks')).toBe('/v1/tasks');
  });

  it('drops an empty or absent url rather than logging an empty string', () => {
    expect(pathOnly(undefined)).toBeUndefined();
    expect(pathOnly('')).toBeUndefined();
  });

  it('returns an empty path when the url is nothing but a query', () => {
    // Degenerate, but must not throw or leak: everything after `?` is gone.
    expect(pathOnly('?state=secret')).toBe('');
  });
});
