import { PG_UNIQUE_VIOLATION, isUniqueViolation } from './postgres-error-codes';

describe('postgres error codes', () => {
  it('is the SQLSTATE Postgres actually raises', () => {
    // Pinned against the literal rather than against itself: this value is a
    // wire contract with Postgres, so a test that read it from the module
    // could not fail.
    expect(PG_UNIQUE_VIOLATION).toBe('23505');
  });

  describe('isUniqueViolation', () => {
    it('accepts a PostgREST error carrying the code', () => {
      expect(isUniqueViolation({ code: '23505' })).toBe(true);
      expect(
        isUniqueViolation({
          code: '23505',
          message: 'duplicate key value violates unique constraint',
          details: null,
          hint: null,
        }),
      ).toBe(true);
    });

    it('rejects a different SQLSTATE', () => {
      // 23514 is a check-constraint violation and 23503 a foreign-key one.
      // Both are neighbours of 23505 and neither is a duplicate.
      expect(isUniqueViolation({ code: '23514' })).toBe(false);
      expect(isUniqueViolation({ code: '23503' })).toBe(false);
      expect(isUniqueViolation({ code: 'PGRST116' })).toBe(false);
    });

    it('rejects a throwable with no code at all', () => {
      expect(isUniqueViolation(new Error('boom'))).toBe(false);
      expect(isUniqueViolation({})).toBe(false);
    });

    it('rejects a non-object without throwing', () => {
      // The predicate runs inside `catch` blocks, where the caught value is
      // whatever was thrown — it must not itself throw.
      expect(isUniqueViolation(null)).toBe(false);
      expect(isUniqueViolation(undefined)).toBe(false);
      expect(isUniqueViolation('23505')).toBe(false);
      expect(isUniqueViolation(23505)).toBe(false);
    });

    it('does not coerce a numeric code', () => {
      // PostgREST sends SQLSTATE as a string. A numeric 23505 is a different
      // shape and matching it would be guessing.
      expect(isUniqueViolation({ code: 23505 })).toBe(false);
    });
  });
});
