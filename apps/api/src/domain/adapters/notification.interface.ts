export const NOTIFICATION_PROVIDER = 'NOTIFICATION_PROVIDER';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: 'URGENT' | 'NORMAL' | 'SILENT';
  /**
   * Notification category (`chat`, `events`, `announcements`, …). Carried for
   * delivery telemetry only — the push transport does not send it to the
   * device; the client groups on `data.target` instead. Lets `push_delivery`
   * records be sliced by category (`spec/behavior/observability.md`).
   */
  category?: string;
}

export interface SendToUserResult {
  /**
   * Tokens Expo reported as permanently undeliverable (`DeviceNotRegistered`)
   * — safe to prune from `push_tokens`. Never populated for a transient or
   * app-level failure (rate limits, oversized payload, bad credentials): those
   * say nothing about whether the specific token is still valid.
   */
  invalidTokens: string[];
}

export interface INotificationProvider {
  sendToUser(
    pushTokens: string[],
    payload: PushPayload,
  ): Promise<SendToUserResult>;
}
