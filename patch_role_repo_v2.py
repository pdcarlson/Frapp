import sys

file_path = 'apps/api/src/infrastructure/supabase/repositories/supabase-role.repository.ts'
with open(file_path, 'r') as f:
    content = f.read()

old_block = """  async createMany(rolesData: Partial<Role>[]): Promise<Role[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert(rolesData as never)
      .select();
    if (error) throw error;
    return data || [];
  }"""

new_block = """  async createMany(rolesData: Partial<Role>[]): Promise<Role[]> {
    const { data, error } = await this.supabase
      .from('roles')
      .insert(rolesData as never)
      .select();
    if (error) throw error;
    return data ?? [];
  }"""

if old_block in content:
    content = content.replace(old_block, new_block)
else:
    print("Could not find the target block to replace.")
    sys.exit(1)

with open(file_path, 'w') as f:
    f.write(content)
