import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CorrectMemberProfileDto, DismissOpsNudgeDto } from './member.dto';

async function failingProps(payload: Record<string, unknown>) {
  const errors = await validate(plainToInstance(DismissOpsNudgeDto, payload));
  return errors.map((e) => e.property);
}

describe('DismissOpsNudgeDto — what members.dismissed_ops_nudges may hold', () => {
  it.each(['dues', 'events', 'tasks', 'points'])(
    'accepts the %s nudge',
    async (key) => {
      expect(await failingProps({ module_key: key })).toEqual([]);
    },
  );

  it('accepts the setup checklist on chat home', async () => {
    expect(await failingProps({ module_key: 'setup-checklist' })).toEqual([]);
  });

  it('rejects a key nothing reads, so it never sits in the array', async () => {
    expect(await failingProps({ module_key: 'study' })).toContain('module_key');
  });
});

// #4367: what an officer may send when fixing another member's profile.
describe('CorrectMemberProfileDto', () => {
  async function check(payload: Record<string, unknown>) {
    const dto = plainToInstance(CorrectMemberProfileDto, payload);
    const errors = await validate(dto, { whitelist: true });
    return { dto, failing: errors.map((e) => e.property) };
  }

  it('trims the name', async () => {
    const { dto, failing } = await check({ display_name: '  John Smith ' });
    expect(failing).toEqual([]);
    expect(dto.display_name).toBe('John Smith');
  });

  it('refuses a blank name', async () => {
    expect((await check({ display_name: '   ' })).failing).toEqual([
      'display_name',
    ]);
  });

  it.each([2027, null])('accepts graduation_year %s', async (year) => {
    expect((await check({ graduation_year: year })).failing).toEqual([]);
  });

  it.each([1899, 2101, 2027.5])('refuses graduation_year %s', async (year) => {
    expect((await check({ graduation_year: year })).failing).toEqual([
      'graduation_year',
    ]);
  });
});
