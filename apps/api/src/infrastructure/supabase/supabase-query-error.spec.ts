import { inspect } from 'node:util';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import { logThrowable } from '../observability/log-throwable';
import { toReportableError } from '../observability/reportable-error';
import { SupabaseQueryError } from './supabase-query-error';

/** What postgrest-js resolves `error` with: a parsed body, not an `Error`. */
const ROW_VALUES = 'Key (email)=(alice@example.com) already exists.';
const duplicate = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "users_email_key"',
  details: ROW_VALUES,
  hint: 'Pick another email.',
};

/** A stand-in for a repository method: the frame the stack should start at. */
function failingQueryMethod(): SupabaseQueryError {
  return new SupabaseQueryError(duplicate);
}

describe('SupabaseQueryError (#1264)', () => {
  it('is a real Error, named for what failed', () => {
    const error = new SupabaseQueryError(duplicate);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SupabaseQueryError');
    expect(String(error)).not.toContain('[object Object]');
  });

  it('reads `code: message: hint`, the text toReportableError built', () => {
    const error = new SupabaseQueryError(duplicate);

    expect(error.message).toBe(
      '23505: duplicate key value violates unique constraint "users_email_key": Pick another email.',
    );
    // Same reading of the same record, so nothing an operator reads changes.
    expect(error.message).toBe(toReportableError(duplicate).message);
  });

  it('keeps `code` and `hint` as fields, so a caller can still branch on the SQLSTATE', () => {
    const error = new SupabaseQueryError(duplicate);

    expect(error.code).toBe('23505');
    expect(error.hint).toBe('Pick another email.');
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('omits a field PostgREST did not send rather than setting it undefined', () => {
    // A non-JSON error body arrives as `{ message: body }` and nothing else.
    const error = new SupabaseQueryError({ message: 'Bad Gateway' });

    expect(error.message).toBe('Bad Gateway');
    expect(error).not.toHaveProperty('code');
    expect(error).not.toHaveProperty('hint');
    expect(Object.keys(error)).toEqual(['name']);
  });

  it('carries `details` on no channel: field, keys, inspect, JSON or stack', () => {
    const error = new SupabaseQueryError(duplicate);

    expect(error).not.toHaveProperty('details');
    expect(Object.keys(error).sort()).toEqual(['code', 'hint', 'name']);
    expect(inspect(error)).not.toContain('alice@example.com');
    expect(JSON.stringify(error)).not.toContain('alice@example.com');
    expect(error.stack).not.toContain('alice@example.com');
  });

  it('drops `details` from the fallback too, when the record names no fault', () => {
    const error = new SupabaseQueryError({ details: ROW_VALUES });

    expect(error.message).not.toContain('alice@example.com');
  });

  it('starts its stack at the method that threw, not at this constructor', () => {
    const lines = (failingQueryMethod().stack ?? '').split('\n');

    expect(lines[0]).toBe(
      `SupabaseQueryError: ${new SupabaseQueryError(duplicate).message}`,
    );
    expect(lines[1]).toContain('failingQueryMethod');
    expect(lines.join('\n')).not.toContain('new SupabaseQueryError');
  });

  it('passes through toReportableError untouched, stack and all', () => {
    const error = failingQueryMethod();

    expect(toReportableError(error)).toBe(error);
  });

  it('logs as its code and message through logThrowable, with its own stack', () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    const error = failingQueryMethod();

    logThrowable(logger, 'error', 'Invite failed', error);

    expect(logger.error).toHaveBeenCalledWith(
      `Invite failed: ${error.message}`,
      error.stack,
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'alice@example.com',
    );
  });
});
