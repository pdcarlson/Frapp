/**
 * CJS-friendly stand-in for `expo-server-sdk` 6+, which ships ESM-only
 * (`"type": "module"`). Jest's CommonJS runtime cannot parse the real
 * `build/ExpoClient.js` (`import assert from 'node:assert'`), so
 * `test/jest-e2e.json` maps the package here.
 *
 * E2E never sends push — no spec touches `NOTIFICATION_PROVIDER` /
 * `sendToUser`. This only has to construct when `AppModule` boots
 * `ExpoPushProvider`, and no-op if a future spec does send.
 */
export class Expo {
  static isExpoPushToken(token: unknown): boolean {
    return (
      typeof token === 'string' &&
      (((token.startsWith('ExponentPushToken[') ||
        token.startsWith('ExpoPushToken[')) &&
        token.endsWith(']')) ||
        /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(
          token,
        ))
    );
  }

  chunkPushNotifications<T>(messages: T[]): T[][] {
    return [messages];
  }

  sendPushNotificationsAsync(
    messages: Array<{ to: unknown }>,
  ): Promise<Array<{ status: 'ok'; id: string }>> {
    return Promise.resolve(
      messages.map((_, i) => ({ status: 'ok', id: `e2e-stub-${i}` })),
    );
  }
}

export default Expo;
