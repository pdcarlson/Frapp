import type { LanguageModelRequest } from '#domain/adapters/language-model.interface';
import type { ScriptedReply } from './scripted-language-model';

/**
 * What the scripted adapter answers for Ask's two tasks in the running app
 * (`AI_PROVIDER=scripted`), so Ask can be walked end to end with no key.
 *
 * Neither is a model. The planner picks tools by a few keywords, and the
 * answer is the sentences of the given sources that share the most words
 * with the question, quoted as they stand. That is enough to make the screen
 * real: the quotes pass the gateway's word-for-word check because they are
 * copied from the sources, and a question nothing matches gets the "could
 * not find" answer.
 */

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'was',
  'were',
  'what',
  'when',
  'where',
  'who',
  'how',
  'does',
  'did',
  'our',
  'your',
  'you',
  'with',
  'about',
  'this',
  'that',
  'have',
  'has',
  'say',
  'says',
  'much',
  'many',
  'next',
  'chapter',
  'there',
  'any',
  'can',
  'will',
  'from',
  'into',
  'they',
  'their',
  'not',
]);

function words(text: string): Set<string> {
  const found: string[] = text.toLowerCase().match(/[a-z0-9$%']+/g) ?? [];
  return new Set(
    found.filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );
}

const TOOL_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  roster: [
    'who',
    'treasurer',
    'president',
    'secretary',
    'chair',
    'officer',
    'officers',
    'role',
    'roster',
    'members',
  ],
  events: [
    'when',
    'event',
    'events',
    'meeting',
    'calendar',
    'formal',
    'tonight',
    'tomorrow',
    'week',
    'weekend',
    'required',
    'mandatory',
  ],
  my_points: ['points'],
  points_leaderboard: ['leaderboard', 'standings', 'most', 'ranking', 'top'],
  my_dues: ['dues', 'owe', 'invoice', 'paid', 'pay'],
};

/** `ask.plan`: the offered tools whose keywords the question uses. */
export function scriptedAskPlan(request: LanguageModelRequest): ScriptedReply {
  const message = request.messages.at(-1)?.content ?? '';
  const [questionPart, toolsPart = ''] = message.split('\nTools:\n');
  const askedWords: string[] =
    questionPart.toLowerCase().match(/[a-z']+/g) ?? [];
  const asked = new Set(askedWords);
  const offered = [...toolsPart.matchAll(/^- ([a-z_]+):/gm)].map(
    (match) => match[1],
  );
  const tools = offered.filter((name) =>
    (TOOL_KEYWORDS[name] ?? []).some((keyword) => asked.has(keyword)),
  );
  return { text: JSON.stringify({ tools }), object: { tools } };
}

interface Candidate {
  sourceId: string;
  sentence: string;
  score: number;
}

/** `ask.answer`: the best-matching sentences of the sources, quoted. */
export function scriptedAskAnswer(
  request: LanguageModelRequest,
): ScriptedReply {
  if (request.kind !== 'cited') return { text: '' };
  const asked = words(request.messages.at(-1)?.content ?? '');
  const candidates: Candidate[] = [];
  for (const source of request.sources) {
    for (const raw of source.text.split(/(?<=[.!?])\s+|\n+/)) {
      const sentence = raw.trim();
      if (sentence.length < 12) continue;
      let score = 0;
      for (const word of words(sentence)) if (asked.has(word)) score += 1;
      if (score > 0) candidates.push({ sourceId: source.id, sentence, score });
    }
  }
  const needed = asked.size >= 3 ? 2 : 1;
  const best = candidates
    .filter((candidate) => candidate.score >= needed)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (best.length === 0) {
    return { text: 'I could not find that in the sources I was given.' };
  }
  return {
    text: best
      .map(({ sentence }) =>
        /[.!?]$/.test(sentence) ? sentence : `${sentence}.`,
      )
      .join(' '),
    citations: best.map(({ sourceId, sentence }) => ({
      sourceId,
      quote: sentence,
    })),
  };
}
