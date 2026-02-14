import { getTableConfig } from 'drizzle-orm/pg-core';
import { users, members, chapters } from './schema';

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
      expect(columnNames).toContain('updated_at');
    });
  });

  describe('chapters table', () => {
    it('should have the correct table name', () => {
      const config = getTableConfig(chapters);
      expect(config.name).toBe('chapters');
    });

    it('should have the correct columns', () => {
      const config = getTableConfig(chapters);
      const columnNames = config.columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('clerk_organization_id');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
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
      expect(columnNames).toContain('updated_at');
    });

    it('should have foreign keys to users and chapters tables', () => {
      const config = getTableConfig(members);
      expect(config.foreignKeys.length).toBe(2);
    });
  });
});
