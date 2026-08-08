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

  it('rejects an empty string', async () => {
    expect(await failingProps({ quiet_hours_tz: '' })).toContain(
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

  it('still enforces the length bound', async () => {
    expect(await failingProps({ quiet_hours_tz: 'A'.repeat(101) })).toContain(
      'quiet_hours_tz',
    );
  });
});
