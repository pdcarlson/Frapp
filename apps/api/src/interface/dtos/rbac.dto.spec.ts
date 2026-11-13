import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateRoleDto,
  CreateRoleTierDto,
  UpdateRoleDto,
  UpdateRoleTierDto,
} from './rbac.dto';

// #3485: a role color is one of the palette values, in any letter case, and
// is stored in the palette's own spelling. `null` clears it.
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
