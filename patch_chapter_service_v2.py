import sys

file_path = 'apps/api/src/application/services/chapter.service.ts'
with open(file_path, 'r') as f:
    content = f.read()

old_block = """    const roles = await this.roleRepo.createMany(rolesData);

    const presidentRole = roles.find((r) => r.name === 'President');"""

new_block = """    const roles = await this.roleRepo.createMany(rolesData);

    if (!roles || roles.length === 0) {
      this.logger.error(`Failed to create default roles for chapter ${chapter.id}`);
      throw new InternalServerErrorException('Failed to create default roles');
    }

    const presidentRole = roles.find((r) => r.name === 'President');
    if (!presidentRole) {
      this.logger.error(`President role missing after default role creation for chapter ${chapter.id}`);
      throw new InternalServerErrorException('President role not found during chapter creation');
    }"""

if old_block in content:
    content = content.replace(old_block, new_block)
else:
    print("Could not find the target block to replace.")
    sys.exit(1)

with open(file_path, 'w') as f:
    f.write(content)
