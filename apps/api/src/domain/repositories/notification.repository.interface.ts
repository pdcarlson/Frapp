import type {
  Notification,
  PushToken,
  NotificationPreference,
  UserSettings,
} from '../entities/notification.entity';

export const NOTIFICATION_REPOSITORY = 'NOTIFICATION_REPOSITORY';
export const PUSH_TOKEN_REPOSITORY = 'PUSH_TOKEN_REPOSITORY';
export const NOTIFICATION_PREFERENCE_REPOSITORY =
  'NOTIFICATION_PREFERENCE_REPOSITORY';
export const USER_SETTINGS_REPOSITORY = 'USER_SETTINGS_REPOSITORY';

export interface INotificationRepository {
  /**
   * Null when the database drops the row: a chat row whose message was
   * deleted (or removed) before it landed (#4418,
   * `notifications_skip_deleted_message`).
   */
  create(data: Partial<Notification>): Promise<Notification | null>;
  createMany(data: Partial<Notification>[]): Promise<Notification[]>;
  /**
   * The member's newest in-app rows in this chapter.
   *
   * `withholdChatFrom`, when non-empty, leaves out every chat row (`data.target
   * .screen` is `chat`) whose `data.senderId` is one of those users, and every
   * chat row that records no sender at all (written before #2715), in the query
   * itself so `limit` still counts rows the member is served. Rows of any other
   * kind are untouched.
   */
  findByUser(
    userId: string,
    chapterId: string,
    options?: { limit?: number; withholdChatFrom?: readonly string[] },
  ): Promise<Notification[]>;
  findById(id: string, chapterId: string): Promise<Notification | null>;
  markRead(
    id: string,
    userId: string,
    chapterId: string,
  ): Promise<Notification>;
  /**
   * Mark read every unread chat row (`data.target.screen` is `chat`) this
   * member has for `channelId`, created at or before `readThrough` (#3788).
   * A row created after that instant is about a message the member has not
   * seen, so it stays unread.
   *
   * `threadRootId` scopes it to one message thread's rows (#3785); without it
   * only timeline rows clear, because reading the channel is not reading its
   * threads.
   */
  markChatChannelRead(
    userId: string,
    chapterId: string,
    channelId: string,
    readThrough: string,
    threadRootId?: string,
  ): Promise<void>;
  /**
   * Mark read every unread row this member has in the chapter, created at or
   * before `readThrough` (#3929), and return how many changed. `screens`
   * narrows it to rows whose `data.target.screen` is one of them; omitted, it
   * is every row, chat rows the in-app list withholds included.
   */
  markAllRead(
    userId: string,
    chapterId: string,
    readThrough: string,
    screens?: readonly string[],
    ids?: readonly string[],
  ): Promise<number>;
  /**
   * Replace the body of the rows in the chapter that quote chat message
   * `messageId` (an edit, #4418), for the members in `userIds` only. Deletes need no call: a trigger on
   * `chat_messages` removes those rows with the message.
   */
  /**
   * Delete the named rows that belong to `userId` in `chapterId` (#3948),
   * answering how many went. An id that isn't theirs matches nothing.
   */
  deleteMany(
    userId: string,
    chapterId: string,
    ids: readonly string[],
  ): Promise<number>;
  rewriteChatMessageBody(
    chapterId: string,
    messageId: string,
    body: string,
    userIds: readonly string[],
  ): Promise<void>;
}

export interface IPushTokenRepository {
  create(data: Partial<PushToken>): Promise<PushToken>;
  findByUser(userId: string): Promise<PushToken[]>;
  findByUserIds(userIds: string[]): Promise<PushToken[]>;
  findById(id: string): Promise<PushToken | null>;
  findByToken(token: string): Promise<PushToken | null>;
  delete(id: string, userId: string): Promise<void>;
  deleteByToken(token: string): Promise<void>;
}

export interface INotificationPreferenceRepository {
  findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<NotificationPreference[]>;
  upsert(
    data: Partial<NotificationPreference>,
  ): Promise<NotificationPreference>;
  findByUserChapterCategory(
    userId: string,
    chapterId: string,
    category: string,
  ): Promise<NotificationPreference | null>;
  findByUsersChapterCategory(
    userIds: string[],
    chapterId: string,
    category: string,
  ): Promise<NotificationPreference[]>;
}

export interface IUserSettingsRepository {
  findByUser(userId: string): Promise<UserSettings | null>;
  findByUserIds(userIds: string[]): Promise<UserSettings[]>;
  upsert(data: Partial<UserSettings>): Promise<UserSettings>;
  /**
   * Record the zone the member's device reports, creating their row if they
   * have none, and leaving every other column as it is.
   */
  setTimeZone(userId: string, timeZone: string): Promise<void>;
}
