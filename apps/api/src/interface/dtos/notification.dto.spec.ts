import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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

  // Accepted deliberately — see spec/behavior/notifications.md § Quiet Hours.
  // Rows already hold offsets, so rejecting them here would lock those members
  // out of the settings form entirely.
  it('accepts a fixed UTC offset (documented, not preferred)', async () => {
    expect(await failingProps({ quiet_hours_tz: '-05:00' })).not.toContain(
      'quiet_hours_tz',
    );
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
