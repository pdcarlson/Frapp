import { ConsoleLogger } from '@nestjs/common';
import { logThrowable } from './log-throwable';

const DETAILS = 'Key (email)=(alice@example.com) already exists.';

const POSTGREST = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "users_email_key"',
  hint: 'Use a different email.',
  details: DETAILS,
};

describe('logThrowable', () => {
  it('passes one string and never the throwable object', () => {
    const error = jest.fn();
    const warn = jest.fn();

    logThrowable(
      { error, warn },
      'error',
      'Failed to persist theme palette',
      POSTGREST,
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toHaveLength(1);
    const line = error.mock.calls[0][0] as string;
    expect(line).toContain('Failed to persist theme palette');
    expect(line).toContain('23505');
    expect(line).toContain('users_email_key');
    expect(line).not.toContain('alice@example.com');
    expect(line).not.toContain('details');
  });

  it('warn interpolates the same way', () => {
    const error = jest.fn();
    const warn = jest.fn();

    logThrowable(
      { error, warn },
      'warn',
      'analytics opt-out lookup failed',
      POSTGREST,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('alice@example.com');
  });

  it('Nest ConsoleLogger inspects a PostgREST object passed as a second argument', () => {
    const chunks: string[] = [];
    const write = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        chunks.push(String(chunk));
        return true;
      });

    try {
      const logger = new ConsoleLogger('log-throwable-spec', {
        colors: false,
      });
      logger.error('Failed to validate default invite role', POSTGREST);
    } finally {
      write.mockRestore();
    }

    expect(chunks.join('')).toContain('alice@example.com');
  });

  it('Nest ConsoleLogger does not print details when logThrowable interpolates', () => {
    const chunks: string[] = [];
    const write = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        chunks.push(String(chunk));
        return true;
      });

    try {
      const logger = new ConsoleLogger('log-throwable-spec', {
        colors: false,
      });
      logThrowable(
        logger,
        'error',
        'Failed to validate default invite role',
        POSTGREST,
      );
    } finally {
      write.mockRestore();
    }

    const text = chunks.join('');
    expect(text).toContain('Failed to validate default invite role');
    expect(text).not.toContain('alice@example.com');
  });
});
