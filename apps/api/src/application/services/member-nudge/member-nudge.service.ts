import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  MEMBER_NUDGE_FEWER_QUIET_DAYS,
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
} from '#domain/repositories/member-nudge.repository.interface';
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
 * 1. **AI is on for them.** The president's Ask switch and the member's own
 *    yes, the same check Ask makes. Off: no card, and nothing is read.
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
    if (!decision.allowed) return null;
    const chapter = await this.chapters.findById(chapterId);
    const modules = chapter?.enabled_modules;
    if (!chapter || (modules && !isModuleEnabled(modules, 'tasks'))) {
      return null;
    }

    // 2.
    const settings = await this.nudges.findSettings(chapterId, userId);
    const enabled = settings?.enabled ?? true;
    const showing = await this.nudges.findShowing(chapterId, userId);
    if (showing) {
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
      recent,
    });
    if (!budget.push && !budget.praise) return null;
    const [open, raised] = await Promise.all([
      this.ownTasks(chapterId, userId, now),
      this.nudges.findRaised(chapterId, userId),
    ]);
    const candidate = pickNudge({ now, tasks: open, raised, budget, recent });
    if (!candidate) return null;

    // 4. and 5.
    const written = await this.write(input, candidate, now);
    if (!written) return null;
    const created = await this.nudges.create({
      chapter_id: chapterId,
      user_id: userId,
      kind: candidate.kind,
      task_id: candidate.task.id,
      title: written.words.title,
      body: written.words.body,
      start_here: written.words.start_here,
      written_by: written.by,
      expires_at: nudgeExpiry(candidate, now),
    });
    if (created) return this.view(created, candidate.task);
    // Another device's check got there first: show its card, not a second.
    const theirs = await this.nudges.findShowing(chapterId, userId);
    if (!theirs) return null;
    const task = await this.tasks.findById(theirs.task_id, chapterId);
    return task ? this.view(theirs, task) : null;
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
    const [identities, subtasks, finished] = await Promise.all([
      this.users.findDisplayIdentitiesByIds([userId]),
      this.tasks.findSubtasks(chapterId, [candidate.task.id]),
      this.tasks.findByChapter(chapterId, {
        status: TaskStatus.COMPLETED,
        completedSince: new Date(
          now.getTime() - NUDGE_HISTORY_MS,
        ).toISOString(),
        limit: HISTORY_LIMIT,
      }),
    ]);
    const facts = buildNudgeFacts({
      candidate,
      firstName: firstName(identities[0]?.display_name),
      subtasks,
      history: nudgeHistory({ task: candidate.task, userId, finished }),
      timeZone: input.timeZone,
      now,
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
    if (nudge.title === null || nudge.body === null) return null;
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
