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
