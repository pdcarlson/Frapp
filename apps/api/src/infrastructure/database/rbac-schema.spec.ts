import { getTableConfig } from 'drizzle-orm/pg-core';
import { roles } from './schema';

describe('RBAC Schema', () => {
  describe('roles table', () => {
    it('should have the correct table name', () => {
      const config = getTableConfig(roles);
      expect(config.name).toBe('roles');
    });

    it('should have the correct columns', () => {
      const config = getTableConfig(roles);
      const columnNames = config.columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('chapter_id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('permissions');
      expect(columnNames).toContain('is_system');
      expect(columnNames).toContain('created_at');
    });

    it('should have a foreign key to the chapters table', () => {
      const config = getTableConfig(roles);
      expect(config.foreignKeys.length).toBe(1);
    });
  });
});
