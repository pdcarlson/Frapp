export class ChatChannel {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly name: string,
    public readonly description: string | null,
    public readonly type: 'PUBLIC' | 'PRIVATE' | 'ROLE_GATED',
    public readonly allowedRoleIds: string[] | null,
    public readonly createdAt: Date,
  ) {}
}

export class ChatMessage {
  constructor(
    public readonly id: string,
    public readonly channelId: string,
    public readonly senderId: string,
    public readonly content: string,
    public readonly metadata: Record<string, unknown> | null,
    public readonly createdAt: Date,
  ) {}
}
