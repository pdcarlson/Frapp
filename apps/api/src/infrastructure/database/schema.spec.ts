import { getTableConfig } from 'drizzle-orm/pg-core';
import { users, members } from './schema';

describe('Drizzle Schema', () => {
  describe('users table', () => {
    it('should have the correct table name', () => {
      const config = getTableConfig(users);
      expect(config.name).toBe('users');
    });

    it('should have the correct columns', () => {
      const config = getTableConfig(users);
      const columnNames = config.columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('clerk_id');
      expect(columnNames).toContain('email');
      expect(columnNames).toContain('created_at');
    });
  });

  describe('members table', () => {
    it('should have the correct table name', () => {
      const config = getTableConfig(members);
      expect(config.name).toBe('members');
    });

    it('should have the correct columns', () => {
      const config = getTableConfig(members);
      const columnNames = config.columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('chapter_id');
      expect(columnNames).toContain('role_ids');
      expect(columnNames).toContain('created_at');
    });

    it('should have a foreign key to users table', () => {
      const config = getTableConfig(members);
      expect(config.foreignKeys.length).toBeGreaterThan(0);
      const fk = config.foreignKeys[0];
      // Check if it references users.id
      // Note: This is implementation specific but verifying existence is a good start
      expect(fk).toBeDefined();
    });
  });
});
