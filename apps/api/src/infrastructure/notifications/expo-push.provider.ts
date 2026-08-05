import { Injectable, Logger } from '@nestjs/common';
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import type {
  INotificationProvider,
  PushPayload,
} from '../../domain/adapters/notification.interface';

/**
 * Running tally for one `sendToUser` call. Every field is a *count* — no token
 * value, message title, or body ever enters the delivery record.
 */
interface DeliveryTally {
  attempted: number;
  invalidTokens: number;
  accepted: number;
  ticketErrors: number;
  providerErrors: number;
  errorCodes: Record<string, number>;
}

/**
 * Fallback for a bracketed token we were not given — e.g. one echoed from a
 * batch we did not build. The exact-match pass below is the primary defence.
 */
const EXPO_TOKEN_PATTERN = /(Expo(?:nent)?PushToken\[)[^\]]*(\])/g;

const REDACTED = '[REDACTED_PUSH_TOKEN]';

/** Cap on a provider error message so one pathological error can't flood the log. */
const MAX_ERROR_MESSAGE_LENGTH = 200;

/**
 * Strip push tokens from a string before it reaches a log. Push tokens are
 * device credentials, and `spec/behavior/observability.md` forbids logging
 * token values; Expo echoes the offending token back in several of its error
 * messages (e.g. `"<token> is not a registered push notification recipient"`).
 *
 * Redacts by **exact match against the tokens actually in play** rather than by
 * shape. `Expo.isExpoPushToken` accepts a bare UUID as well as the
 * `ExponentPushToken[…]` / `ExpoPushToken[…]` forms, so a shape-only pattern
 * would miss a whole class of real tokens — and pattern-matching every UUID
 * would instead redact unrelated ids. The pattern remains as a fallback for
 * bracketed tokens outside the supplied set.
 */
export function redactPushTokens(
  value: string,
  tokens: readonly string[] = [],
): string {
  // split/join, not RegExp — a token contains `[` and `]`, which would need
  // escaping to be used as a pattern.
  const exact = tokens.reduce(
    (acc, token) => (token ? acc.split(token).join(REDACTED) : acc),
    value,
  );
  return exact.replace(EXPO_TOKEN_PATTERN, '$1REDACTED$2');
}

@Injectable()
export class ExpoPushProvider implements INotificationProvider {
  private readonly expo = new Expo();
  private readonly logger = new Logger(ExpoPushProvider.name);

  async sendToUser(pushTokens: string[], payload: PushPayload): Promise<void> {
    const tally: DeliveryTally = {
      attempted: pushTokens.length,
      invalidTokens: 0,
      accepted: 0,
      ticketErrors: 0,
      providerErrors: 0,
      errorCodes: {},
    };

    const validTokens = pushTokens.filter((t) => Expo.isExpoPushToken(t));
    tally.invalidTokens = pushTokens.length - validTokens.length;

    if (validTokens.length === 0) {
      // Emit before returning. A send that reaches nobody is exactly the
      // outage this instrumentation exists to surface, and it used to return
      // silently — indistinguishable from "nothing to do".
      this.emit(tally, payload);
      return;
    }

    const messages: ExpoPushMessage[] = validTokens.map((token) => ({
      to: token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: payload.priority === 'SILENT' ? undefined : 'default',
      priority:
        payload.priority === 'URGENT'
          ? 'high'
          : payload.priority === 'SILENT'
            ? 'normal'
            : 'default',
    }));

    const chunks = this.expo.chunkPushNotifications(messages);

    await Promise.allSettled(
      chunks.map(async (chunk) => {
        try {
          const tickets = await this.expo.sendPushNotificationsAsync(chunk);
          this.recordTickets(tickets, tally);
        } catch (error) {
          // The whole chunk is unaccounted for: Expo never returned per-message
          // tickets, so every message in it counts as a provider failure. The
          // SDK guarantees this is the only way a message goes unaccounted —
          // it throws when the ticket count doesn't match the messages sent.
          tally.providerErrors += chunk.length;
          this.recordProviderError(error, tally, pushTokens);
        }
      }),
    );

    this.emit(tally, payload);
  }

  /**
   * Classify per-message tickets. `sendPushNotificationsAsync` returns
   * *tickets*, not receipts: a `status: 'error'` ticket means Expo rejected
   * that message outright (`DeviceNotRegistered`, `MessageTooBig`,
   * `MessageRateExceeded`, …). Counting tickets as sends — which is what the
   * previous `Sent ${receipts.length}` line did — reports a total outage as a
   * complete success.
   */
  private recordTickets(tickets: ExpoPushTicket[], tally: DeliveryTally): void {
    for (const ticket of tickets) {
      if (ticket.status === 'ok') {
        tally.accepted += 1;
        continue;
      }
      tally.ticketErrors += 1;
      this.countCode(tally, ticket.details?.error ?? 'unknown');
    }
  }

  /**
   * A transport-level throw (network, 5xx, malformed response). Recorded under
   * a `provider:` prefix so it stays distinguishable from Expo's own per-message
   * error codes while keeping the record flat.
   */
  private recordProviderError(
    error: unknown,
    tally: DeliveryTally,
    tokens: readonly string[],
  ): void {
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.countCode(tally, `provider:${name}`);

    // Message only, never the error object: a stack would re-embed the raw
    // message (and any token in it), and during an outage every chunk fails at
    // once — exactly when log volume must stay bounded. The `provider:<name>`
    // code plus this line identify the failure class.
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `push_delivery provider error (${name}): ${redactPushTokens(
        message,
        tokens,
      ).slice(0, MAX_ERROR_MESSAGE_LENGTH)}`,
    );
  }

  private countCode(tally: DeliveryTally, code: string): void {
    tally.errorCodes[code] = (tally.errorCodes[code] ?? 0) + 1;
  }

  /**
   * Emit exactly one structured `push_delivery` record per send, following the
   * repo's structured-log convention (`LoggingInterceptor` does the same
   * `JSON.stringify` of a flat object). Failures go out at `warn` so a level
   * filter is a usable coarse alert signal on top of the field-level rate.
   *
   * Canonical shape: `spec/behavior/observability.md` (#push-delivery).
   */
  private emit(tally: DeliveryTally, payload: PushPayload): void {
    const failures =
      tally.invalidTokens + tally.ticketErrors + tally.providerErrors;

    const line = JSON.stringify({
      event: 'push_delivery',
      priority: payload.priority ?? 'NORMAL',
      category: payload.category ?? 'default',
      attempted: tally.attempted,
      accepted: tally.accepted,
      invalidTokens: tally.invalidTokens,
      ticketErrors: tally.ticketErrors,
      providerErrors: tally.providerErrors,
      failures,
      failureRate:
        tally.attempted === 0
          ? 0
          : Number((failures / tally.attempted).toFixed(4)),
      errorCodes: tally.errorCodes,
      timestamp: new Date().toISOString(),
    });

    if (failures > 0) {
      this.logger.warn(line);
      return;
    }
    this.logger.log(line);
  }
}
