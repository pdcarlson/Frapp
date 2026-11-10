import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MEMBER_ORDER_NUMBER_MAX,
  PLEDGE_CLASS_NAME_MAX_LENGTH,
} from '@repo/validation';
import {
  AssignPledgeClassesDto,
  PledgeClassNameDto,
  ReorderPledgeClassesDto,
} from './pledge-class.dto';
import { PLEDGE_CLASSES_MAX } from '@repo/validation';

const MEMBER = '0a000000-0000-4000-8000-000000000001';
const CLASS = '0a000000-0000-4000-8000-000000000002';

async function nameErrors(name: unknown) {
  return validate(plainToInstance(PledgeClassNameDto, { name }));
}

async function assignmentErrors(assignment: Record<string, unknown>) {
  const errors = await validate(
    plainToInstance(AssignPledgeClassesDto, { assignments: [assignment] }),
  );
  return errors.length;
}

describe('PledgeClassNameDto', () => {
  it('accepts a name', async () => {
    expect(await nameErrors('Alpha – Fall 2019')).toEqual([]);
  });

  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['too long', 'x'.repeat(PLEDGE_CLASS_NAME_MAX_LENGTH + 1)],
    ['not a string', 7],
  ])('rejects a %s name', async (_why, name) => {
    expect(await nameErrors(name)).not.toEqual([]);
  });
});

describe('AssignPledgeClassesDto', () => {
  it.each([
    ['a class and a number', { pledge_class_id: CLASS, order_number: 3 }],
    ['a class alone', { pledge_class_id: CLASS, order_number: null }],
    ['a number alone', { pledge_class_id: null, order_number: 3 }],
    [
      'neither, which clears both',
      { pledge_class_id: null, order_number: null },
    ],
  ])('accepts %s', async (_why, values) => {
    expect(await assignmentErrors({ member_id: MEMBER, ...values })).toBe(0);
  });

  it.each([
    ['a missing class key', { order_number: 3 }],
    ['a missing number key', { pledge_class_id: CLASS }],
    ['a class that is not a uuid', { pledge_class_id: 'x', order_number: 1 }],
    ['zero', { pledge_class_id: null, order_number: 0 }],
    ['a fraction', { pledge_class_id: null, order_number: 1.5 }],
    [
      'a number past the column bound',
      { pledge_class_id: null, order_number: MEMBER_ORDER_NUMBER_MAX + 1 },
    ],
  ])('rejects %s', async (_why, values) => {
    expect(await assignmentErrors({ member_id: MEMBER, ...values })).toBe(1);
  });

  it('rejects an empty list', async () => {
    const errors = await validate(
      plainToInstance(AssignPledgeClassesDto, { assignments: [] }),
    );
    expect(errors).toHaveLength(1);
  });
});

describe('ReorderPledgeClassesDto', () => {
  async function idErrors(ids: unknown) {
    const errors = await validate(
      plainToInstance(ReorderPledgeClassesDto, { ids }),
    );
    return errors.length;
  }

  it('accepts a list of class ids, and an empty one', async () => {
    expect(await idErrors([CLASS, MEMBER])).toBe(0);
    expect(await idErrors([])).toBe(0);
  });

  it.each([
    ['an id listed twice', [CLASS, CLASS]],
    ['an id that is not a uuid', [CLASS, 'x']],
    ['something that is not a list', CLASS],
    [
      'more ids than a chapter can have classes',
      Array.from(
        { length: PLEDGE_CLASSES_MAX + 1 },
        (_, i) => `0a000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    ],
  ])('rejects %s', async (_why, ids) => {
    expect(await idErrors(ids)).toBe(1);
  });
});
