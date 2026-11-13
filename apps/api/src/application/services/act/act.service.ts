import { randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { ACT_PROPOSAL_EXPIRY_DAYS, type ActMissing } from '@repo/validation';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import { SystemPermissions, WILDCARD } from '#domain/constants/permissions';
import type { AiSuggestion } from '#domain/entities/ai-suggestion.entity';
import { localDateIn } from '#domain/utils/zoned-time';
import { aiConsentRefusal } from '../ai/ai-consent-refusal';
import { AiConsentService } from '../ai/ai-consent.service';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { AiSuggestionService } from '../ai-suggestion.service';
import { AnalyticsService } from '../analytics.service';
import { longDate, unavailableReason } from '../ask/ask.service';
import { toolsMemberMayUse } from '../ask/ask-tool';
import { RbacService } from '../rbac.service';
import {
  ACT_PLAN_PROMPT_VERSION,
  ActPlanSchema,
  actPlanMessage,
  actPlanSystem,
} from './act-prompt';
import {
  ACT_TOOLS,
  type ActDraft,
  type ActEventChoice,
  type ActNote,
  type ActTool,
  type ActToolContext,
} from './act-tool';
import { GivePointsActTool } from './act-tools';

export interface ActMember {
  /** From `ChapterGuard`. Never from the request body or a model. */
  chapterId: string;
  /** The member asking, from the auth guard. */
  userId: string;
  /** The chapter's module switches, as `ChapterGuard` read them. */
  enabledModules: Record<string, boolean> | null;
  /** The member's IANA time zone. */
  timeZone: string;
  signal?: AbortSignal;
}

/**
 * A request that arrives inside a conversation (`AskConversationService`),
 * where each proposal stays on screen as its own card.
 */
interface ActConversation {
  /**
   * What the member typed earlier in the conversation, oldest first: their
   * own words only, never an answer. It lets "5, for cleaning the kitchen"
   * finish "give Jordan points".
   */
  earlier?: readonly string[];
  /**
   * Leave the member's earlier unconfirmed proposals waiting. Without it a
   * new proposal replaces them, which is what a client that shows one
   * request at a time expects.
   */
  keepEarlier?: boolean;
}

export interface ActInput extends ActMember, ActConversation {
  request: string;
  /**
   * Told the moment the request has been read as an action this member was
   * offered, before its details are looked up. It is how a conversation can
   * say it is working out a card (`AskConversationService`). It is told the
   * action's name and nothing the model wrote.
   */
  onAction?: (action: string) => void;
}

export type ActUnavailableReason =
  | 'consent_required'
  | 'chapter_off'
  | 'chapter_limit'
  | 'member_limit'
  | 'not_available';

export type ActOutcome =
  | {
      status: 'proposed';
      action: string;
      suggestion: AiSuggestion;
      notes: ActNote[];
    }
  | {
      status: 'needs_event';
      action: string;
      amount: number;
      reason: string;
      events: ActEventChoice[];
    }
  | { status: 'unclear'; action: string | null; missing: ActMissing }
  | { status: 'no_action'; available: string[] }
  | { status: 'refused' }
  | { status: 'unavailable'; reason: ActUnavailableReason };

/**
 * Asking Frapp to do something (#718, `spec/behavior/ai.md` § Asking Frapp to
 * do something): an officer's request in their own words becomes a proposal
 * they confirm. **Nothing here changes anything.** The only write is an
 * `ai_suggestions` row that only the asker can open; the change is made by
 * `AiSuggestionService.accept` when they confirm.
 *
 * One request runs these steps, and each rule is here, in the product, not
 * in a prompt (`docs/security/ai-prompt-injection.md` C1 to C5, C8):
 *
 * 1. **Who may act.** The member holds `ai:act` (checked by the route's
 *    guard and again here, for a caller that is not a route). The actions
 *    they are offered are the ones whose own route they could call: that
 *    route's permission held and its module on. `ai:act` adds no authority
 *    of its own.
 * 2. **The action is chosen from the member's words alone.** One planning
 *    call sees the request, what the member typed earlier when the request
 *    is part of a conversation, and the offered actions, and nothing else:
 *    no answer, no chat, no document, no roster, no retrieval. So no text
 *    another person wrote is in front of a model when the action is picked,
 *    and a planted message cannot cause one. An action that was not offered,
 *    or was made up, is nothing.
 * 3. **The details are looked up as the member, in their chapter.** Names
 *    resolve against this chapter's roster only; "everyone who came" reads
 *    attendance only for a member who may read attendance.
 * 4. **A proposal, not a change.** The draft is saved as a suggestion
 *    sourced from the member's own request, which only they can open, and
 *    which is gone in a day. On the request route, asking again replaces
 *    it; in a conversation each card stays until it is confirmed, dismissed
 *    or a day old.
 * 5. **Confirm commits.** Accepting re-checks the action's permission, at
 *    that moment, and goes through the ordinary service with its ordinary
 *    record (the points ledger, the task's and the event's creator).
 *
 * Nothing is stored but the proposal, and no request or proposal text is
 * logged or sent to analytics.
 */
@Injectable()
export class ActService {
  private readonly logger = new Logger(ActService.name);

  constructor(
    private readonly gateway: AiGatewayService,
    private readonly consent: AiConsentService,
    private readonly rbac: RbacService,
    private readonly suggestions: AiSuggestionService,
    private readonly analytics: AnalyticsService,
    @Inject(ACT_TOOLS) private readonly tools: readonly ActTool[],
  ) {}

  /**
   * Refuses, as an ordinary error a client can act on, a member who cannot
   * use AI yet: the president has Ask off (`ai.chapter_off`), or the member
   * has not said yes on the AI sheet (`ai.consent.required`). The gateway
   * checks the same again before every call.
   */
  async assertMayAct(chapterId: string, userId: string): Promise<void> {
    const entry = aiCatalogEntry('act.plan');
    const decision = await this.consent.check({
      chapterId,
      actingUserId: userId,
      task: 'act.plan',
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: ACT_PLAN_PROMPT_VERSION,
    });
    if (!decision.allowed) throw aiConsentRefusal(decision.reason);
  }

  /** The actions this member could be offered now, by name. */
  async availableActions(member: ActMember): Promise<string[]> {
    const { offered } = await this.offered(member);
    return offered.map((tool) => tool.name);
  }

  async act(input: ActInput, now: Date = new Date()): Promise<ActOutcome> {
    const { offered, held } = await this.offered(input);
    const available = offered.map((tool) => tool.name);
    if (offered.length === 0) return { status: 'no_action', available };

    const planned = await this.plan(input, offered, now);
    if (planned === null) {
      return { status: 'unavailable', reason: 'not_available' };
    }
    if (planned.status === 'unavailable') {
      return { status: 'unavailable', reason: unavailableReason(planned) };
    }
    if (planned.status === 'refused') return { status: 'refused' };
    if (planned.status === 'invalid_output') {
      return { status: 'unclear', action: null, missing: 'request' };
    }

    // Only an action that was offered. One the member may not take, or one
    // that does not exist, is the same as none.
    const tool = offered.find((item) => item.name === planned.value.action);
    if (!tool) return { status: 'no_action', available };

    input.onAction?.(tool.name);
    const draft = await tool.draft(
      planned.value,
      this.toolContext(input, held, now),
    );
    return this.settle(tool, draft, input, input.keepEarlier === true);
  }

  /**
   * The follow-up to `needs_event`: the member picked the event whose
   * attendees get the points. No model call. Everything is checked as on the
   * first request: `ai:act`, the points action offered, attendance readable,
   * and the event one this member can see in this chapter.
   */
  async proposePointsForEvent(
    input: ActMember & {
      eventId: string;
      amount: number;
      reason: string | null;
      keepEarlier?: boolean;
    },
    now: Date = new Date(),
  ): Promise<ActOutcome> {
    const { offered, held } = await this.offered(input);
    const tool = offered.find(
      (item): item is GivePointsActTool => item instanceof GivePointsActTool,
    );
    if (!tool) {
      return {
        status: 'no_action',
        available: offered.map((item) => item.name),
      };
    }
    const draft = await tool.draftFromEvent(
      { eventId: input.eventId, amount: input.amount, reason: input.reason },
      this.toolContext(input, held, now),
    );
    return this.settle(tool, draft, input, input.keepEarlier === true);
  }

  private async settle(
    tool: ActTool,
    draft: ActDraft,
    member: ActMember,
    keepEarlier: boolean,
  ): Promise<ActOutcome> {
    if (draft.status === 'unclear') {
      return { status: 'unclear', action: tool.name, missing: draft.missing };
    }
    if (draft.status === 'needs_event') {
      return {
        status: 'needs_event',
        action: tool.name,
        amount: draft.amount,
        reason: draft.reason,
        events: draft.events,
      };
    }

    const source = { type: 'request' as const, id: member.userId };
    // Outside a conversation, one live proposal per member: what they asked
    // before is replaced.
    if (!keepEarlier) {
      await this.suggestions.withdrawSource(member.chapterId, source);
    }
    const { created } = await this.suggestions.proposeBatch({
      chapterId: member.chapterId,
      batchId: randomUUID(),
      requestedFor: member.userId,
      source: { ...source, title: 'Ask Frapp' },
      proposals: [{ kind: tool.kind, payload: draft.payload }],
      // The member is looking at it; a push would tell them what they know.
      notify: [],
      expiresWithinDays: ACT_PROPOSAL_EXPIRY_DAYS,
    });
    const suggestion = created[0];
    if (!suggestion) {
      // The kind's own check turned the draft down.
      return { status: 'unclear', action: tool.name, missing: 'request' };
    }
    // Which action, never what was asked or proposed.
    this.analytics
      .track('ai-act-proposed', member.userId, {
        chapterId: member.chapterId,
        properties: { action: tool.name, open_notes: draft.notes.length },
      })
      .catch(() => undefined);
    return {
      status: 'proposed',
      action: tool.name,
      suggestion,
      notes: draft.notes,
    };
  }

  /**
   * The one planning call. A provider that fails (a timeout, an overload) is
   * an ordinary "not available right now", not a server error; null says so.
   */
  private async plan(input: ActInput, offered: readonly ActTool[], now: Date) {
    try {
      return await this.gateway.generateObject(
        'act.plan',
        {
          promptVersion: ACT_PLAN_PROMPT_VERSION,
          system: actPlanSystem(
            longDate(now, input.timeZone),
            localDateIn(now, input.timeZone),
            input.timeZone,
          ),
          // The member's own words and the actions they may take. Nothing
          // anyone else wrote is ever added to this call.
          messages: [
            {
              role: 'user',
              content: actPlanMessage(input.request, offered, input.earlier),
            },
          ],
          schema: ActPlanSchema,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        { chapterId: input.chapterId, actingUserId: input.userId },
      );
    } catch (error) {
      if (!(error instanceof LanguageModelError) || error.kind === 'aborted') {
        throw error;
      }
      this.logger.warn(`Act: the planning call failed (${error.kind})`);
      return null;
    }
  }

  /**
   * The actions this member may be offered, and what they hold. `ai:act`
   * first: without it there is no acting at all, whatever else they hold.
   * `members:view` with it, as the request route's guard requires (a card
   * names members), because the conversation reaches this without that
   * guard.
   */
  private async offered(
    member: ActMember,
  ): Promise<{ offered: ActTool[]; held: ReadonlySet<string> }> {
    const held = new Set(
      await this.rbac.getEffectivePermissions(member.chapterId, member.userId),
    );
    if (
      !held.has(WILDCARD) &&
      !(
        held.has(SystemPermissions.AI_ACT) &&
        held.has(SystemPermissions.MEMBERS_VIEW)
      )
    ) {
      throw new ForbiddenException({
        code: 'ai.act.forbidden',
        message: 'You do not have permission to have Ask take actions.',
      });
    }
    const proposing = this.tools.filter((tool) => tool.effect === 'propose');
    return {
      offered: toolsMemberMayUse(proposing, held, member.enabledModules),
      held,
    };
  }

  private toolContext(
    member: ActMember,
    held: ReadonlySet<string>,
    now: Date,
  ): ActToolContext {
    return {
      chapterId: member.chapterId,
      userId: member.userId,
      now,
      timeZone: member.timeZone,
      heldPermissions: held,
      enabledModules: member.enabledModules,
      ...(member.signal === undefined ? {} : { signal: member.signal }),
    };
  }
}
