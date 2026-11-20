import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateRoleDto,
  CreateRoleTierDto,
  UpdateRoleDto,
  UpdateRoleTierDto,
} from './rbac.dto';
import { UpdateChapterGroupDto } from './chapter-group.dto';

// #3485, #5784: a role color is a palette value, or a custom color that reads
// on every surface and isn't red or gold, in any letter case, stored in its
// painted spelling. `null` clears it.
describe('role color input', () => {
  it.each<ClassConstructor<CreateRoleDto | UpdateRoleDto>>([
    CreateRoleDto,
    UpdateRoleDto,
  ])('%p upper-cases a palette color before checking it', async (cls) => {
    const dto = plainToInstance(cls, {
      name: 'Rush Chair',
      permissions: [],
      color: ' #f2994a ',
    });
    expect(dto.color).toBe('#F2994A');
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).not.toContain('color');
  });

  it('accepts null on update, which clears the color', async () => {
    const dto = plainToInstance(UpdateRoleDto, { color: null });
    expect(dto.color).toBeNull();
    expect(await validate(dto)).toEqual([]);
  });

  it.each<ClassConstructor<CreateRoleDto | UpdateRoleDto>>([
    CreateRoleDto,
    UpdateRoleDto,
  ])('%p accepts a readable custom color, uppercased', async (cls) => {
    const dto = plainToInstance(cls, {
      name: 'Rush Chair',
      permissions: [],
      color: '#10b981',
    });
    expect(dto.color).toBe('#10B981');
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).not.toContain('color');
  });

  it.each(['#FF0000', '#EFB63B', '#1E3A8A', 'blue'])(
    'refuses %s: red, gold, too dark, or not a color',
    async (color) => {
      const dto = plainToInstance(UpdateRoleDto, { color });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('color');
    },
  );

  it.each([
    ['#10b981', '#10B981'],
    ['#f2994a', '#F2994A'],
  ])('stores a group color %s as %s', async (input, stored) => {
    const dto = plainToInstance(UpdateChapterGroupDto, { color: input });
    expect(dto.color).toBe(stored);
    expect(await validate(dto)).toEqual([]);
  });

  it('refuses a gold group color', async () => {
    const dto = plainToInstance(UpdateChapterGroupDto, { color: '#FFD700' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('color');
  });

  it('refuses a non-string color', async () => {
    const dto = plainToInstance(UpdateRoleDto, { color: 0xf2994a });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('color');
  });
});

// #4749: a role's (or tier's) name must have something besides whitespace;
// the database holds the same rule (`roles_name_not_blank`). The blank names
// it refuses are in `name-not-blank.dto.spec.ts`, with every other named DTO.
describe('role and tier name', () => {
  type NamedDto =
    CreateRoleDto | UpdateRoleDto | CreateRoleTierDto | UpdateRoleTierDto;
  const classes: ClassConstructor<NamedDto>[] = [
    CreateRoleDto,
    UpdateRoleDto,
    CreateRoleTierDto,
    UpdateRoleTierDto,
  ];

  describe.each(classes)('%p', (cls) => {
    it('accepts a name with surrounding spaces', async () => {
      const dto = plainToInstance(cls, {
        name: ' Rush Chair ',
        permissions: [],
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).not.toContain('name');
    });
  });

  it.each<ClassConstructor<UpdateRoleDto | UpdateRoleTierDto>>([
    UpdateRoleDto,
    UpdateRoleTierDto,
  ])('%p refuses a null name rather than passing it on', async (cls) => {
    const dto = plainToInstance(cls, { name: null });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('name');
  });

  it('still lets an update leave the name out', async () => {
    const dto = plainToInstance(UpdateRoleDto, { color: null });
    expect(await validate(dto)).toEqual([]);
  });
});

// #4958 review: `null` on a not-null switch is refused at the edge (400),
// not written (a 500); absent is fine.
describe('role and tier switches', () => {
  it.each([
    [UpdateRoleDto, 'self_assignable'],
    [CreateRoleDto, 'self_assignable'],
    [UpdateRoleDto, 'mentionable'],
    [CreateRoleDto, 'mentionable'],
    [UpdateRoleTierDto, 'mentionable'],
  ] as const)('%p refuses null for %s', async (cls, field) => {
    const dto = plainToInstance(cls as ClassConstructor<object>, {
      name: 'Intramurals',
      permissions: [],
      [field]: null,
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain(field);
  });

  it('accepts a role update that leaves the switches out, or sends a boolean', async () => {
    expect(await validate(plainToInstance(UpdateRoleDto, {}))).toEqual([]);
    expect(
      await validate(plainToInstance(UpdateRoleDto, { self_assignable: true })),
    ).toEqual([]);
  });
});
