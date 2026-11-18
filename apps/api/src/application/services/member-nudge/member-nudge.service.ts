import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  MEMBER_NUDGE_FEWER_QUIET_DAYS,
  MEMBER_NUDGE_TRAY_MAX,
  isMemberNudgeTaskKind,
  type MemberNudgeKind,
  isModuleEnabled,
  type MemberNudgeDismissReason,
} from '@repo/validation';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import type { MemberNudge } from '#domain/entities/member-nudge.entity';
import { TaskStatus, type Task } from '#domain/entities/task.entity';
import {
  CHAPTER_REPOSITORY,
  type IChapterRepository,
} from '#domain/repositories/chapter.repository.interface';
import {
  MEMBER_NUDGE_REPOSITORY,
  type IMemberNudgeRepository,
  type MemberNudgeDraft,
} from '#domain/repositories/member-nudge.repository.interface';
import {
  MEMBER_NUDGE_ITEM_PROMPT_VERSION,
  NudgeLineSchema,
  checkNudgeLine,
  isWrittenItem,
  nudgeLineMessages,
  nudgeLineSystem,
  orderNudgeItems,
  taskItem,
  type NudgeItem,
  type NudgeTargetType,
} from '#domain/utils/member-nudge-items';
import {
  TASK_REPOSITORY,
  type ITaskRepository,
} from '#domain/repositories/task.repository.interface';
import {
  USER_REPOSITORY,
  type IUserRepository,
} from '#domain/repositories/user.repository.interface';
import {
  MEMBER_NUDGE_PROMPT_VERSION,
  NUDGE_BUDGET_WINDOW_MS,
  NUDGE_HISTORY_MS,
  NUDGE_PRAISE_WINDOW_MS,
  NudgeOutputSchema,
  buildNudgeFacts,
  checkNudgeWords,
  fixedNudgeWords,
  nudgeBudget,
  nudgeExpiry,
  nudgeHistory,
  nudgeMessages,
  nudgeSystem,
  pickNudge,
  showingNudgeFate,
  type NudgeCandidate,
  type NudgeOutput,
  type NudgeWords,
} from '#domain/utils/member-nudge';
import { reportCaughtFailure } from '../../../infrastructure/observability/report-caught-failure';
import { AiConsentService } from '../ai/ai-consent.service';
import { AiGatewayService } from '../ai/ai-gateway.service';

const TASK = 'nudges.write';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
/** The most finished tasks read for "how this went before". */
const HISTORY_LIMIT = 400;

export interface MemberNudgeInput {
  /** From `ChapterGuard`. Never from the request body or a model. */
  chapterId: string;
  /** The member, from the auth guard. A card is only ever their own. */
  userId: string;
  /** The member's IANA time zone, for "today" and the due day. */
  timeZone: string;
  signal?: AbortSignal;
}

/** A card as the clients draw it. */
export interface MemberNudgeView {
  id: string;
  kind: string;
  title: string;
  body: string;
  start_here: string | null;
  task_id: string;
  /** The task's own title, for the "Ask about this" question. */
  task_title: string;
  /** False while the member has not had it on screen. */
  seen: boolean;
  created_at: string;
}

export interface MemberNudgeCardInput extends MemberNudgeInput {
  /**
   * Everything else that waits on the member, from Activity's own reads
   * (`ActivityCardService`). Each is already the member's to see.
   */
  items: readonly NudgeItem[];
  /** The chapter has Tasks on: the member's own task cards are in the pick. */
  tasksOn: boolean;
}

/** One card, or one tray item, as the clients draw it (#5464). */
export interface MemberNudgeCardView {
  /** The showing card's id; null for a tray item, which has no row. */
  id: string | null;
  kind: string;
  subject_key: string;
  headline: string;
  meta: string;
  urgent: boolean;
  chip: string;
  action: string;
  target_type: NudgeTargetType;
  target_id: string | null;
  channel_id: string | null;
  task_id: string | null;
  /** The one sentence AI wrote, or null on a plain card. */
  line: string | null;
  /** A task card's suggested place to start, when AI wrote one. */
  start_here: string | null;
  seen: boolean;
}

export interface MemberNudgeCardResult {
  card: MemberNudgeCardView | null;
  tray: MemberNudgeCardView[];
}

export interface MemberNudgeSettingsView {
  enabled: boolean;
}

function firstName(displayName: string | undefined): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  // "Deleted User", an email used as a name: say no name instead.
  return /^[\p{L}'-]{2,30}$/u.test(first) ? first : '';
}

