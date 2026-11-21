export const MEETING_MINUTES_REQUEST_REPOSITORY =
  'MEETING_MINUTES_REQUEST_REPOSITORY';

/** What `request_meeting_minutes` decided for one ask. */
export interface MinutesRequestOutcome {
  /** False when this member had already asked, or the minutes are posted. */
  requested: boolean;
  /** True when the caller sends the ping now. */
  ping: boolean;
  /** How many members the ping speaks for; 0 without a ping. */
  asked: number;
}

/**
 * Members asking for unposted minutes (`meeting_minutes_requests`, #5471).
 * Read and written with the service role; who may ask is
 * `MeetingMinutesRequestService`'s rule, and the spam guard is the
 * database's (`request_meeting_minutes`).
 */
export interface IMeetingMinutesRequestRepository {
  /** Whether `userId` has asked for these minutes. */
  hasRequested(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<boolean>;
  /**
   * Records the ask and decides, under a lock on the meeting, whether it
   * pings: at most one ping per meeting per `cooldownSeconds`.
   */
  request(
    chapterId: string,
    meetingId: string,
    userId: string,
    cooldownSeconds: number,
  ): Promise<MinutesRequestOutcome>;
  /**
   * Undoes a reminder that could not be sent: takes back `userId`'s ask,
   * un-counts the asks it spoke for, and clears the meeting's cooldown, so
   * the member can ask again.
   */
  release(chapterId: string, meetingId: string, userId: string): Promise<void>;
}
