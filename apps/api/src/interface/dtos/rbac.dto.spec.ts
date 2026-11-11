import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoleDto, UpdateRoleDto } from './rbac.dto';

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
