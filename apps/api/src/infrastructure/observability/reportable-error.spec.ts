import { toReportableError } from './reportable-error';

describe('toReportableError', () => {
  it('passes a real Error through untouched', () => {
    const thrown = new Error('boom');
    expect(toReportableError(thrown)).toBe(thrown);
  });

  it('joins code, message and hint, and drops details', () => {
    const reported = toReportableError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_email_key"',
      hint: 'Use a different email.',
      details: 'Key (email)=(alice@example.com) already exists.',
    });

    expect(reported).toBeInstanceOf(Error);
    expect(reported.name).toBe('NonErrorThrowable');
    expect(reported.message).toBe(
      '23505: duplicate key value violates unique constraint "users_email_key": Use a different email.',
    );
    expect(reported.message).not.toContain('alice@example.com');
  });

  it('omits details on the opaque fallback (#1762)', () => {
    // None of code/message/hint — the described path is empty, so this used to
    // JSON.stringify the whole record and put the row values in the message.
    const reported = toReportableError({
      details: 'Key (user_id)=(secret-uuid) is not present in table "users".',
      statusCode: 502,
      retryable: true,
    });

    expect(reported.name).toBe('NonErrorThrowable');
    expect(reported.message).toContain('502');
    expect(reported.message).toContain('retryable');
    expect(reported.message).not.toContain('secret-uuid');
    expect(reported.message).not.toContain('user_id');
  });

  it('does not emit details when that is the only field', () => {
    const reported = toReportableError({
      details: 'Key (email)=(alice@example.com) already exists.',
    });

    expect(reported.message).not.toContain('alice@example.com');
    expect(reported.message).not.toContain('details');
  });

  it('does not let a circular throwable break reporting', () => {
    const circular: Record<string, unknown> = { kind: 'weird' };
    circular.self = circular;

    expect(() => toReportableError(circular)).not.toThrow();
    const reported = toReportableError(circular);
    expect(reported.name).toBe('NonErrorThrowable');
    expect(reported.message).toMatch(/unserializable/);
  });

  it('does not let a BigInt field break reporting', () => {
    expect(() => toReportableError({ n: 1n })).not.toThrow();
    const reported = toReportableError({ n: 1n });
    expect(reported.message).toMatch(/unserializable/);
  });

  it('omits details even when a toJSON reintroduces the key', () => {
    const reported = toReportableError({
      statusCode: 502,
      toJSON: () => ({
        statusCode: 502,
        details: 'Key (email)=(alice@example.com) already exists.',
      }),
    });

    expect(reported.message).toContain('502');
    expect(reported.message).not.toContain('alice@example.com');
  });
    const opaque = {
      toJSON: () => undefined,
    };
    expect(() => toReportableError(opaque)).not.toThrow();
    const reported = toReportableError(opaque);
    expect(reported.name).toBe('NonErrorThrowable');
    expect(reported.message).not.toBe('[object Object]');
  });

  it('caps an over-long opaque serialization', () => {
    const reported = toReportableError({ blob: 'x'.repeat(2000) });
    expect(reported.message.length).toBeLessThanOrEqual(1000);
  });

  it('stringifies a primitive throw rather than wrapping an object', () => {
    expect(toReportableError('nope').message).toBe('nope');
    expect(toReportableError(404).message).toBe('404');
  });
});
