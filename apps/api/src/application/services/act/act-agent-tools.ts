import { z } from 'zod';
import type {
  AgentProposeResult,
  AgentProposeTool,
  AgentToolContext,
} from '../ask/agent/agent-tool';
import type { ActPlan } from './act-prompt';
import type { ActOutcome, ActTool } from './act-tool';
import type { ActService } from './act.service';

/**
 * The cards Ask's tool loop may propose (#4899): the acting agent's own
 * actions (`act-tools.ts`), offered to the model that reads the chapter, so
 * "make a task for each action item in last night's minutes" can read the
 * minutes and then propose.
 *
 * Each is a thin front for one `ActTool`, and adds no authority and no
 * second way to build a card:
 *
 * - **It takes its name, permission and module from the action**, so the
 *   loop offers it on the rule the action is offered on, and
 *   `ActService.proposePlanned` checks `ai:act`, `members:view` and that
 *   rule again before anything is looked up.
 * - **It only reshapes arguments.** What the model wrote becomes the same
 *   plan a typed request is read into, and the action's own `draft` does
 *   the rest: names looked up in this chapter's roster, attendance read only
 *   for a member who may read it, and every limit a card has.
 * - **It tells the model the kind of outcome and nothing on the card.** The
 *   member reads the card; the model is told one was made, or which detail
 *   is missing, in words written here.
 *
 * What is different from a typed request, and why it is allowed
 * (`docs/security/ai-prompt-injection.md` C3 and C5 as changed 2026-11-13):
 * the model naming the action has read the chapter's text, so a planted
 * message can lead to a card. A card changes nothing. The asker sees what it
 * would do, and Confirm checks their permission again.
 */

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A calendar day, like 2026-11-01.');
const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .describe("A 24-hour time in the member's time zone, like 19:30.");
/** A name, a title or a sentence the model wrote. Cut again by the action. */
const words = (max: number) => z.string().trim().min(1).max(max);

const PointsArgs = z.object({
  amount: z
    .number()
    .int()
    .describe(
      'Whole points for each member. Negative takes points away. Only a number the member gave.',
    ),
  reason: words(200).describe('What the points are for, in a few words.'),
  people: z
    .array(words(120))
    .max(50)
    .optional()
    .describe(
      'The members or roles, each by name as the member or a source wrote it. "me" is the member asking. Leave out with everyone_who_attended.',
    ),
  everyone_who_attended: z
    .boolean()
    .optional()
    .describe('True when the points are for everyone who came to one event.'),
  event_name: words(200)
    .optional()
    .describe('With everyone_who_attended: the event, by name.'),
  event_date: day.optional().describe('With everyone_who_attended: its day.'),
});

const TaskArgs = z.object({
  title: words(200).describe('A short name for the task.'),
  assignee: words(120)
    .optional()
    .describe(
      'The one member it is for, by name. "me" is the member asking. Left out, the member picks on the card.',
    ),
  due_date: day.optional().describe('The day it is due.'),
  due_time: time.optional().describe('The time it is due, when one was said.'),
  details: words(2_000).optional().describe('Anything else worth saying.'),
});

const EventArgs = z.object({
  name: words(200).describe("The event's name."),
  date: day.describe('The day it is on.'),
  start_time: time.describe('When it starts.'),
  end_time: time.optional().describe('When it ends. Left out: an hour.'),
  location: words(500).optional(),
  details: words(2_000).optional(),
  required: z
    .boolean()
    .optional()
    .describe('True only when members must attend.'),
  points: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('The points it is worth, when the member said.'),
});

/** Every field of a plan, empty. An action reads the ones it needs. */
const EMPTY_PLAN: Omit<ActPlan, 'action'> = {
  people: [],
  everyone_who_attended: false,
  event_name: null,
  date: null,
  start_time: null,
  end_time: null,
  amount: null,
  title: null,
  details: null,
  location: null,
  required: null,
};

interface Front<Args> {
  description: string;
  reading: string;
  input: z.ZodType<Args>;
  plan: (args: Args) => Omit<ActPlan, 'action'>;
}

function front<Args>(shape: Front<Args>): Front<unknown> {
  return shape;
}

