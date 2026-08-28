import {
  CHECK_IN_QR_PREFIX,
  CHECK_IN_TOKEN_WINDOW_MS,
  checkInManualCode,
  currentCheckInWindow,
  mintCheckInToken,
  normalizeManualCode,
  verifyCheckInToken,
  verifyManualCode,
} from './check-in-token';

const SECRET = 'test-check-in-secret-at-least-32-characters';
const EVENT = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT = '22222222-2222-4222-8222-222222222222';

/** A fixed instant, placed mid-window so ±1s does not cross a boundary. */
const NOW = 1_800_000_015_000;

describe('mintCheckInToken', () => {
  it('produces a QR payload the scanner can route on', () => {
    const minted = mintCheckInToken(EVENT, SECRET, NOW);
    expect(minted.qrPayload).toBe(
      `${CHECK_IN_QR_PREFIX}:${EVENT}:${minted.token}`,
    );
  });

  it('reports the rotation deadline of the current window', () => {
    const minted = mintCheckInToken(EVENT, SECRET, NOW);
    const endOfWindow =
      (currentCheckInWindow(NOW) + 1) * CHECK_IN_TOKEN_WINDOW_MS;

    expect(minted.expiresAt).toBe(new Date(endOfWindow).toISOString());
    expect(minted.rotatesInMs).toBe(endOfWindow - NOW);
    expect(minted.rotatesInMs).toBeGreaterThan(0);
    expect(minted.rotatesInMs).toBeLessThanOrEqual(CHECK_IN_TOKEN_WINDOW_MS);
  });

  it('rotates the token when the window advances', () => {
    const first = mintCheckInToken(EVENT, SECRET, NOW);
    const next = mintCheckInToken(
      EVENT,
      SECRET,
      NOW + CHECK_IN_TOKEN_WINDOW_MS,
    );
    expect(next.token).not.toBe(first.token);
    expect(next.manualCode).not.toBe(first.manualCode);
  });

  it('mints different tokens for different events in the same window', () => {
    expect(mintCheckInToken(EVENT, SECRET, NOW).token).not.toBe(
      mintCheckInToken(OTHER_EVENT, SECRET, NOW).token,
    );
  });
});

describe('verifyCheckInToken', () => {
  it('accepts the token for the current window', () => {
    const { token } = mintCheckInToken(EVENT, SECRET, NOW);
    expect(verifyCheckInToken(token, EVENT, SECRET, NOW)).toBe(true);
  });

  it('accepts the previous window, so a scan racing a rotation still lands', () => {
    // `patterns.md` requires this: the member scanned a code that was current
    // when the camera fired and stale by the time the request arrived.
    const { token } = mintCheckInToken(EVENT, SECRET, NOW);
    expect(
      verifyCheckInToken(token, EVENT, SECRET, NOW + CHECK_IN_TOKEN_WINDOW_MS),
    ).toBe(true);
  });

  it('rejects a token two windows old', () => {
    const { token } = mintCheckInToken(EVENT, SECRET, NOW);
    expect(
      verifyCheckInToken(
        token,
        EVENT,
        SECRET,
        NOW + 2 * CHECK_IN_TOKEN_WINDOW_MS,
      ),
    ).toBe(false);
  });

  it('rejects a token minted for a different event', () => {
    // Without event binding, one open event's code would check members into
    // every other event running at the same time.
    const { token } = mintCheckInToken(OTHER_EVENT, SECRET, NOW);
    expect(verifyCheckInToken(token, EVENT, SECRET, NOW)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = mintCheckInToken(EVENT, 'a-different-secret', NOW);
    expect(verifyCheckInToken(token, EVENT, SECRET, NOW)).toBe(false);
  });

  it('rejects garbage and empty input without throwing', () => {
    expect(verifyCheckInToken('', EVENT, SECRET, NOW)).toBe(false);
    expect(verifyCheckInToken('not-a-token', EVENT, SECRET, NOW)).toBe(false);
    // A length mismatch must return false, not throw out of timingSafeEqual.
    expect(verifyCheckInToken('a'.repeat(500), EVENT, SECRET, NOW)).toBe(false);
  });
});

describe('checkInManualCode', () => {
  it('renders in the drawn XXX-NN shape', () => {
    const code = checkInManualCode(EVENT, currentCheckInWindow(NOW), SECRET);
    // s22 draws "Show code: 4KQ-88".
    expect(code).toMatch(/^[0-9A-Z]{3}-[0-9]{2}$/);
  });

  it('avoids the Crockford-excluded glyphs', () => {
    // Sample enough windows to exercise the alphabet; I/L/O/U must never appear
    // or the code cannot be read off a screen unambiguously.
    for (let i = 0; i < 300; i++) {
      expect(checkInManualCode(EVENT, i, SECRET)).not.toMatch(/[ILOU]/);
    }
  });

  it('is not derivable from the QR token', () => {
    const minted = mintCheckInToken(EVENT, SECRET, NOW);
    expect(minted.token).not.toContain(minted.manualCode.replace('-', ''));
  });
});

describe('normalizeManualCode', () => {
  it('accepts the spellings a member is likely to type', () => {
    expect(normalizeManualCode('4kq-88')).toBe('4KQ-88');
    expect(normalizeManualCode('4KQ88')).toBe('4KQ-88');
    expect(normalizeManualCode(' 4KQ 88 ')).toBe('4KQ-88');
  });

  it('applies the Crockford substitutions for confusable glyphs', () => {
    expect(normalizeManualCode('I4Q88')).toBe('14Q-88');
    expect(normalizeManualCode('L4Q88')).toBe('14Q-88');
    expect(normalizeManualCode('O4Q88')).toBe('04Q-88');
  });

  it('leaves wrong-length input alone rather than forcing a dash into it', () => {
    expect(normalizeManualCode('4KQ')).toBe('4KQ');
    expect(normalizeManualCode('4KQ8888')).toBe('4KQ8888');
  });
});

describe('verifyManualCode', () => {
  it('accepts the current and previous window', () => {
    const { manualCode } = mintCheckInToken(EVENT, SECRET, NOW);
    expect(verifyManualCode(manualCode, EVENT, SECRET, NOW)).toBe(true);
    expect(
      verifyManualCode(
        manualCode,
        EVENT,
        SECRET,
        NOW + CHECK_IN_TOKEN_WINDOW_MS,
      ),
    ).toBe(true);
  });

  it('accepts a sloppily typed code', () => {
    const { manualCode } = mintCheckInToken(EVENT, SECRET, NOW);
    expect(
      verifyManualCode(
        manualCode.toLowerCase().replace('-', ' '),
        EVENT,
        SECRET,
        NOW,
      ),
    ).toBe(true);
  });

  it('rejects a stale, foreign-event, or wrong code', () => {
    const { manualCode } = mintCheckInToken(EVENT, SECRET, NOW);
    expect(
      verifyManualCode(
        manualCode,
        EVENT,
        SECRET,
        NOW + 2 * CHECK_IN_TOKEN_WINDOW_MS,
      ),
    ).toBe(false);
    expect(verifyManualCode(manualCode, OTHER_EVENT, SECRET, NOW)).toBe(false);
    expect(verifyManualCode('', EVENT, SECRET, NOW)).toBe(false);
  });
});
