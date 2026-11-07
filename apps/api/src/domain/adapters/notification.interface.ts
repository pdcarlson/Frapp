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
  /**
   * What the phone stacks this push with. iOS groups every push sharing a
   * `threadId` into one stack in Notification Center (`aps.thread-id`); Android
   * ignores it. Chat pushes set it per channel, so a DM stacks per person and a
   * channel per channel (`spec/behavior/notifications.md` § Grouping and
   * clearing). Absent, iOS stacks the push with the app's others.
   */
  threadId?: string;
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
