import { Injectable, Logger } from '@nestjs/common';
import { isAnnouncementChannel, isModuleEnabled } from '@repo/validation';
import {
  chatItems,
  eventItems,
  minutesItems,
  officerQueueItem,
  signupItems,
  studyItem,
  type NudgeItem,
} from '#domain/utils/member-nudge-items';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { SystemPermissions } from '#domain/constants/permissions';
import { ActivityService } from './activity.service';
import { RbacService } from './rbac.service';
import { ActivityStandingService } from './activity-standing.service';
import { ChatService } from './chat.service';
import { MeetingService } from './meeting.service';
import {
  MemberNudgeService,
  type MemberNudgeCardResult,
} from './member-nudge/member-nudge.service';

type EnabledModules = Record<string, boolean> | null;

/** At most this many recent meetings' minutes are read. */
const MINUTES_LIMIT = 10;
/** Meetings held this far back may have had their minutes posted lately. */
const MINUTES_HELD_WINDOW_MS = 21 * 86_400_000;

/**
 * The card at the top of a member's Activity (#5464, `spec/behavior/ai.md`
 * § Nudges): it gathers what waits on the member from the reads Activity
 * already owns, each under its own module's rule for who may see it, and
 * hands them to `MemberNudgeService`, which picks one, keeps the record and
 * writes the words.
 *
 * Every source is read on its own. One that fails, or whose module the
 * chapter has off, contributes nothing; the card is an extra, so a failure
 * is never the member's to see.
 */
@Injectable()
export class ActivityCardService {
  private readonly logger = new Logger(ActivityCardService.name);

  constructor(
    private readonly activity: ActivityService,
    private readonly standing: ActivityStandingService,
    private readonly chat: ChatService,
    private readonly meetings: MeetingService,
    private readonly nudges: MemberNudgeService,
    private readonly rbac: RbacService,
  ) {}

  async card(input: {
    chapterId: string;
    userId: string;
    enabledModules: EnabledModules;
    timeZone: string;
    signal?: AbortSignal;
    now?: Date;
  }): Promise<MemberNudgeCardResult> {
    const now = input.now ?? new Date();
    const { chapterId, userId, enabledModules, timeZone } = input;
    const on = (key: string) => isModuleEnabled(enabledModules, key);

    const [aiUse, activity, standing, chat, minutes] = await Promise.all([
      this.rbac
        .memberHasAnyPermission(chapterId, userId, [SystemPermissions.AI_USE])
        .catch(() => false),
      this.read('activity', () =>
        this.activity.getActivity(chapterId, userId, enabledModules, { now }),
      ),
      on('study')
        ? this.read('standing', () =>
            this.standing.getStanding(chapterId, userId, enabledModules, {
              now,
            }),
          )
        : null,
      this.read('chat', async () => {
        const [channels, unread, latest] = await Promise.all([
          this.chat.getChannels(chapterId, userId),
          this.chat.getUnreadCounts(chapterId, userId),
          this.chat.getLatestMessages(chapterId, userId),
        ]);
        return { channels, unread, latest };
      }),
      on('meetings')
        ? this.read('minutes', () =>
            this.meetings.listPostedSince(
              chapterId,
              userId,
              // This reads by when the meeting was held, and minutes are often
              // posted days later: a wider stretch, then `minutesItems` keeps
              // what was posted in the last three days.
              new Date(now.getTime() - MINUTES_HELD_WINDOW_MS),
              MINUTES_LIMIT,
            ),
          )
        : null,
    ]);

    const items: NudgeItem[] = [];
    if (activity) {
      items.push(...eventItems(activity.coming_up, now, timeZone));
      items.push(...signupItems(activity.needs_you.cards, now, timeZone));
      const queue = officerQueueItem(
        {
          tasks: activity.needs_you.task_confirmations,
          hours: activity.needs_you.hours_approvals,
        },
        now,
      );
      if (queue) items.push(queue);
    }
    if (chat) {
      items.push(
        ...chatItems({
          channels: chat.channels.map((channel) => ({
            id: channel.id,
            name: channel.name,
            type: channel.type,
            is_announcements: isAnnouncementChannel(channel),
          })),
          unread: chat.unread,
          latest: chat.latest,
          now,
        }),
      );
    }
    if (minutes) items.push(...minutesItems(minutes, userId, now, timeZone));
    if (standing?.study) {
      const study = studyItem(standing.study, now);
      if (study) items.push(study);
    }

    return this.nudges.card(
      {
        chapterId,
        userId,
        timeZone,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        items,
        tasksOn: on('tasks'),
        aiUse,
      },
      now,
    );
  }

  private async read<T>(
    part: string,
    run: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: `activity-card-${part}`,
        message: `Activity card: the ${part} read failed; left out of the pick`,
        error,
      });
      return null;
    }
  }
}
