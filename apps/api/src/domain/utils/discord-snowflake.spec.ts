import {
  DISCORD_EPOCH_MS,
  isAtOrAfter,
  snowflakeAtOrAfter,
} from './discord-snowflake';

describe('Discord snowflakes (#2858)', () => {
  it('maps an instant to the smallest id minted at it', () => {
    // Discord's documented example: 175928847299117063 was minted at
    // 2016-04-30T11:18:25.796Z.
    const minted = Date.parse('2016-04-30T11:18:25.796Z');
    const cutoff = snowflakeAtOrAfter(minted);
    expect(cutoff >> 22n).toBe(BigInt(minted - DISCORD_EPOCH_MS));
    expect(isAtOrAfter('175928847299117063', cutoff)).toBe(true);
    expect(
      isAtOrAfter('175928847299117063', snowflakeAtOrAfter(minted + 1)),
    ).toBe(false);
  });

  it('is zero at or before Discord began, so nothing is cut', () => {
    expect(snowflakeAtOrAfter(DISCORD_EPOCH_MS)).toBe(0n);
    expect(snowflakeAtOrAfter(0)).toBe(0n);
    expect(snowflakeAtOrAfter(Number.NaN)).toBe(0n);
  });

  it('keeps an id that is not a snowflake for the batch writer to judge', () => {
    const cutoff = snowflakeAtOrAfter(Date.parse('2024-01-01T00:00:00Z'));
    expect(isAtOrAfter(undefined, cutoff)).toBe(true);
    expect(isAtOrAfter('not-an-id', cutoff)).toBe(true);
  });
});
