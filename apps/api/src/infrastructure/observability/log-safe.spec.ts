import { logSafe } from './log-safe';

describe('logSafe', () => {
  it('passes an ordinary value through unchanged', () => {
    expect(logSafe('access_denied')).toBe('access_denied');
  });

  it('strips a newline that would forge a second log record (#1260)', () => {
    // The realistic payload: a caller-chosen `error_description` on the public
    // Discord callback, shaped to look like its own JSON log line.
    const forged =
      'denied\n{"event":"security_event","kind":"auth_failure","userId":"victim"}';
    const safe = logSafe(forged);

    expect(safe).not.toContain('\n');
    expect(safe).not.toContain('\r');
    // The text survives, on one line — it is diagnostics, not a secret.
    expect(safe).toContain('denied');
  });

  it('strips carriage returns and other control characters', () => {
    expect(logSafe('a\r\nb\tc')).toBe('abc');
  });

  it('caps an over-long value and marks the truncation', () => {
    const capped = logSafe('x'.repeat(500));
    expect(capped).toHaveLength(201);
    expect(capped.endsWith('\u2026')).toBe(true);
  });

  it('returns an empty string only for genuinely absent input', () => {
    expect(logSafe(undefined)).toBe('');
    expect(logSafe(null)).toBe('');
    expect(logSafe('')).toBe('');
  });

  it('renders a repeated query parameter instead of erasing it', () => {
    // Call sites are typed `string`, but Express's query parser hands back an
    // array for a repeated key, so `?error=a&error=b` arrives as `['a','b']`.
    // Returning '' there blanked the whole diagnostic — the log line read
    // `Discord connect declined for chapter <uuid>:` with nothing after the
    // colon, which is precisely the case an operator needs it for.
    expect(logSafe(['access_denied', 'x'])).toBe('access_denied,x');
    expect(logSafe(42)).toBe('42');
    expect(logSafe(false)).toBe('false');
  });

  it('still strips and caps what it renders from a non-string', () => {
    // Rendering must not become a bypass: the array path is caller-controlled
    // too, so a newline inside one element would forge a line just as well.
    expect(logSafe(['a\nB', 'c'])).toBe('aB,c');
    expect(logSafe(['x'.repeat(500)])).toHaveLength(201);
  });

  it('survives a cyclic or deeply nested value instead of throwing', () => {
    // `logSafe` takes `unknown` and is called from catch blocks, so it must
    // never be the thing that fails. Before the depth guard both of these
    // raised RangeError from inside a log statement.
    const cyclic: unknown[] = ['x'];
    cyclic.push(cyclic);
    expect(() => logSafe(cyclic)).not.toThrow();
    expect(logSafe(cyclic)).toContain('[nested]');

    let deep: unknown = 'bottom';
    for (let i = 0; i < 10_000; i += 1) deep = [deep];
    expect(() => logSafe(deep)).not.toThrow();
  });

  it('does not expand an object into the record', () => {
    // Not reachable from a query string: Express 5's default parser is
    // `simple`, so `?error[x]=1` arrives as the flat key `'error[x]'` and
    // `query.error` is undefined. This branch is for the `unknown` contract.
    // A placeholder loses nothing that was ever diagnostic; a JSON dump would
    // carry nested caller-controlled text into the log.
    expect(logSafe({ x: 'nested\ntext' })).toBe('[object]');
  });
});
