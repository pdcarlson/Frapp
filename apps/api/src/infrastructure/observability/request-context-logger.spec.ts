import { RequestContextLogger } from './request-context-logger';
import { runWithRequestLogStore } from './request-als';

describe('RequestContextLogger', () => {
  const logger = new RequestContextLogger({
    forceConsole: true,
    colors: false,
  });

  it('keeps the Nest prefix and omits a request id outside a request', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      logger.log('booting', 'Bootstrap');
      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain('[Nest]');
      expect(line).toContain('[Bootstrap]');
      expect(line).toContain('booting');
      expect(line).not.toMatch(/req_[0-9a-f-]/);
    } finally {
      log.mockRestore();
    }
  });

  it('puts the request id on a service log inside ALS', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      runWithRequestLogStore({ requestId: 'req_logger-1' }, () => {
        logger.log('indexed', 'SearchService');
      });
      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain('[Nest]');
      expect(line).toContain('[SearchService req_logger-1]');
      expect(line).toContain('indexed');
    } finally {
      log.mockRestore();
    }
  });

  describe('JSON mode (Cloud Run)', () => {
    const jsonLogger = new RequestContextLogger({
      json: true,
      forceConsole: true,
    });
    const printed = (spy: jest.SpyInstance): Record<string, unknown> => {
      const line = String(spy.mock.calls[0]?.[0]);
      expect(line).not.toContain('\n');
      return JSON.parse(line) as Record<string, unknown>;
    };

    it('prints one Cloud Logging record per line, with severity and time', () => {
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      try {
        jsonLogger.log('booting', 'Bootstrap');
        const record = printed(log);
        expect(record).toMatchObject({
          severity: 'INFO',
          level: 'log',
          message: 'booting',
          context: 'Bootstrap',
        });
        expect(typeof record.time).toBe('string');
        expect(Number.isNaN(Date.parse(String(record.time)))).toBe(false);
        expect(record).not.toHaveProperty('timestamp');
        expect(record).not.toHaveProperty('requestId');
      } finally {
        log.mockRestore();
      }
    });

    it('maps warn and error to Cloud Logging levels', () => {
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const error = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      try {
        jsonLogger.warn('slow', 'Search');
        jsonLogger.error('failed', 'trace line 1\ntrace line 2', 'Search');
        const lines = [
          ...warn.mock.calls,
          ...error.mock.calls,
          ...log.mock.calls,
        ].map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
        expect(lines.map((r) => r.severity).sort()).toEqual([
          'ERROR',
          'WARNING',
        ]);
      } finally {
        warn.mockRestore();
        error.mockRestore();
        log.mockRestore();
      }
    });

    it('parses a JSON message into data, which cannot override the record', () => {
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      try {
        runWithRequestLogStore({ requestId: 'req_json-1' }, () => {
          jsonLogger.log(
            JSON.stringify({
              statusCode: 503,
              path: '/v1/x',
              severity: 'DEBUG',
              requestId: 'forged',
            }),
            'HTTP',
          );
        });
        const record = printed(log);
        expect(record.severity).toBe('INFO');
        expect(record.requestId).toBe('req_json-1');
        expect(record.data).toEqual({
          statusCode: 503,
          path: '/v1/x',
          severity: 'DEBUG',
          requestId: 'forged',
        });
      } finally {
        log.mockRestore();
      }
    });

    it('keeps caller text with a newline inside one escaped line', () => {
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      try {
        jsonLogger.log('query "a"\n[Nest] 1 - forged LOG', 'Search');
        expect(printed(log).message).toBe('query "a"\n[Nest] 1 - forged LOG');
        expect(printed(log)).not.toHaveProperty('data');
      } finally {
        log.mockRestore();
      }
    });

    it('keeps an Error message readable instead of printing {}', () => {
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      try {
        jsonLogger.log(new Error('db timeout'), 'Sweep');
        expect(String(printed(log).message)).toContain('db timeout');
      } finally {
        log.mockRestore();
      }
    });
  });
});
