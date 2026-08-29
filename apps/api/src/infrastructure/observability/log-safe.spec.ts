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

  it('returns an empty string for absent or non-string input', () => {
    expect(logSafe(undefined)).toBe('');
    expect(logSafe(null)).toBe('');
    expect(logSafe('')).toBe('');
    expect(logSafe(42)).toBe('');
  });
});
