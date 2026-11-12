import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHECK_IN_GRACE_MINUTES,
  can,
  checkInWindowBounds,
  isModuleEnabled,
} from '@repo/validation';
import { ACTIVITY_ITEM_READ_REPOSITORY } from '#domain/repositories/activity-item-read.repository.interface';
import type {
  ActivityItemRef,
  IActivityItemReadRepository,
} from '#domain/repositories/activity-item-read.repository.interface';
import type { ActivityItemKind } from '#domain/entities/activity-item-read.entity';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import {
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import type {
  IChatMessageActionRepository,
  IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type { ChannelType, ChatMessage } from '#domain/entities/chat.entity';
import type { Event } from '#domain/entities/event.entity';
import type { ServiceEntry } from '#domain/entities/service-entry.entity';
import { TaskStatus } from '#domain/entities/task.entity';
import type { TaskView } from '#domain/entities/task.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  CARD_VOTE_ACTION_TYPE,
  cardPollClosedEarly,
  cardVoteSelection,
  isPollClosed,
} from '#domain/utils/poll-vote-rules';
import type { CardPollPayload } from '#domain/utils/poll-vote-rules';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { ActivityLinkService } from './activity-link.service';
import type { ActivityLink, ChatReads } from './activity-link.service';
import { displayNamesById } from './display-names';
import { maskBlockedMessages } from './chat-block-mask';
import type { MaskedChatMessage } from './chat-block-mask';
import { ChatBlockService } from './chat-block.service';
import { ChatService } from './chat.service';
import { EventService } from './event.service';
import { attendanceFor } from './event-role-targeting';
import type { EnabledModules } from './module-gate';
import { RbacService } from './rbac.service';
import { ServiceEntryService } from './service-entry.service';
import { TaskService } from './task.service';

/** The sections of the read, as `unavailable` names them. */
export const ACTIVITY_SECTIONS = [
  'tasks',
  'hours_approvals',
  'polls',
  'coming_up',
  'made_events',
  'links',
] as const;
export type ActivitySection = (typeof ACTIVITY_SECTIONS)[number];

/**
 * A task row. Carries what chat's task card reads from its message payload
 * (ids, both names, due date, reward), so a client can draw that same card
 * for a task whether or not a card for it was ever posted to a channel.
 */
export interface ActivityTask {
  id: string;
  title: string;
  due_date: string;
  /** The moment it is due, when it has a time of day (#4003). */
  due_at: string | null;
  /** Display status: `OVERDUE` for an open task past its due date. */
  status: TaskStatus;
  /** The status actually stored; what the next transition is checked against. */
  stored_status: TaskStatus;
  assignee_id: string;
  /** Empty when the member cannot be resolved (they have left). */
  assignee_name: string;
  created_by: string;
  /** Empty when the member cannot be resolved (they have left). */
  created_by_name: string;
  point_reward: number | null;
  completed_at: string | null;
  /** When an officer confirmed the completion; `null` until then. */
  confirmed_at: string | null;
  /** When an officer last sent the completion back; `null` if never. */
  sent_back_at: string | null;
  created_at: string;
  /**
   * Whether the caller hasn't opened it since it appeared
   * (`spec/behavior/activity.md` § Unread). Always false in `made_by_you`.
   */
  unread: boolean;
}

/** A pending service entry, for a member who can approve it. */
export interface ActivityHoursEntry {
  id: string;
  user_id: string;
  /** Empty when the member cannot be resolved (they have left). */
  member_name: string;
  date: string;
  duration_minutes: number;
  description: string;
  created_at: string;
  /**
   * Whether the caller hasn't opened it since it appeared
   * (`spec/behavior/activity.md` § Unread). Always false in `made_by_you`.
   */
  unread: boolean;
}

/**
 * A poll card, as a pointer to its chat message plus what a list row shows.
 *
 * No tallies: a client draws chat's own poll card from the message itself,
 * which it reads the way chat does (so the same access rule and the same live
 * updates apply), and the card counts the votes.
 */
export interface ActivityPoll {
  message_id: string;
  channel_id: string;
  /** The channel's name; a direct message's is server-generated, so use `channel_type`. */
  channel_name: string;
  channel_type: ChannelType;
  sender_id: string | null;
  question: string;
  option_count: number;
  /** When voting stops; `null` for a card posted with no usable deadline, which stays open. */
  closes_at: string | null;
  /** Set when it was closed early, by its creator or a `channels:manage` holder. */
  closed_at: string | null;
  is_closed: boolean;
  has_voted: boolean;
  created_at: string;
  /**
   * Whether the caller hasn't opened it since it appeared
   * (`spec/behavior/activity.md` § Unread). Always false in `made_by_you`.
   */
  unread: boolean;
  /**
   * The poll's chat message, as `GET /v1/channels/{id}/messages` serves it,
   * so a client can hand it to chat's own poll card. Its votes are not in it:
   * a client reads `chat_message_actions` for the message the way chat does.
   */
  message: MaskedChatMessage;
}

/** An upcoming event the member is invited to. */
export interface ActivityEvent {
  id: string;
  name: string;
  location: string | null;
  start_time: string;
  end_time: string;
  /**
   * What the event asks of this member (`spec/behavior/events.md` §
   * Attendance by role), not the event's default: a role of theirs the event
   * lists decides it, and an alumnus the default alone would require is
   * optional.
   */
  attendance: 'required' | 'optional';
  point_value: number;
  check_in_opens_minutes: number;
  /**
   * Whether this member can check in right now: the window is open and
   * check-in would not refuse them (an alumnus no role of the event names).
   */
  check_in_open: boolean;
  /**
   * Whether the member has an attendance row for it. Read only while check-in
   * is open; `null` otherwise, and when that read failed.
   */
  checked_in: boolean | null;
  /**
   * Who made it; `null` for an event made before makers were recorded
   * (`spec/behavior/events.md` § Event Creation).
   */
  created_by: string | null;
  /** When the event was made, which is when it appeared on Activity. */
  created_at: string;
  /**
   * Whether the caller hasn't opened it since it appeared
   * (`spec/behavior/activity.md` § Unread). Always false in `made_by_you`.
   */
  unread: boolean;
}

export interface ActivityView {
  needs_you: {
    /** Open tasks assigned to the caller, soonest due first. */
    tasks: ActivityTask[];
    /** Finished tasks the caller can confirm, longest waiting first. */
    task_confirmations: ActivityTask[];
    /** Pending service entries the caller can approve, oldest first. */
    hours_approvals: ActivityHoursEntry[];
    /** Open polls the caller can read and hasn't voted on, soonest closing first. */
    polls: ActivityPoll[];
  };
  /** Upcoming events, soonest first. */
  coming_up: ActivityEvent[];
  /**
   * Sign-up links posted in channels the caller can read, newest first
   * (`ActivityLinkService.listFor`). Not counted in `needs_you_count`.
   */
  links: ActivityLink[];
  made_by_you: {
    /**
     * The caller's poll cards, newest first: up to 25 open and the 25 most
     * recent closed, so a run of closed polls never pushes an open one out
     * (#4258). A client lists the open ones and archives the closed.
     */
    polls: ActivityPoll[];
    tasks: ActivityTask[];
    /**
     * Always empty. Uploads left Activity (#4291); the field stays only so a
     * client built before that, an open web tab or a phone's over-the-air
     * bundle, does not fail on its absence. Removal is tracked separately.
     */
    files: unknown[];
    /**
     * Events the caller made that have not ended, soonest first. A recurring
     * series is one row, its next meeting. Events made before creators were
     * recorded are not here.
     */
    events: ActivityEvent[];
  };
  /**
   * How many things wait on the caller: every `needs_you` row, counted before
   * the per-list cap, plus events whose check-in is open and not yet used.
   */
  needs_you_count: number;
  /** Sections that could not be read this time and are served empty. */
  unavailable: ActivitySection[];
  /**
   * When the caller's unread dots began in this chapter; `null` until a
   * client that draws them calls {@link ActivityService.startUnread}, and
   * every row is read until then.
   */
  unread_since: string | null;
}

/** Rows each list carries. The count in `needs_you_count` is taken before it. */
const LIST_LIMIT = 25;
/** How many of the chapter's newest poll cards are checked for "open and unvoted". */
const POLL_SCAN_LIMIT = 100;
/** How far ahead "coming up" looks. */
const COMING_UP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const COMING_UP_LIMIT = 10;
/**
 * Rows of the caller's own events read before a series is folded to its next
 * meeting: enough for a weekly series or two to sit beside one-off events.
 */
const MADE_EVENTS_SCAN_LIMIT = 200;

interface PollCardFields {
  question: string;
  option_count: number;
  closes_at: string | null;
  closed_at: string | null;
}

/**
 * The fields of a poll card's payload this read uses, or `null` for one chat's
 * card cannot draw. The rule is the clients' (`readPollPayload` in
 * `@repo/chat-core/polls`): a question, and two options with an id and a
 * label. Nothing validates a card on send, so the row a member acts on is
 * decided the way the card they will see is.
 */
function readPollCard(message: ChatMessage): PollCardFields | null {
  const payload = message.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const card = payload as CardPollPayload & { question?: unknown };
  const options: unknown = card.options;
  if (typeof card.question !== 'string' || !Array.isArray(options)) {
    return null;
  }
  const usable = options.filter((option: unknown) => {
    if (!option || typeof option !== 'object') return false;
    const { id, label } = option as { id?: unknown; label?: unknown };
    return typeof id === 'string' && typeof label === 'string';
  }).length;
  if (usable < 2) return null;
  return {
    question: card.question,
    option_count: usable,
    // Only a deadline that parses: one that does not is no deadline, the way
    // `isPollClosed` reads it.
    closes_at:
      typeof card.closes_at === 'string' &&
      !Number.isNaN(new Date(card.closes_at).getTime())
        ? card.closes_at
        : null,
    closed_at:
      cardPollClosedEarly(card) && typeof card.closed_at === 'string'
        ? card.closed_at
        : null,
  };
}

/**
 * Closed early, or past its deadline by the rule the vote path applies
 * (`isPollClosed`): a card with no deadline, or one that does not parse,
 * stays open, as it does for a vote.
 */
function pollCardClosed(card: PollCardFields, now: Date): boolean {
  return card.closed_at !== null || isPollClosed(card.closes_at, now);
}

/** The later of two timestamps; one that is null or doesn't parse loses. */
function latest(a: string, b: string | null): string {
  if (b === null || Number.isNaN(new Date(b).getTime())) return a;
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

function byAscending<T>(keyOf: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => keyOf(a).localeCompare(keyOf(b));
}

function byNewest<T extends { created_at: string }>(a: T, b: T): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

type Settled<T> = { ok: true; value: T } | { ok: false };

/** What the event sections need to know about the caller, read once per request. */
interface EventViewer {
  roleIds: string[];
  isAlumni: boolean;
}

/**
 * The Activity page's read (`spec/behavior/activity.md`): what waits on one
 * member and what they made, gathered from the modules that own each record.
 *
 * A read-only aggregation with no table of its own. Every row comes through
 * the owning module's service, and each section applies that module's own
 * rule for who may see it, because the sections do not share one:
 *
 * - **Tasks** are the caller's own; the chapter-wide list (for confirmations
 *   and "tasks you assigned") is read only for a `tasks:manage` holder, the
 *   rule `GET /v1/tasks` applies.
 * - **Hours approvals** need `service:approve`, and leave out the caller's own
 *   entries, which the approve route refuses.
 * - **Polls** are chat messages. A poll is listed only when its channel is in
 *   {@link ChatService.getChannels}, chat's own list of what the caller may
 *   read, and never when the caller has blocked its author.
 * - **Events** come through `EventService.findByChapter` with the viewer, so
 *   an event that leaves the member out contributes nothing.
 * - **Links** are read by {@link ActivityLinkService}, under chat's channel
 *   list and the block list, as polls are.
 *
 * A module the chapter has switched off contributes nothing. The sections
 * are read independently: one that fails is served empty and named in
 * `unavailable`, rather than failing a page the others already answered for.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly taskService: TaskService,
    private readonly serviceEntryService: ServiceEntryService,
    private readonly eventService: EventService,
    private readonly chatService: ChatService,
    private readonly chatBlocks: ChatBlockService,
    private readonly rbacService: RbacService,
    private readonly linkService: ActivityLinkService,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(CHAT_MESSAGE_ACTION_REPOSITORY)
    private readonly actionRepo: IChatMessageActionRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
    @Inject(ACTIVITY_ITEM_READ_REPOSITORY)
    private readonly readRepo: IActivityItemReadRepository,
  ) {}

  async getActivity(
    chapterId: string,
    userId: string,
    enabledModules: EnabledModules,
  ): Promise<ActivityView> {
    const permissions = await this.rbacService.getEffectivePermissions(
      chapterId,
      userId,
    );
    const on = (moduleKey: string) =>
      isModuleEnabled(enabledModules, moduleKey);
    const now = Date.now();
    // Read once and shared by both event sections, and only when one of them
    // has an event to answer for.
    let viewerRead: Promise<EventViewer> | null = null;
    const viewer = () =>
      (viewerRead ??= Promise.all([
        this.memberRepo.findByUserAndChapter(userId, chapterId),
        this.rbacService.isAlumni(chapterId, userId),
      ]).then(([member, isAlumni]) => ({
        roleIds: member?.role_ids ?? [],
        isAlumni,
      })));

    // Chat's channel list and the caller's block list, read once and shared
    // by the two sections that list chat messages (polls and links), and only
    // when one of them runs.
    let chatRead: Promise<ChatReads> | null = null;
    const chatReads = () =>
      (chatRead ??= Promise.all([
        this.chatService.getChannels(chapterId, userId),
        this.chatBlocks.listBlockedUserIds(chapterId, userId),
      ]).then(([channels, blockedUserIds]) => ({ channels, blockedUserIds })));

    const [tasks, hours, polls, events, madeEvents, links] = await Promise.all([
      this.settle('tasks', chapterId, () =>
        on('tasks')
          ? this.readTasks(chapterId, userId, permissions)
          : Promise.resolve({
              mine: [],
              confirmations: [],
              confirmationsWaiting: 0,
              assigned: [],
            }),
      ),
      this.settle('hours_approvals', chapterId, () =>
        on('hours') && can(SystemPermissions.SERVICE_APPROVE, permissions)
          ? this.readHoursApprovals(chapterId, userId)
          : Promise.resolve([]),
      ),
      this.settle('polls', chapterId, () =>
        on('polls')
          ? this.readPolls(chapterId, userId, now, chatReads)
          : Promise.resolve({ unvoted: [], mine: [] }),
      ),
      this.settle('coming_up', chapterId, () =>
        on('events')
          ? this.readComingUp(chapterId, userId, now, viewer)
          : Promise.resolve([]),
      ),
      this.settle('made_events', chapterId, () =>
        on('events')
          ? this.readMadeEvents(chapterId, userId, now, viewer)
          : Promise.resolve([]),
      ),
      // Chat has no module switch, so neither does this section.
      this.settle('links', chapterId, () =>
        chatReads().then((reads) =>
          this.linkService.listFor(chapterId, userId, now, reads),
        ),
      ),
    ]);

    const unavailable: ActivitySection[] = [];
    const valueOf = <T>(
      section: ActivitySection,
      result: Settled<T>,
      empty: T,
    ): T => {
      if (result.ok) return result.value;
      unavailable.push(section);
      return empty;
    };

    const taskLists = valueOf('tasks', tasks, {
      mine: [],
      confirmations: [],
      confirmationsWaiting: 0,
      assigned: [],
    });
    const hoursApprovals = valueOf('hours_approvals', hours, []);
    const pollLists = valueOf('polls', polls, { unvoted: [], mine: [] });
    const comingUp = valueOf('coming_up', events, []);
    const myEvents = valueOf('made_events', madeEvents, []);
    const myLinks = valueOf('links', links, []);

    const needsYouCount =
      taskLists.mine.length +
      taskLists.confirmationsWaiting +
      hoursApprovals.length +
      pollLists.unvoted.length +
      comingUp.filter((event) => event.check_in_open && !event.checked_in)
        .length;

    return this.withUnread(chapterId, userId, {
      needs_you: {
        tasks: taskLists.mine.slice(0, LIST_LIMIT),
        task_confirmations: taskLists.confirmations.slice(0, LIST_LIMIT),
        hours_approvals: hoursApprovals.slice(0, LIST_LIMIT),
        polls: pollLists.unvoted.slice(0, LIST_LIMIT),
      },
      coming_up: comingUp,
      links: myLinks,
      made_by_you: {
        // Capped per state in `readPolls`: 25 open and 25 closed.
        polls: pollLists.mine,
        tasks: taskLists.assigned.slice(0, LIST_LIMIT),
        files: [],
        events: myEvents.slice(0, LIST_LIMIT),
      },
      needs_you_count: needsYouCount,
      unavailable,
      unread_since: null,
    });
  }

  /**
   * Begins the caller's unread dots now, unless they already began. A client
   * that draws dots calls it when `unread_since` is null. Until then nothing
   * could have recorded the caller's opens, so every row they had already
   * seen would otherwise come back as unread (`spec/behavior/activity.md` §
   * Unread).
   */
  async startUnread(chapterId: string, userId: string): Promise<void> {
    await this.readRepo.startUnread(
      chapterId,
      userId,
      new Date().toISOString(),
    );
  }

  /**
   * Records that the caller opened these items from Activity, so their rows
   * read as seen (`spec/behavior/activity.md` § Unread). The read is the
   * caller's own and names no one else, so an id the caller can't see, or
   * one that doesn't exist, is stored and never matters: it is never served.
   */
  async markRead(
    chapterId: string,
    userId: string,
    items: ActivityItemRef[],
  ): Promise<void> {
    // One upsert can't touch a row twice, so a repeated item is sent once.
    const unique = new Map(
      items.map((item) => [`${item.kind}:${item.item_id}`, item]),
    );
    await this.readRepo.markRead(
      chapterId,
      userId,
      [...unique.values()],
      new Date().toISOString(),
    );
  }

  /**
   * Sets `unread` on the rows that wait on the caller: everything in
   * `needs_you`, Coming up and Links, and `unread_since`. A row is unread
   * when it appeared at or after the caller's dots began and they haven't
   * opened it from Activity since. When it appeared is the moment it started
   * waiting on them: a task confirmation from its completion, the caller's
   * own task from when it was assigned or an officer last sent it back,
   * everything else from when its record was made. So a task an officer
   * opened before it was completed is unread again in their confirmations. A
   * row the caller made themselves (a task assigned to themselves, an event
   * they made) is never unread, and nothing in `made_by_you` is. Before the
   * caller's dots begin every row is read.
   *
   * The dots are a hint, not a list: when the caller's opens can't be read
   * every row is served as read, and the failure is reported, rather than
   * failing the page or dotting everything.
   */
  private async withUnread(
    chapterId: string,
    userId: string,
    view: ActivityView,
  ): Promise<ActivityView> {
    let unreadSince: string | null;
    try {
      unreadSince = await this.readRepo.findUnreadStart(chapterId, userId);
    } catch (error) {
      this.reportUnreadFailure(chapterId, error);
      return view;
    }
    if (unreadSince === null) return view;
    const since = new Date(unreadSince).getTime();
    const started: ActivityView = { ...view, unread_since: unreadSince };

    const candidates: {
      kind: ActivityItemKind;
      id: string;
      appearedAt: number;
    }[] = [];
    const consider = (
      kind: ActivityItemKind,
      id: string,
      appearedAt: string | null,
      madeByCaller = false,
    ) => {
      const at = appearedAt ? new Date(appearedAt).getTime() : NaN;
      if (madeByCaller || Number.isNaN(at) || at < since) return;
      candidates.push({ kind, id, appearedAt: at });
    };
    const { needs_you } = view;
    for (const task of needs_you.tasks) {
      consider(
        'task',
        task.id,
        latest(task.created_at, task.sent_back_at),
        // A task for themselves is theirs, until an officer sends it back.
        task.created_by === userId && task.sent_back_at === null,
      );
    }
    for (const task of needs_you.task_confirmations) {
      consider('task', task.id, task.completed_at ?? task.created_at);
    }
    for (const entry of needs_you.hours_approvals) {
      consider('hours_entry', entry.id, entry.created_at);
    }
    for (const poll of needs_you.polls) {
      consider('poll', poll.message_id, poll.created_at);
    }
    for (const event of view.coming_up) {
      consider(
        'event',
        event.id,
        event.created_at,
        event.created_by === userId,
      );
    }
    for (const link of view.links) {
      consider('link', link.id, link.posted_at);
    }
    if (candidates.length === 0) return started;

    let readAt: Map<string, number>;
    try {
      const reads = await this.readRepo.findReads(chapterId, userId, [
        ...new Set(candidates.map((candidate) => candidate.id)),
      ]);
      readAt = new Map(
        reads.map((read) => [
          `${read.kind}:${read.item_id}`,
          new Date(read.read_at).getTime(),
        ]),
      );
    } catch (error) {
      this.reportUnreadFailure(chapterId, error);
      return view;
    }

    const unread = new Set(
      candidates
        .filter(({ kind, id, appearedAt }) => {
          const opened = readAt.get(`${kind}:${id}`);
          return opened === undefined || opened < appearedAt;
        })
        .map(({ kind, id }) => `${kind}:${id}`),
    );
    if (unread.size === 0) return started;
    // New row objects, so a row shared with `made_by_you` (one task in two
    // lists) is never dotted there.
    const mark = <T extends { unread: boolean }>(
      kind: ActivityItemKind,
      rows: T[],
      idOf: (row: T) => string,
    ): T[] =>
      rows.map((row) =>
        unread.has(`${kind}:${idOf(row)}`) ? { ...row, unread: true } : row,
      );
    return {
      ...started,
      needs_you: {
        tasks: mark('task', needs_you.tasks, (row) => row.id),
        task_confirmations: mark(
          'task',
          needs_you.task_confirmations,
          (row) => row.id,
        ),
        hours_approvals: mark(
          'hours_entry',
          needs_you.hours_approvals,
          (row) => row.id,
        ),
        polls: mark('poll', needs_you.polls, (row) => row.message_id),
      },
      coming_up: mark('event', view.coming_up, (row) => row.id),
      links: mark('link', view.links, (row) => row.id),
    };
  }

  private reportUnreadFailure(chapterId: string, error: unknown): void {
    reportCaughtFailure(this.logger, {
      level: 'warning',
      site: 'activity-unread',
      message: `Activity unread state failed for chapter ${chapterId}; serving every row as read`,
      error,
    });
  }

  /**
   * Run one section; a failure is logged and reported, never thrown.
   *
   * At `error` level: the member sees the section named in `unavailable`
   * instead of its rows, the read a 5xx would have reported had it
   * propagated. A broken query behind one section (#4087) otherwise reads
   * as a quiet gap on the page for as long as it stays broken (#4096).
   */
  private async settle<T>(
    section: ActivitySection,
    chapterId: string,
    read: () => Promise<T>,
  ): Promise<Settled<T>> {
    try {
      return { ok: true, value: await read() };
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: `activity-section:${section.replace(/_/g, '-')}`,
        message: `Activity section '${section}' failed for chapter ${chapterId}`,
        error,
      });
      return { ok: false };
    }
  }

  private async readTasks(
    chapterId: string,
    userId: string,
    permissions: string[],
  ): Promise<{
    mine: ActivityTask[];
    confirmations: ActivityTask[];
    /** All of them, not only the 25 read. */
    confirmationsWaiting: number;
    assigned: ActivityTask[];
  }> {
    const canManage = can(SystemPermissions.TASKS_MANAGE, permissions);
    // Each list is its own read, filtered in SQL, so none depends on reading
    // the chapter's whole task history (#4037).
    // Finished tasks waiting on a confirm: the 25 waiting longest, and how
    // many wait in all, for `needs_you_count`. Confirming your own completion
    // is refused (`TaskService.confirmCompletion`, the no-self-award rule), so
    // yours are not offered as waiting on you.
    const waitingFilter = {
      status: TaskStatus.COMPLETED,
      confirmed: false,
      notAssigneeId: userId,
    };
    const [own, waiting, waitingCount, made] = await Promise.all([
      this.taskService.list(chapterId, userId, false, { confirmed: false }),
      canManage
        ? this.taskService.list(chapterId, userId, true, {
            ...waitingFilter,
            order: 'longest_waiting',
            limit: LIST_LIMIT,
          })
        : Promise.resolve([]),
      canManage
        ? this.taskService.count(chapterId, userId, true, waitingFilter)
        : Promise.resolve(0),
      // Only while the caller can still read tasks they don't hold: a creator
      // who has lost `tasks:manage` gets a 403 from `GET /v1/tasks/:id`, and a
      // row that opens to a refusal is worse than no row.
      canManage
        ? this.taskService.list(chapterId, userId, true, {
            createdBy: userId,
            limit: LIST_LIMIT,
          })
        : Promise.resolve([]),
    ]);

    const mine = own
      .filter((task) => task.stored_status !== TaskStatus.COMPLETED)
      // By day, and within a day by time, a task with no time last: it is
      // due by the end of the day.
      .sort(byAscending((task) => `${task.due_date} ${task.due_at ?? '~'}`));
    // Already oldest first from the database.
    const confirmations = waiting;
    const assigned = made.sort(byNewest);

    const names = await this.namesOf(
      [...mine, ...confirmations, ...assigned].flatMap((task) => [
        task.assignee_id,
        task.created_by,
      ]),
    );
    const toRow = (task: TaskView): ActivityTask => ({
      id: task.id,
      title: task.title,
      due_date: task.due_date,
      due_at: task.due_at,
      status: task.status,
      stored_status: task.stored_status,
      assignee_id: task.assignee_id,
      assignee_name: names.get(task.assignee_id) ?? '',
      created_by: task.created_by,
      created_by_name: names.get(task.created_by) ?? '',
      point_reward: task.point_reward,
      completed_at: task.completed_at,
      confirmed_at: task.confirmed_at,
      sent_back_at: task.sent_back_at ?? null,
      created_at: task.created_at,
      unread: false,
    });
    return {
      mine: mine.map(toRow),
      confirmations: confirmations.map(toRow),
      confirmationsWaiting: waitingCount,
      assigned: assigned.map(toRow),
    };
  }

  private async readHoursApprovals(
    chapterId: string,
    userId: string,
  ): Promise<ActivityHoursEntry[]> {
    const pending = await this.serviceEntryService.findByChapterFiltered(
      chapterId,
      { status: 'PENDING' },
    );
    // An approver's own entry is not theirs to approve (`ServiceEntryService.approve`).
    const theirs = pending
      .filter((entry: ServiceEntry) => entry.user_id !== userId)
      .sort(byAscending((entry) => entry.created_at));
    const names = await this.namesOf(theirs.map((entry) => entry.user_id));
    return theirs.map((entry) => ({
      id: entry.id,
      user_id: entry.user_id,
      member_name: names.get(entry.user_id) ?? '',
      date: entry.date,
      duration_minutes: entry.duration_minutes,
      description: entry.description,
      created_at: entry.created_at,
      unread: false,
    }));
  }

  private async readPolls(
    chapterId: string,
    userId: string,
    now: number,
    chatReads: () => Promise<ChatReads>,
  ): Promise<{ unvoted: ActivityPoll[]; mine: ActivityPoll[] }> {
    // The channel list is the access rule: `getChannels` is what chat itself
    // shows this caller, filtered through `ChannelAccessService`. A poll in a
    // channel that is not in it is never listed, whoever posted it; that
    // includes the caller's own poll in a channel they have since lost.
    //
    // The block list is read here and not defended against: "a block list
    // that cannot be read is not an empty block list", so a failure fails the
    // section (served empty and named `unavailable`) rather than listing a
    // blocked member's question.
    const [{ channels, blockedUserIds }, recent, own] = await Promise.all([
      chatReads(),
      this.messageRepo.findPollCardsByChapter(chapterId, {
        limit: POLL_SCAN_LIMIT,
      }),
      this.messageRepo.findPollCardsByChapter(chapterId, {
        senderId: userId,
        // Wider than the list: the open and closed lists are cut apart below,
        // so closed polls can't crowd an open one out of the read.
        limit: POLL_SCAN_LIMIT,
      }),
    ]);
    const nowDate = new Date(now);
    // No deadline sorts last: it is the least pressing.
    const closesAtMs = (row: ActivityPoll) =>
      row.closes_at ? new Date(row.closes_at).getTime() : Number.MAX_VALUE;
    const channelById = new Map(
      channels.map((channel) => [channel.id, channel]),
    );
    const blocked = new Set(blockedUserIds);

    const readable = (message: ChatMessage) =>
      channelById.has(message.channel_id);
    const openOthers = recent.filter((message) => {
      if (!readable(message) || message.sender_id === userId) return false;
      if (message.sender_id && blocked.has(message.sender_id)) return false;
      const card = readPollCard(message);
      return !!card && !pollCardClosed(card, nowDate);
    });
    const mine = own.filter(readable);

    // A vote row with no picks is a cleared vote, not a vote: a member who
    // clears every pick on a multi-choice card keeps the row with an empty
    // list (#3793), and the poll goes back to needing them.
    const voteRows = await this.actionRepo.findActionsOnMessages(
      [...openOthers, ...mine].map((message) => message.id),
      userId,
      CARD_VOTE_ACTION_TYPE,
    );
    const votedIds = new Set(
      voteRows
        .filter((row) => cardVoteSelection(row.payload ?? undefined).length > 0)
        .map((row) => row.message_id),
    );

    const toRow = (message: ChatMessage): ActivityPoll | null => {
      const card = readPollCard(message);
      const channel = channelById.get(message.channel_id);
      if (!card || !channel) return null;
      return {
        message_id: message.id,
        channel_id: message.channel_id,
        channel_name: channel.name,
        channel_type: channel.type,
        sender_id: message.sender_id,
        question: card.question,
        option_count: card.option_count,
        closes_at: card.closes_at,
        closed_at: card.closed_at,
        is_closed: pollCardClosed(card, nowDate),
        has_voted: votedIds.has(message.id),
        created_at: message.created_at,
        unread: false,
        // Through the mask every chat read uses, with the block list read
        // above. A blocked author's poll never reaches this line; the mask is
        // what gives the row chat's own shape (`sender_blocked` set).
        message: maskBlockedMessages([message], blocked)[0],
      };
    };
    const rowsOf = (messages: ChatMessage[]): ActivityPoll[] =>
      messages.map(toRow).filter((row): row is ActivityPoll => row !== null);

    return {
      unvoted: rowsOf(openOthers)
        .filter((row) => !row.has_voted)
        .sort((a, b) => closesAtMs(a) - closesAtMs(b)),
      // Newest first, as read: the open ones, then the closed, 25 of each.
      mine: [
        ...rowsOf(mine)
          .filter((row) => !row.is_closed)
          .slice(0, LIST_LIMIT),
        ...rowsOf(mine)
          .filter((row) => row.is_closed)
          .slice(0, LIST_LIMIT),
      ].sort(byNewest),
    };
  }

  private async readComingUp(
    chapterId: string,
    userId: string,
    now: number,
    viewer: () => Promise<EventViewer>,
  ): Promise<ActivityEvent[]> {
    const horizon = now + COMING_UP_WINDOW_MS;
    // With the viewer, always: the row carries the event's name and location,
    // so a chapter-wide read would republish an event that leaves this member
    // out (`spec/behavior/events.md` § Attendance by role). Bounded to the
    // window in SQL, with a day's margin behind for the check-in grace, so
    // the chapter's whole event history is not read to keep ten rows.
    const events = await this.eventService.findByChapter(chapterId, userId, {
      endsAfter: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      startsBefore: new Date(horizon).toISOString(),
    });
    return this.toEventRows(userId, now, events, viewer, {
      startsBefore: horizon,
      limit: COMING_UP_LIMIT,
    });
  }

  /**
   * Events the caller made whose check-in has not closed, soonest first, with
   * a recurring series folded to its next meeting: a weekly meeting is one
   * thing they made, not fifteen rows.
   */
  private async readMadeEvents(
    chapterId: string,
    userId: string,
    now: number,
    viewer: () => Promise<EventViewer>,
  ): Promise<ActivityEvent[]> {
    // From the check-in grace behind now, so an event stays here for as long
    // as it stays in Coming up: its maker opens it to take attendance just
    // after it ends.
    const events = await this.eventService.findCreatedBy(
      chapterId,
      userId,
      new Date(now - CHECK_IN_GRACE_MINUTES * 60 * 1000).toISOString(),
      MADE_EVENTS_SCAN_LIMIT,
    );
    const seenSeries = new Set<string>();
    const nextOfEach = events.filter((event) => {
      const series = event.parent_event_id ?? event.id;
      if (seenSeries.has(series)) return false;
      seenSeries.add(series);
      return true;
    });
    return this.toEventRows(userId, now, nextOfEach, viewer, {
      startsBefore: Number.POSITIVE_INFINITY,
      limit: LIST_LIMIT,
    });
  }

  /**
   * Events as this member's rows: what the event asks of them, and whether
   * they can check in now. Keeps events that invite the member, whose
   * check-in has not closed and that start before `startsBefore`, soonest
   * first, at most `limit`.
   *
   * Only events that invite them, in both sections. The event reads exempt an
   * `events:update` holder from the role gate so they can find any event to
   * edit it; that is not an invitation. And a row opens chat's event card,
   * which offers Check in from the event's times alone, so an event that
   * leaves the member out would offer a check-in the server refuses.
   */
  private async toEventRows(
    userId: string,
    now: number,
    events: Event[],
    viewer: () => Promise<EventViewer>,
    options: { startsBefore: number; limit: number },
  ): Promise<ActivityEvent[]> {
    if (events.length === 0) return [];
    const { roleIds, isAlumni } = await viewer();

    const kept = events
      .map((event) => ({
        event,
        window: this.checkInWindowOf(event),
        answer: attendanceFor(event, roleIds),
      }))
      .filter(
        ({ event, window, answer }) =>
          answer.status !== 'not_invited' &&
          window !== null &&
          window.closesAt > now &&
          new Date(event.start_time).getTime() <= options.startsBefore,
      )
      .sort(
        (a, b) =>
          new Date(a.event.start_time).getTime() -
          new Date(b.event.start_time).getTime(),
      )
      .slice(0, options.limit);

    return Promise.all(
      kept.map(async ({ event, window, answer }): Promise<ActivityEvent> => {
        // `AttendanceService.checkIn` refuses an alumnus unless a role of
        // theirs is listed on the event (`spec/behavior/alumni.md`), and the
        // absence sweep never holds them to the default. So for them the
        // event is optional and is not something to check in to.
        const alumniByDefault = isAlumni && !answer.byRole;
        const checkInOpen =
          window !== null && window.opensAt <= now && !alumniByDefault;
        return {
          id: event.id,
          name: event.name,
          location: event.location,
          start_time: event.start_time,
          end_time: event.end_time,
          attendance:
            answer.status === 'required' && !alumniByDefault
              ? 'required'
              : 'optional',
          point_value: event.point_value,
          check_in_opens_minutes: event.check_in_opens_minutes,
          check_in_open: checkInOpen,
          // Only for an event the member can check in to right now, which
          // is rarely more than one: the answer is what decides whether it
          // still needs them.
          checked_in: checkInOpen
            ? await this.hasCheckedIn(event.id, userId)
            : null,
          created_by: event.created_by,
          created_at: event.created_at,
          // Set for Coming up once the caller's reads are in
          // (`withUnread`); an event in Made by you is never unread.
          unread: false,
        };
      }),
    );
  }

  /** The event's check-in window in epoch ms, or `null` when its times don't parse. */
  private checkInWindowOf(
    event: Event,
  ): { opensAt: number; closesAt: number } | null {
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }
    const { opensAt, closesAt } = checkInWindowBounds(
      start,
      end,
      event.check_in_opens_minutes,
    );
    return { opensAt: opensAt.getTime(), closesAt: closesAt.getTime() };
  }

  /**
   * `null` when the read fails: the event still lists, and it counts as
   * needing the member, which a failed read cannot rule out.
   */
  private async hasCheckedIn(
    eventId: string,
    userId: string,
  ): Promise<boolean | null> {
    try {
      // The row itself, not `AttendanceService.getMyAttendance`: that one
      // re-reads the event and its visibility, which the list read above has
      // just settled for this member.
      const attendance = await this.attendanceRepo.findByEventAndUser(
        eventId,
        userId,
      );
      return attendance !== null;
    } catch (error) {
      // Per event, and the event still lists: a best-effort step the page
      // absorbs, so `warning`.
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'activity-attendance-read',
        message: `Activity could not read attendance for event ${eventId}`,
        error,
      });
      return null;
    }
  }

  /** Display names by user id. An id with no user row is simply absent. */
  private namesOf(userIds: string[]): Promise<Map<string, string>> {
    return displayNamesById(this.userRepo, userIds);
  }
}
