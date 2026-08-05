import { Logger } from '@nestjs/common';

const mockChunkPushNotifications = jest.fn();
const mockSendPushNotificationsAsync = jest.fn();
const mockIsExpoPushToken = jest.fn();

jest.mock('expo-server-sdk', () => {
  const MockExpo = jest.fn().mockImplementation(() => ({
    chunkPushNotifications: mockChunkPushNotifications,
    sendPushNotificationsAsync: mockSendPushNotificationsAsync,
  })) as unknown as jest.Mock & { isExpoPushToken: jest.Mock };
  MockExpo.isExpoPushToken = mockIsExpoPushToken;
  return { __esModule: true, default: MockExpo, Expo: MockExpo };
});

// Imported after the mock so the provider's `new Expo()` field picks it up.
import { ExpoPushProvider, redactPushTokens } from './expo-push.provider';

const VALID_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const VALID_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

/** Parse the single `push_delivery` record emitted by a send. */
function recordFrom(spy: jest.SpyInstance): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
}

describe('ExpoPushProvider', () => {
  let provider: ExpoPushProvider;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    // Default: real-looking Expo tokens are valid, everything else isn't, and
    // all messages land in one chunk.
    mockIsExpoPushToken.mockImplementation(
      (t: unknown) =>
        typeof t === 'string' && t.startsWith('ExponentPushToken['),
    );
    mockChunkPushNotifications.mockImplementation((messages: unknown[]) => [
      messages,
    ]);

    provider = new ExpoPushProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('successful delivery', () => {
    it('counts accepted tickets and emits a clean record at log level', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 'r-1' },
        { status: 'ok', id: 'r-2' },
      ]);

      await provider.sendToUser([VALID_A, VALID_B], {
        title: 'Hi',
        body: 'There',
        priority: 'URGENT',
        category: 'announcements',
      });

      const record = recordFrom(logSpy);
      expect(record).toMatchObject({
        event: 'push_delivery',
        priority: 'URGENT',
        category: 'announcements',
        attempted: 2,
        accepted: 2,
        invalidTokens: 0,
        ticketErrors: 0,
        providerErrors: 0,
        failures: 0,
        failureRate: 0,
        errorCodes: {},
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('defaults priority and category when the payload omits them', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 'r-1' },
      ]);

      await provider.sendToUser([VALID_A], { title: 'Hi', body: 'There' });

      expect(recordFrom(logSpy)).toMatchObject({
        priority: 'NORMAL',
        category: 'default',
      });
    });
  });

  describe('ticket errors', () => {
    it('counts error tickets as failures and breaks them down by Expo error code', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 'r-1' },
        {
          status: 'error',
          message: 'not a registered recipient',
          details: { error: 'DeviceNotRegistered' },
        },
      ]);

      await provider.sendToUser([VALID_A, VALID_B], {
        title: 'Hi',
        body: 'There',
        category: 'chat',
      });

      const record = recordFrom(warnSpy);
      expect(record).toMatchObject({
        attempted: 2,
        accepted: 1,
        ticketErrors: 1,
        failures: 1,
        failureRate: 0.5,
        errorCodes: { DeviceNotRegistered: 1 },
      });
      // The regression this issue exists to close: an error ticket must never
      // be counted as a send.
      expect(record.accepted).not.toBe(2);
    });

    it('buckets an error ticket with no details under "unknown"', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'error', message: 'something went wrong' },
      ]);

      await provider.sendToUser([VALID_A], { title: 'Hi', body: 'There' });

      expect(recordFrom(warnSpy)).toMatchObject({
        ticketErrors: 1,
        errorCodes: { unknown: 1 },
      });
    });
  });

  describe('invalid tokens', () => {
    it('counts filtered tokens and still emits when none survive', async () => {
      await provider.sendToUser(['garbage-token'], {
        title: 'Hi',
        body: 'There',
        category: 'events',
      });

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
      expect(recordFrom(warnSpy)).toMatchObject({
        category: 'events',
        attempted: 1,
        accepted: 0,
        invalidTokens: 1,
        failures: 1,
        failureRate: 1,
      });
    });

    it('sends to the valid tokens while counting the invalid ones', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 'r-1' },
      ]);

      await provider.sendToUser([VALID_A, 'garbage-token'], {
        title: 'Hi',
        body: 'There',
      });

      const sent = mockSendPushNotificationsAsync.mock.calls[0][0] as Array<{
        to: string;
      }>;
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(VALID_A);

      expect(recordFrom(warnSpy)).toMatchObject({
        attempted: 2,
        accepted: 1,
        invalidTokens: 1,
        failures: 1,
        failureRate: 0.5,
      });
    });
  });

  describe('provider errors', () => {
    it('attributes every message in a throwing chunk to providerErrors', async () => {
      mockSendPushNotificationsAsync.mockRejectedValue(
        new TypeError('network unreachable'),
      );

      await provider.sendToUser([VALID_A, VALID_B], {
        title: 'Hi',
        body: 'There',
      });

      expect(recordFrom(warnSpy)).toMatchObject({
        attempted: 2,
        accepted: 0,
        providerErrors: 2,
        failures: 2,
        failureRate: 1,
        errorCodes: { 'provider:TypeError': 1 },
      });
    });

    it('keeps a chunk failure from suppressing a sibling chunk', async () => {
      mockChunkPushNotifications.mockImplementation((messages: unknown[]) => [
        [messages[0]],
        [messages[1]],
      ]);
      mockSendPushNotificationsAsync
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([{ status: 'ok', id: 'r-2' }]);

      await provider.sendToUser([VALID_A, VALID_B], {
        title: 'Hi',
        body: 'There',
      });

      expect(recordFrom(warnSpy)).toMatchObject({
        attempted: 2,
        accepted: 1,
        providerErrors: 1,
        failures: 1,
      });
    });
  });

  describe('token safety', () => {
    it('never puts a token value in the delivery record', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 'r-1' },
      ]);

      await provider.sendToUser([VALID_A], {
        title: 'Hi',
        body: 'There',
        data: { target: { screen: 'chat' } },
      });

      const line = logSpy.mock.calls[0][0] as string;
      expect(line).not.toContain(VALID_A);
      expect(line).not.toContain('aaaaaaaaaaaaaaaaaaaaaa');
    });

    it('redacts a token echoed back inside a provider error message', async () => {
      mockSendPushNotificationsAsync.mockRejectedValue(
        new Error(`${VALID_A} is not a registered push notification recipient`),
      );

      await provider.sendToUser([VALID_A], { title: 'Hi', body: 'There' });

      const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain('ExponentPushToken[REDACTED]');
      expect(logged).not.toContain('aaaaaaaaaaaaaaaaaaaaaa');
    });

    it('truncates a pathologically long provider error message', async () => {
      mockSendPushNotificationsAsync.mockRejectedValue(
        new Error('x'.repeat(5000)),
      );

      await provider.sendToUser([VALID_A], { title: 'Hi', body: 'There' });

      const logged = String(errorSpy.mock.calls[0][0]);
      expect(logged.length).toBeLessThan(300);
    });
  });

  describe('redactPushTokens', () => {
    it('redacts both Expo token spellings and leaves other text alone', () => {
      expect(
        redactPushTokens(
          'ExponentPushToken[abc] and ExpoPushToken[def] failed',
        ),
      ).toBe('ExponentPushToken[REDACTED] and ExpoPushToken[REDACTED] failed');
      expect(redactPushTokens('plain error')).toBe('plain error');
    });
  });
});
