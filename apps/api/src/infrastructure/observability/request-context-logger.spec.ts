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
});