/**
 * Member nudges (#4781, `spec/behavior/ai.md` § Nudges): the one card on a
 * member's Activity, written by the AI about one of their own tasks.
 *
 * Nothing here is scheduled and nothing is pushed. The card is worked out
 * when the member opens Activity, for that member, about their own tasks:
 *
 * 1. **AI is on for them.** The chapter's nudges switch (its own, on unless
 *    the president turns it off; Ask's switch until 2026-11-17) and the
 *    member's own yes. Off: no card, and nothing is read.
 * 2. **A card already showing is checked against the task as it is now.**
 *    Done, handed to someone else, or out of date: it is closed and its
 *    words deleted. Still true: it is the answer, and no model is called.
 * 3. **Code decides whether to speak** (`member-nudge.ts`): the member's
 *    switch and quiet stretch, at most one card at a time, a gap between
 *    cards, a weekly limit, and each task raised once per kind.
 * 4. **The facts.** The task, its steps, the officer's note if it was sent
 *    back, and how tasks like it went before, as counts and days. No other
 *    member is named or described.
 * 5. **The model writes, the code checks.** One structured call as the
 *    member. Words that fail a check, or a model that cannot be reached, get
 *    Frapp's fixed sentence, so the member never waits on a card or reads
 *    one that is wrong.
 *
 * No task title, name or card text is logged.
 */
@Injectable()
export class MemberNudgeService implements OnModuleInit {
  private readonly logger = new Logger(MemberNudgeService.name);

  constructor(
    @Inject(MEMBER_NUDGE_REPOSITORY)
    private readonly nudges: IMemberNudgeRepository,
    @Inject(TASK_REPOSITORY)
    private readonly tasks: Pick<
      ITaskRepository,
      'findById' | 'findByChapter' | 'findSubtasks'
    >,
    @Inject(USER_REPOSITORY)
    private readonly users: Pick<IUserRepository, 'findDisplayIdentitiesByIds'>,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapters: Pick<IChapterRepository, 'findById'>,
    private readonly consent: AiConsentService,
    private readonly gateway: AiGatewayService,
  ) {}

  onModuleInit(): void {
    // A No on the AI sheet takes the member's cards with it; deleting an
    // account does the same in `anonymize_user`.
    this.consent.onConsentWithdrawn(async (userId) => {
      await this.nudges.deleteByUser(userId);
    });
  }

  /** The member's card right now, writing a new one when one is due. */
  async current(
    input: MemberNudgeInput,
    now: Date = new Date(),
  ): Promise<MemberNudgeView | null> {
    const { chapterId, userId } = input;

    // 1.
    const entry = aiCatalogEntry(TASK);
    const decision = await this.consent.check({
      chapterId,
      actingUserId: userId,
      task: TASK,
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: MEMBER_NUDGE_PROMPT_VERSION,
    });
    const chapter = decision.allowed
      ? await this.chapters.findById(chapterId)
      : null;
    const modules = chapter?.enabled_modules;
    // A card nobody came back to: its time passed, so its words go, for
    // every member of the chapter, whoever opens Activity next.
    await this.nudges.closeExpired(chapterId, now.toISOString());
    if (!chapter || (modules && !isModuleEnabled(modules, 'tasks'))) {
      // AI or Tasks went off since the card was written: it is not shown
      // again, so its words are not kept either.
      const stale = await this.nudges.findShowing(chapterId, userId);
      // Only a task card: the widened card (`card`) shows without AI.
      if (stale && isMemberNudgeTaskKind(stale.kind)) {
        await this.nudges.close(chapterId, userId, stale.id, {
          status: 'expired',
          closed_at: now.toISOString(),
        });
      }
      return null;
    }

    // 2.
    const settings = await this.nudges.findSettings(chapterId, userId);
    const enabled = settings?.enabled ?? true;
    const showing = await this.nudges.findShowing(chapterId, userId);
    // The widened card (`card`, #5464) is showing something that isn't a
    // task: a phone build from before it has nothing to draw it with.
    if (showing && (!isMemberNudgeTaskKind(showing.kind) || !showing.task_id)) {
      return null;
    }
    if (showing?.task_id) {
      const task = await this.tasks.findById(showing.task_id, chapterId);
      const fate = enabled ? showingNudgeFate(showing, task, now) : 'expired';
      if (fate === 'keep' && task) return this.view(showing, task);
      await this.nudges.close(chapterId, userId, showing.id, {
        status: fate === 'done' ? 'done' : 'expired',
        closed_at: now.toISOString(),
      });
      // On to the next one, if the limits allow: a member who just finished
      // the task a card was about may be due a word of thanks.
    }

    // 3.
    const recent = await this.nudges.findRecent(
      chapterId,
      userId,
      new Date(now.getTime() - NUDGE_BUDGET_WINDOW_MS).toISOString(),
    );
    const budget = nudgeBudget({
      now,
      enabled,
      quietUntil: settings?.quiet_until ?? null,
      recent: recent.filter((row) => isMemberNudgeTaskKind(row.kind)),
    });
    if (!budget.push && !budget.praise) return null;
    const [open, raised] = await Promise.all([
      this.ownTasks(chapterId, userId, now),
      this.nudges.findRaised(chapterId, userId),
    ]);
    const candidate = pickNudge({
      now,
      tasks: open,
      raised,
      budget,
      recent: recent.filter((row) => isMemberNudgeTaskKind(row.kind)),
    });
    if (!candidate) return null;

    // 4. and 5.
    const written = await this.write(input, candidate, now);
    if (!written) return null;
    const created = await this.nudges.create({
      chapter_id: chapterId,
      user_id: userId,
      kind: candidate.kind,
      task_id: candidate.task.id,
      subject_key: candidate.task.id,
      title: written.words.title,
      body: written.words.body,
      start_here: written.words.start_here,
      written_by: written.by,
      expires_at: nudgeExpiry(candidate, now),
    });
    if (created) return this.view(created, candidate.task);
    // Another device's check got there first: show its card, not a second.
    const theirs = await this.nudges.findShowing(chapterId, userId);
    if (!theirs?.task_id || !isMemberNudgeTaskKind(theirs.kind)) return null;
    const task = await this.tasks.findById(theirs.task_id, chapterId);
    return task ? this.view(theirs, task) : null;
  }

