/**
 * The whole real-question set: the plan's forty (`questions.ts`) and Paul's
 * own (`paul-questions.json`).
 *
 * Paul's are data so that adding one is not a code change. He gives a
 * question the way he would say it: who asks, the words, what a good answer
 * looks like. Whoever adds it writes the entry, naming people and channels
 * as the synthetic chapter has them (`README.md`, "Adding a real question").
 * A real chapter's names and messages never go in: the repo is public.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ROSTER } from '../synthetic-chapter/roster';
import { TERM_CHANNEL_NAMES, TERM_EVENTS } from '../synthetic-chapter/term';
import { PLAN_QUESTIONS } from './questions';
import { KNOWN_TOOLS, QUESTION_GROUPS, type RealQuestion } from './types';

const Facts = z.array(z.array(z.string().min(1)).min(1));

/** One entry of `paul-questions.json`. People and channels are by name. */
export const PaulQuestionSchema = z
  .object({
    id: z.string().regex(/^paul-[a-z0-9-]+$/),
    group: z.enum(QUESTION_GROUPS as [string, ...string[]]),
    /** A member of the synthetic chapter, by full name. */
    asker: z.string(),
    /** The channel asked from, as `#name`, or the event's name. */
    fromChannel: z.string().optional(),
    fromEvent: z.string().optional(),
    question: z.string().min(3),
    rightAnswer: z.string().min(41),
    reference: z.string().optional(),
    decline: z.boolean().optional(),
    facts: Facts.default([]),
    never: z.array(z.string()).optional(),
    neverShown: z.array(z.string()).optional(),
    tools: z.array(z.array(z.enum(KNOWN_TOOLS))).default([]),
    maxWords: z.number().int().positive().max(200).default(120),
    cards: z
      .object({ min: z.number().int().min(0), max: z.number().int().min(0) })
      .optional(),
    cardFacts: Facts.optional(),
  })
  .strict();

export type PaulQuestion = z.input<typeof PaulQuestionSchema>;

/** Reads entries written for `paul-questions.json` into the set's own shape. */
export function parsePaulQuestions(raw: unknown): RealQuestion[] {
  return z
    .array(PaulQuestionSchema)
    .parse(raw)
    .map((entry): RealQuestion => {
      const asker = ROSTER.find((person) => person.name === entry.asker);
      if (!asker) {
        throw new Error(
          `${entry.id}: "${entry.asker}" is not a member of the synthetic chapter (synthetic-chapter/roster.ts)`,
        );
      }
      const channelId = entry.fromChannel
        ? Object.entries(TERM_CHANNEL_NAMES).find(
            ([, name]) => name === entry.fromChannel,
          )?.[0]
        : undefined;
      if (entry.fromChannel && !channelId) {
        throw new Error(`${entry.id}: no channel ${entry.fromChannel}`);
      }
      const eventId = entry.fromEvent
        ? TERM_EVENTS.find((event) => event.name === entry.fromEvent)?.id
        : undefined;
      if (entry.fromEvent && !eventId) {
        throw new Error(`${entry.id}: no event "${entry.fromEvent}"`);
      }
      return {
        id: entry.id,
        group: entry.group as RealQuestion['group'],
        origin: 'paul',
        askerId: asker.id,
        ...(channelId || eventId
          ? {
              from: {
                ...(channelId ? { channelId } : {}),
                ...(eventId ? { eventId } : {}),
              },
            }
          : {}),
        question: entry.question,
        rightAnswer: entry.rightAnswer,
        ...(entry.reference ? { reference: entry.reference } : {}),
        expect: {
          ...(entry.decline ? { decline: true } : {}),
          facts: entry.facts,
          ...(entry.never ? { never: entry.never } : {}),
          ...(entry.neverShown ? { neverShown: entry.neverShown } : {}),
          tools: entry.tools,
          maxWords: entry.maxWords,
          ...(entry.cards ? { cards: entry.cards } : {}),
          ...(entry.cardFacts ? { cardFacts: entry.cardFacts } : {}),
        },
      };
    });
}

export const PAUL_QUESTIONS: readonly RealQuestion[] = parsePaulQuestions(
  JSON.parse(readFileSync(join(__dirname, 'paul-questions.json'), 'utf8')),
);

export const REAL_QUESTIONS: readonly RealQuestion[] = [
  ...PLAN_QUESTIONS,
  ...PAUL_QUESTIONS,
];

export function findQuestion(id: string): RealQuestion {
  const found = REAL_QUESTIONS.find((question) => question.id === id);
  if (!found) throw new Error(`No real question ${id}`);
  return found;
}

export * from './types';
