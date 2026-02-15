export class PushToken {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly token: string,
    public readonly deviceName: string | null,
    public readonly createdAt: Date,
  ) {}
}

export class Notification {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly chapterId: string,
    public readonly title: string,
    public readonly body: string,
    public readonly data: Record<string, unknown> | null,
    public readonly readAt: Date | null,
    public readonly createdAt: Date,
  ) {}
}

export class NotificationPreference {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly category: string,
    public readonly isEnabled: boolean,
    public readonly updatedAt: Date,
  ) {}
}