  /**
   * The widened card (#5464, `spec/behavior/ai.md` § Nudges): the one most
   * useful thing waiting on the member, from `items` (built by the caller
   * from Activity's own reads) and their own tasks, and a tray of the next
   * few. It shows whether or not AI is available: without it, the card is
   * the thing's own name, time and button, with no generated words.
   *
   * 1. **The member's own switch.** Off: no card, and nothing is read.
   * 2. **A showing task card** is checked against its task, as `current`
   *    does. A task card is still paced by #4781's limits; nothing else is
   *    (Paul, 2026-11-18): an event, a mention or a sign-up shows whenever it
   *    is true, and leaves when its moment passes.
   * 3. **The pick** (`orderNudgeItems`): the most useful item the member
   *    hasn't waved off. A showing card that something more useful has
   *    overtaken is deleted, not closed, so it can come back.
   * 4. **The words.** A new card is written once, when it is raised: a task
   *    card by `write`, any other by one sentence (`writeLine`) where its
   *    kind has one. AI off for this member, or the server: plain.
   */
  async card(
    input: MemberNudgeCardInput,
    now: Date = new Date(),
  ): Promise<MemberNudgeCardResult> {
    const { chapterId, userId, timeZone } = input;
    const none: MemberNudgeCardResult = { card: null, tray: [] };

    // 1.
    const settings = await this.nudges.findSettings(chapterId, userId);
    if (settings && !settings.enabled) return none;
    await this.nudges.closeExpired(chapterId, now.toISOString());
    const entry = aiCatalogEntry(TASK);
    const decision = await this.consent.check({
      chapterId,
      actingUserId: userId,
      task: TASK,
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: MEMBER_NUDGE_PROMPT_VERSION,
    });
    const aiOn = decision.allowed;

    // 2.
    let showing = await this.nudges.findShowing(chapterId, userId);
    let taskEntry: {
      item: NudgeItem;
      task: Task;
      candidate: NudgeCandidate | null;
    } | null = null;
    if (showing && isMemberNudgeTaskKind(showing.kind)) {
      const task =
        input.tasksOn && showing.task_id
          ? await this.tasks.findById(showing.task_id, chapterId)
          : null;
      const fate = task ? showingNudgeFate(showing, task, now) : 'expired';
      if (fate === 'keep' && task) {
        taskEntry = {
          item: taskItem(showing.kind, task, now, timeZone, showing.expires_at),
          task,
          candidate: null,
        };
      } else {
        await this.nudges.close(chapterId, userId, showing.id, {
          status: fate === 'done' ? 'done' : 'expired',
          closed_at: now.toISOString(),
        });
        showing = null;
      }
    }
    const raisedRead = this.nudges.findRaised(chapterId, userId);
    if (!taskEntry && input.tasksOn) {
      const recent = (
        await this.nudges.findRecent(
          chapterId,
          userId,
          new Date(now.getTime() - NUDGE_BUDGET_WINDOW_MS).toISOString(),
        )
      ).filter((row) => isMemberNudgeTaskKind(row.kind));
      const budget = nudgeBudget({
        now,
        enabled: true,
        quietUntil: settings?.quiet_until ?? null,
        recent,
      });
      if (budget.push || budget.praise) {
        const [open, raised] = await Promise.all([
          this.ownTasks(chapterId, userId, now),
          raisedRead,
        ]);
        const candidate = pickNudge({
          now,
          tasks: open,
          raised,
          budget,
          recent,
        });
        if (candidate) {
          taskEntry = {
            item: taskItem(
              candidate.kind,
              candidate.task,
              now,
              timeZone,
              nudgeExpiry(candidate, now),
            ),
            task: candidate.task,
            candidate,
          };
        }
      }
    }

    // 3.
    const ordered = orderNudgeItems(
      taskEntry ? [...input.items, taskEntry.item] : input.items,
      await raisedRead,
    );
    const top = ordered[0];
    const tray = ordered
      .slice(1, 1 + MEMBER_NUDGE_TRAY_MAX)
      .map((item) => this.itemView(item, null));
    if (
      showing &&
      (!top ||
        showing.kind !== top.kind ||
        showing.subject_key !== top.subjectKey)
    ) {
      await this.nudges.deleteShowing(chapterId, userId, showing.id);
      showing = null;
    }
    if (!top) return none;
    if (showing) return { card: this.itemView(top, showing), tray };

    // 4.
    const draft = await this.draftFor(input, top, taskEntry, aiOn, now);
    if (input.signal?.aborted) return none;
    const created = await this.nudges.create(draft);
    if (created) return { card: this.itemView(top, created), tray };
    // Another device raised it first: show theirs if it is this one.
    const theirs = await this.nudges.findShowing(chapterId, userId);
    return {
      card: this.itemView(
        top,
        theirs?.kind === top.kind && theirs.subject_key === top.subjectKey
          ? theirs
          : null,
      ),
      tray,
    };
  }

