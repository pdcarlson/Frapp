import sys

file_path = 'apps/api/src/application/services/chapter.service.spec.ts'
with open(file_path, 'r') as f:
    content = f.read()

old_block = """    expect(mockRoleRepo.createMany).toHaveBeenCalledTimes(1);"""

new_block = """    expect(mockRoleRepo.createMany).toHaveBeenCalledTimes(1);
    const expectedRolesData = DEFAULT_SYSTEM_ROLES.map((roleDef) => ({
      chapter_id: chapter.id,
      name: roleDef.name,
      permissions: [...roleDef.permissions],
      is_system: roleDef.is_system,
      display_order: roleDef.display_order,
      color: roleDef.color ?? null,
    }));
    expect(mockRoleRepo.createMany).toHaveBeenCalledWith(expectedRolesData);"""

content = content.replace(old_block, new_block)

with open(file_path, 'w') as f:
    f.write(content)
