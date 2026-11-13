import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateChapterGroupDto,
  UpdateChapterGroupDto,
} from './chapter-group.dto';
import { CreateEventTypeDto, UpdateEventTypeDto } from './event-type.dto';
import { PledgeClassNameDto } from './pledge-class.dto';
import {
  CreateRoleDto,
  CreateRoleTierDto,
  UpdateRoleDto,
  UpdateRoleTierDto,
} from './rbac.dto';

// #4770: every DTO that names a role, tier, pledge class, event type or group
// refuses a name with no character outside JavaScript's `\s`. The database's
// `*_name_not_blank` checks list that same set by code point
// (`20261113161332_names_not_blank_unicode`), and the PGlite tier
// `names-not-blank.mjs` proves each constraint matches `/\s/` exactly. These
// are the characters `[:space:]` used to let through: U+FEFF under every
// collation, U+00A0 and U+202F under libc ones.
const NAMED: ClassConstructor<object>[] = [
  CreateRoleDto,
  UpdateRoleDto,
  CreateRoleTierDto,
  UpdateRoleTierDto,
  PledgeClassNameDto,
  CreateEventTypeDto,
  UpdateEventTypeDto,
  CreateChapterGroupDto,
  UpdateChapterGroupDto,
];

const nameErrors = async (cls: ClassConstructor<object>, name: string) =>
  (await validate(plainToInstance(cls, { name }))).filter(
    (e) => e.property === 'name',
  );

// Test titles name each character by code point, since most are invisible.
const BLANK = [
  '',
  '  ',
  '\t\n',
  '\ufeff',
  '\u00a0',
  '\u202f',
  '\u3000',
  ' \u00a0\ufeff\t',
].map((name) => {
  const codes = [...name].map(
    (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
  );
  return [codes.join(' ') || 'nothing', name];
});

describe.each(NAMED)('%p name', (cls) => {
  it.each(BLANK)('refuses a name of %s', async (_codes, name) => {
    expect(await nameErrors(cls, name)).not.toEqual([]);
  });

  it('accepts a name wrapped in Unicode spaces', async () => {
    expect(await nameErrors(cls, '\u00a0Rush\u202fChair\ufeff')).toEqual([]);
  });
});