/** By the action's name. An action with no entry is not offered to the loop. */
const FRONTS: Readonly<Record<string, Front<unknown>>> = {
  give_points: front<z.infer<typeof PointsArgs>>({
    description:
      'Prepare a card that gives points to, or takes points from, members, for the member to confirm. Use it only when the member asked for points to be given or taken, and gave the amount. It changes nothing by itself.',
    reading: 'Working out the points',
    input: PointsArgs,
    plan: (args) => ({
      ...EMPTY_PLAN,
      amount: args.amount,
      title: args.reason,
      people: args.people ?? [],
      everyone_who_attended: args.everyone_who_attended === true,
      event_name: args.event_name ?? null,
      date: args.event_date ?? null,
    }),
  }),
  create_task: front<z.infer<typeof TaskArgs>>({
    description:
      'Prepare a card that creates one task for one member, for the member asking to confirm. Use it only when they asked for a task, or for tasks to be made from something you read; call it once for each task. It changes nothing by itself.',
    reading: 'Working out the task',
    input: TaskArgs,
    plan: (args) => ({
      ...EMPTY_PLAN,
      title: args.title,
      people: args.assignee === undefined ? [] : [args.assignee],
      date: args.due_date ?? null,
      start_time: args.due_time ?? null,
      details: args.details ?? null,
    }),
  }),
  create_event: front<z.infer<typeof EventArgs>>({
    description:
      'Prepare a card that puts one event on the chapter calendar, for the member to confirm. Use it only when the member asked for an event to be made and you have its name, day and start time. It changes nothing by itself.',
    reading: 'Working out the event',
    input: EventArgs,
    plan: (args) => ({
      ...EMPTY_PLAN,
      title: args.name,
      date: args.date,
      start_time: args.start_time,
      end_time: args.end_time ?? null,
      location: args.location ?? null,
      details: args.details ?? null,
      required: args.required ?? null,
      amount: args.points ?? null,
    }),
  }),
};

/** What the model is told a detail is called. Never what was typed. */
const MISSING: Readonly<Record<string, string>> = {
  amount: 'the number of points',
  reason: 'what the points are for',
  people: 'who it is for',
  title: 'a name for it',
  date: 'the day',
  time: 'the start time',
};

/**
 * The line the model reads back. From the outcome's kind and counts alone:
 * no name, title or other member text is ever in it.
 */
export function proposalNote(outcome: ActOutcome): string {
  switch (outcome.status) {
    case 'proposed': {
      const open = outcome.notes.filter(
        (note) =>
          note.type === 'unmatched_name' || note.type === 'ambiguous_name',
      ).length;
      return [
        'A card is ready for the member to confirm. Nothing has changed yet. Do not describe the card or repeat what is on it.',
        ...(open > 0
          ? [
              'A name on it could not be placed; the card asks the member to pick.',
            ]
          : []),
      ].join(' ');
    }
    case 'needs_event':
      return 'The member is being asked which event they mean. Make no other card for this, and say nothing about which event it might be.';
    case 'unclear': {
      if (outcome.missing === 'attendance_access') {
        return 'No card was made: this member cannot read who attended an event.';
      }
      if (outcome.missing === 'nobody_attended') {
        return 'No card was made: nobody is marked as having attended that event.';
      }
      if (outcome.missing === 'too_many_members') {
        return 'No card was made: that is more members than one card can hold.';
      }
      const what = MISSING[outcome.missing];
      return what
        ? `No card was made: ${what} is missing. If the member said it or a source gives it, call again with it. Otherwise the member is asked.`
        : 'No card was made: the request was not clear enough.';
    }
    case 'no_action':
      return 'This member cannot do that, so no card was made.';
    case 'refused':
    case 'unavailable':
      return 'No card could be made right now.';
  }
}

class ActProposeTool implements AgentProposeTool {
  readonly effect = 'propose' as const;
  readonly name: string;
  readonly permission: string;
  readonly module: string | null;
  readonly description: string;
  readonly reading: string;
  readonly input: z.ZodType<unknown>;
  private readonly plan: Front<unknown>['plan'];

  constructor(
    action: ActTool,
    shape: Front<unknown>,
    private readonly act: ActService,
  ) {
    this.plan = shape.plan;
    this.name = action.name;
    this.permission = action.permission;
    this.module = action.module;
    this.description = shape.description;
    this.reading = shape.reading;
    this.input = shape.input;
  }

  async propose(
    args: unknown,
    context: AgentToolContext,
  ): Promise<AgentProposeResult> {
    const outcome = await this.act.proposePlanned(
      {
        chapterId: context.chapterId,
        userId: context.userId,
        enabledModules: context.enabledModules,
        timeZone: context.timeZone,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      },
      this.name,
      { action: this.name, ...this.plan(args) },
      context.now,
    );
    return {
      chapterId: context.chapterId,
      card:
        outcome.status === 'proposed' ||
        outcome.status === 'needs_event' ||
        outcome.status === 'unclear'
          ? outcome
          : null,
      note: proposalNote(outcome),
    };
  }
}

/** The loop's propose tools, one for each action that has a front. */
export function actProposeTools(
  actions: readonly ActTool[],
  act: ActService,
): AgentProposeTool[] {
  return actions.flatMap((action) => {
    const shape = FRONTS[action.name];
    return shape && action.effect === 'propose'
      ? [new ActProposeTool(action, shape, act)]
      : [];
  });
}