  /**
   * The member waved this off, from the card or its tray: it is not raised
   * again. Only the member's own, and only kinds this card knows.
   */
  async dismissSubject(
    chapterId: string,
    userId: string,
    subject: { kind: MemberNudgeKind; subject_key: string },
    now: Date = new Date(),
  ): Promise<void> {
    let taskId: string | null = null;
    if (isMemberNudgeTaskKind(subject.kind)) {
      // A task card names a task of the member's own in this chapter; any
      // other id is nothing to record, and saying so would tell the caller
      // which ids exist.
      if (!UUID.test(subject.subject_key)) return;
      const task = await this.tasks.findById(subject.subject_key, chapterId);
      if (!task || task.assignee_id !== userId) return;
      taskId = task.id;
    }
    await this.nudges.dismissSubject(
      chapterId,
      userId,
      { kind: subject.kind, subject_key: subject.subject_key, task_id: taskId },
      now.toISOString(),
    );
  }

  private async draftFor(
    input: MemberNudgeCardInput,
    item: NudgeItem,
    taskEntry: { task: Task; candidate: NudgeCandidate | null } | null,
    aiOn: boolean,
    now: Date,
  ): Promise<MemberNudgeDraft> {
    const base = {
      chapter_id: input.chapterId,
      user_id: input.userId,
      kind: item.kind,
      task_id: item.taskId,
      subject_key: item.subjectKey,
      expires_at: item.expiresAt,
    };
    if (isMemberNudgeTaskKind(item.kind) && taskEntry) {
      const candidate = taskEntry.candidate ?? {
        kind: item.kind,
        task: taskEntry.task,
      };
      const written = aiOn ? await this.write(input, candidate, now) : null;
      if (written) {
        return {
          ...base,
          title: written.words.title,
          body: written.words.body,
          start_here: written.words.start_here,
          written_by: written.by,
        };
      }
      return {
        ...base,
        title: item.headline,
        body: null,
        start_here: null,
        written_by: 'plain',
      };
    }
    const line =
      aiOn && isWrittenItem(item)
        ? await this.writeLine(input, item, now)
        : null;
    return {
      ...base,
      title: item.headline,
      body: line,
      start_here: null,
      written_by: line === null ? 'plain' : 'ai',
    };
  }

