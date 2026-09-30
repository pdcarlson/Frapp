import * as Sentry from '@sentry/nestjs';
import { reportSwallowed } from './report-swallowed';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(() => 'event-exception'),
  captureMessage: jest.fn(() => 'event-message'),
}));

const captureException = jest.mocked(Sentry.captureException);
const captureMessage = jest.mocked(Sentry.captureMessage);

function logger() {
  return { error: jest.fn(), warn: jest.fn() };
}

describe('reportSwallowed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends a message with its level, tags and fingerprint in one call', () => {
    const eventId = reportSwallowed(logger(), 'the check', () => ({
      message: 'setup: missing_redirect',
      level: 'error',
      tags: { integration: 'discord' },
      fingerprint: ['setup', 'missing_redirect'],
    }));

    expect(eventId).toBe('event-message');
    expect(captureMessage).toHaveBeenCalledWith('setup: missing_redirect', {
      level: 'error',
      tags: { integration: 'discord' },
      fingerprint: ['setup', 'missing_redirect'],
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('leaves a message ungrouped when no fingerprint is given', () => {
    reportSwallowed(logger(), 'the spike', () => ({
      message: 'spike',
      level: 'warning',
      tags: {},
    }));

    expect(captureMessage.mock.calls[0]?.[1]).not.toHaveProperty('fingerprint');
  });

  it('sends a PostgREST object legibly, fingerprinted by its code, never with details', () => {
    const eventId = reportSwallowed(logger(), 'the callback', () => ({
      error: {
        code: 'PGRST205',
        message: 'Could not find the table',
        details: 'Key (email)=(member@example.com) already exists.',
      },
      level: 'error',
      tags: { swallowed_as: 'failed' },
    }));

    expect(eventId).toBe('event-exception');
    const [reported, context] = captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toContain('PGRST205');
    expect(reported.message).not.toContain('member@example.com');
    expect(context).toEqual({
      level: 'error',
      tags: { swallowed_as: 'failed' },
      fingerprint: ['{{ default }}', 'NonErrorThrowable:PGRST205'],
    });
  });

  it('passes a real Error through, with no fingerprint to override its stack', () => {
    const thrown = new Error('boom');
    reportSwallowed(logger(), 'a 500', () => ({
      error: thrown,
      level: 'error',
      tags: {},
    }));

    const [reported, context] = captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(reported).toBe(thrown);
    expect(context).not.toHaveProperty('fingerprint');
  });

  it('passes a pseudonymous user through untouched', () => {
    const id = 'a'.repeat(64);
    reportSwallowed(logger(), 'a 500', () => ({
      error: new Error('boom'),
      level: 'error',
      tags: {},
      user: { id },
    }));

    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      user: { id },
    });
  });

  it('logs and returns undefined when Sentry throws, instead of throwing', () => {
    const log = logger();
    captureMessage.mockImplementationOnce(() => {
      throw new Error('transport down');
    });

    const eventId = reportSwallowed(log, 'the check', () => ({
      message: 'x',
      level: 'error',
      tags: {},
    }));

    expect(eventId).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      'Sentry report failed for the check: transport down',
    );
  });

  it('logs a non-Error Sentry fault legibly, not as [object Object]', () => {
    const log = logger();
    captureException.mockImplementationOnce(() => {
      // The case under test: a fault that is not an Error.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw { code: 'E_TRANSPORT', message: 'queue full' };
    });

    reportSwallowed(log, 'a 500', () => ({
      error: new Error('boom'),
      level: 'error',
      tags: {},
    }));

    expect(log.warn).toHaveBeenCalledWith(
      'Sentry report failed for a 500: E_TRANSPORT: queue full',
    );
  });

  it('keeps a throw while building the report inside the guard', () => {
    const log = logger();

    const eventId = reportSwallowed(log, 'the spike', () => {
      throw new Error('salt lookup broke');
    });

    expect(eventId).toBeUndefined();
    expect(captureMessage).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      'Sentry report failed for the spike: salt lookup broke',
    );
  });
});
