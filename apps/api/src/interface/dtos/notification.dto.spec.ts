import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { isSupportedTimeZone } from '@repo/validation';
import { UpdateUserSettingsDto } from './notification.dto';

/** Validate a plain payload through the DTO and return the failing property names. */
async function failingProps(
  payload: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(UpdateUserSettingsDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('UpdateUserSettingsDto — quiet_hours_tz zone validation (#687)', () => {
  it('accepts a real IANA zone', async () => {
    expect(
      await failingProps({ quiet_hours_tz: 'America/New_York' }),
    ).not.toContain('quiet_hours_tz');
  });

  it('accepts UTC', async () => {
    expect(await failingProps({ quiet_hours_tz: 'UTC' })).not.toContain(
      'quiet_hours_tz',
    );
  });

  it('rejects an unknown zone that Intl.DateTimeFormat would throw on', async () => {
    expect(await failingProps({ quiet_hours_tz: 'Mars/Olympus' })).toContain(
      'quiet_hours_tz',
    );
  });

  // Blank is a *clear*, not an error: the web panel binds the input to "", so
  // rejecting it would leave a member with a bad stored zone unable to turn
  // quiet hours off — the one escape hatch they have.
  it('accepts an empty string as a clear, normalized to null', async () => {
    const dto = plainToInstance(UpdateUserSettingsDto, { quiet_hours_tz: '' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.quiet_hours_tz).toBeNull();
  });

  it('accepts a whitespace-only string as a clear', async () => {
    const dto = plainToInstance(UpdateUserSettingsDto, {
      quiet_hours_tz: '   ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.quiet_hours_tz).toBeNull();
  });

  // A padded value must be trimmed on the way in, not just for the check:
  // validation probes the trimmed form, so storing the raw one would let this
  // pass here and then throw at delivery — the exact unusable row this
  // validation exists to prevent.
  it('trims a padded zone so the stored value is the validated one', async () => {
    const dto = plainToInstance(UpdateUserSettingsDto, {
      quiet_hours_tz: '  America/New_York  ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.quiet_hours_tz).toBe('America/New_York');
  });

  it('treats a blank quiet_hours_start as a clear, not an error', async () => {
    const dto = plainToInstance(UpdateUserSettingsDto, {
      quiet_hours_start: '',
      quiet_hours_end: '',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.quiet_hours_start).toBeNull();
    expect(dto.quiet_hours_end).toBeNull();
  });

  // Whether a fixed offset resolves is a property of the runtime's ICU, not of
  // this DTO: Node 20 (CI and the Dockerfile) rejects `-05:00`, Node 22 accepts
  // it. So assert the portable thing — the DTO reaches the same verdict as the
  // shared predicate — rather than an outcome that flips with the Node version.
  it('agrees with the shared predicate on offset forms, whatever this runtime decides', async () => {
    const candidate = '-05:00';
    const rejectedByDto = (
      await failingProps({ quiet_hours_tz: candidate })
    ).includes('quiet_hours_tz');
    expect(rejectedByDto).toBe(!isSupportedTimeZone(candidate));
  });

  it('rejects a plausible-looking but nonexistent zone', async () => {
    expect(
      await failingProps({ quiet_hours_tz: 'America/Notacity' }),
    ).toContain('quiet_hours_tz');
  });

  it('accepts null — clearing the field stays valid', async () => {
    expect(await failingProps({ quiet_hours_tz: null })).not.toContain(
      'quiet_hours_tz',
    );
  });

  it('accepts an omitted field', async () => {
    expect(await failingProps({ theme: 'dark' })).not.toContain(
      'quiet_hours_tz',
    );
  });

  // Named for what it actually asserts. @MaxLength(100) does not have an
  // independent failure mode here — the zone check rejects a 101-char string on
  // its own — so this guards the outcome, not the decorator.
  it('rejects an over-long value', async () => {
    expect(await failingProps({ quiet_hours_tz: 'A'.repeat(101) })).toContain(
      'quiet_hours_tz',
    );
  });
});