  /**
   * One sentence for a card that isn't a task's, from the item's facts. Null
   * whenever there is nothing safe to show: the model off, unreachable,
   * refusing, or its sentence failing a check. The card is then plain.
   */
  private async writeLine(
    input: MemberNudgeCardInput,
    item: NudgeItem,
    now: Date,
  ): Promise<string | null> {
    if (!item.facts) return null;
    const today = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: input.timeZone,
    }).format(now);
    try {
      const generated = await this.gateway.generateObject(
        TASK,
        {
          promptVersion: MEMBER_NUDGE_ITEM_PROMPT_VERSION,
          system: nudgeLineSystem(item.kind, today),
          messages: nudgeLineMessages(item.facts),
          schema: NudgeLineSchema,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        { chapterId: input.chapterId, actingUserId: input.userId },
      );
      if (generated.status !== 'ok') return null;
      const line = checkNudgeLine(generated.value, item.facts, today);
      if (line === null) {
        this.logger.warn(`nudge line failed a check (kind ${item.kind})`);
      }
      return line;
    } catch (error) {
      if (input.signal?.aborted) return null;
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'member-nudge-line',
        message: 'Member nudge: the model call failed; card left plain',
        error,
      });
      return null;
    }
  }

  /**
   * A card as the clients draw it. Generated words are shown only when the
   * model wrote them (`ai`); Frapp's fixed sentence for a task card is left
   * off, since the card's name, time and button already say it.
   */
  private itemView(
    item: NudgeItem,
    row: MemberNudge | null,
  ): MemberNudgeCardView {
    const ai = row?.written_by === 'ai';
    return {
      id: row?.id ?? null,
      kind: item.kind,
      subject_key: item.subjectKey,
      headline: item.headline,
      meta: item.meta,
      urgent: item.urgent,
      chip: item.chip,
      action: item.action,
      target_type: item.target.type,
      target_id: item.target.id,
      channel_id: item.target.channelId,
      task_id: item.taskId,
      line: ai ? row.body : null,
      start_here: ai ? row.start_here : null,
      seen: row?.seen_at != null,
    };
  }

  /** The card was on the member's screen. */
  async seen(chapterId: string, userId: string, id: string): Promise<void> {
    await this.nudges.markSeen(chapterId, userId, id, new Date().toISOString());
  }

  /** The member closed the card. "Fewer like this" also starts a quiet stretch. */
  async dismiss(
    chapterId: string,
    userId: string,
    id: string,
    reason: MemberNudgeDismissReason,
    now: Date = new Date(),
  ): Promise<void> {
    const closed = await this.nudges.close(chapterId, userId, id, {
      status: 'dismissed',
      dismiss_reason: reason,
      closed_at: now.toISOString(),
    });
    if (!closed) {
      // Another chapter's card, another member's, or one already closed:
      // all the same to the caller, and none says which.
      throw new NotFoundException('That card is no longer showing.');
    }
    if (reason === 'fewer') {
      await this.nudges.saveSettings(
        chapterId,
        userId,
        {
          quiet_until: new Date(
            now.getTime() + MEMBER_NUDGE_FEWER_QUIET_DAYS * DAY_MS,
          ).toISOString(),
        },
        now.toISOString(),
      );
    }
  }

  async settings(
    chapterId: string,
    userId: string,
  ): Promise<MemberNudgeSettingsView> {
    const settings = await this.nudges.findSettings(chapterId, userId);
    return { enabled: settings?.enabled ?? true };
  }

  /** The member's own switch. Off closes the card that is showing. */
  async setEnabled(
    chapterId: string,
    userId: string,
    enabled: boolean,
    now: Date = new Date(),
  ): Promise<MemberNudgeSettingsView> {
    const saved = await this.nudges.saveSettings(
      chapterId,
      userId,
      // Turning them back on is asking for them: the quiet stretch ends.
      enabled ? { enabled, quiet_until: null } : { enabled },
      now.toISOString(),
    );
    if (!enabled) {
      const showing = await this.nudges.findShowing(chapterId, userId);
      if (showing) {
        await this.nudges.close(chapterId, userId, showing.id, {
          status: 'expired',
          closed_at: now.toISOString(),
        });
      }
    }
    return { enabled: saved.enabled };
  }

  /** The member's open tasks, and the ones they finished in the last days. */
  private async ownTasks(
    chapterId: string,
    userId: string,
    now: Date,
  ): Promise<Task[]> {
    const lists = await Promise.all([
      this.tasks.findByChapter(chapterId, {
        assigneeId: userId,
        status: TaskStatus.TODO,
      }),
      this.tasks.findByChapter(chapterId, {
        assigneeId: userId,
        status: TaskStatus.IN_PROGRESS,
      }),
      this.tasks.findByChapter(chapterId, {
        assigneeId: userId,
        status: TaskStatus.COMPLETED,
        completedSince: new Date(
          now.getTime() - NUDGE_PRAISE_WINDOW_MS,
        ).toISOString(),
      }),
    ]);
    return lists.flat();
  }

  /**
   * The card's words. Null only when AI turned out to be off for this
   * member after all (the gateway checks consent again), in which case no
   * card is shown.
   */
  private async write(
    input: MemberNudgeInput,
    candidate: NudgeCandidate,
    now: Date,
  ): Promise<{ words: NudgeWords; by: MemberNudge['written_by'] } | null> {
    const { chapterId, userId } = input;
    const completedSince = new Date(
      now.getTime() - NUDGE_HISTORY_MS,
    ).toISOString();
    const [identities, subtasks, finished, own, askOn] = await Promise.all([
      this.users.findDisplayIdentitiesByIds([userId]),
      this.tasks.findSubtasks(chapterId, [candidate.task.id]),
      this.tasks.findByChapter(chapterId, {
        status: TaskStatus.COMPLETED,
        completedSince,
        limit: HISTORY_LIMIT,
      }),
      // The member's own record, read on its own so a busy chapter's cap
      // does not cut it short.
      this.tasks.findByChapter(chapterId, {
        assigneeId: userId,
        status: TaskStatus.COMPLETED,
        completedSince,
        limit: HISTORY_LIMIT,
      }),
      // Words others wrote on the task go to the model only where the
      // president turned Ask on; nudges alone are on by default.
      this.consent.chapterSwitchOn(chapterId, 'ask'),
    ]);
    const facts = buildNudgeFacts({
      candidate,
      firstName: firstName(identities[0]?.display_name),
      subtasks,
      history: nudgeHistory({ task: candidate.task, userId, finished, own }),
      timeZone: input.timeZone,
      now,
      othersWords: askOn,
    });

    let generated: Awaited<
      ReturnType<typeof this.gateway.generateObject<NudgeOutput>>
    >;
    try {
      generated = await this.gateway.generateObject(
        TASK,
        {
          promptVersion: MEMBER_NUDGE_PROMPT_VERSION,
          system: nudgeSystem(facts),
          messages: nudgeMessages(facts),
          schema: NudgeOutputSchema,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        { chapterId, actingUserId: userId },
      );
    } catch (error) {
      // The member left the page: nothing to write, and nothing to report.
      if (input.signal?.aborted) return null;
      // A provider outage or a timeout. The card does not wait on it.
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'member-nudge-write',
        message: 'Member nudge: the model call failed; fixed sentence used',
        // A provider or network error; neither carries the facts.
        error,
      });
      return { words: fixedNudgeWords(facts), by: 'fixed' };
    }
    if (generated.status === 'ok') {
      const words = checkNudgeWords(generated.value, facts);
      if (words) return { words, by: 'ai' };
      // Counted, never quoted: how often the model's words are replaced is
      // the number that says whether the prompt needs work.
      this.logger.warn(`nudge words failed a check (kind ${candidate.kind})`);
      return { words: fixedNudgeWords(facts), by: 'fixed' };
    }
    if (
      generated.status === 'unavailable' &&
      generated.reason !== 'spend_cap'
    ) {
      // AI is off on this server or for this member: no card at all.
      return null;
    }
    // A cap reached, a refusal, or an answer that was not a card: the fixed
    // sentence costs nothing and is still true.
    return { words: fixedNudgeWords(facts), by: 'fixed' };
  }

  private view(nudge: MemberNudge, task: Task): MemberNudgeView | null {
    if (nudge.title === null || nudge.body === null || !nudge.task_id) {
      return null;
    }
    return {
      id: nudge.id,
      kind: nudge.kind,
      title: nudge.title,
      body: nudge.body,
      start_here: nudge.start_here,
      task_id: nudge.task_id,
      task_title: task.title,
      seen: nudge.seen_at !== null,
      created_at: nudge.created_at,
    };
  }
}
