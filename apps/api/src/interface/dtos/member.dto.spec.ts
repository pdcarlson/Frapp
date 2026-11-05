import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DismissOpsNudgeDto } from './member.dto';

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
