import type { LanguageModelRequest } from '#domain/adapters/language-model.interface';
import type { ScriptedReply } from './scripted-language-model';

/**
 * What the scripted adapter answers for Ask's tasks in the running app
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
  my_tasks: ['task', 'tasks', 'todo', 'to-do'],
};

/** A question that only makes sense beside the one before it. */
const LEANS_ON_BEFORE =
  /^\s*(and|also|what about|how about)\b|\b(it|its|that|those|them|they|one)\b/i;

/** `ask.plan`: the offered tools whose keywords the question uses. */
export function scriptedAskPlan(request: LanguageModelRequest): ScriptedReply {
  const message = request.messages.at(-1)?.content ?? '';
  const [questionPart, toolsPart = ''] = message.split('\nTools:\n');
  // In a conversation the member's earlier questions come first. Tools are
  // picked for the question, so only the last "Question:" line on is read.
  const question =
    /(?:^|\n)Question: ([\s\S]*)$/.exec(questionPart)?.[1] ?? questionPart;
  const offered = [...toolsPart.matchAll(/^- ([a-z_]+):/gm)].map(
    (match) => match[1],
  );
  const pick = (text: string) => {
    const said: string[] = text.toLowerCase().match(/[a-z'-]+/g) ?? [];
    const asked = new Set(said);
    return offered.filter((name) =>
      (TOOL_KEYWORDS[name] ?? []).some((keyword) => asked.has(keyword)),
    );
  };
  let tools = pick(question);
  // A follow-up that leans on the question before it ("And where is it?")
  // needs what that one needed, as `scriptedAskAnswer` reads it. Only the
  // one before, and only when this question names nothing itself.
  if (tools.length === 0 && LEANS_ON_BEFORE.test(question)) {
    const before = [...questionPart.matchAll(/^- (.+)$/gm)].at(-1)?.[1];
    if (before) tools = pick(before);
  }
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
  return answerFrom(request.messages, request.sources);
}

/**
 * `ask.agent`: one round of reads, then the same answer. The first round
 * searches for the question and asks for each offered live read whose
 * keywords the question uses; the second quotes what came back.
 */
export function scriptedAskAgent(request: LanguageModelRequest): ScriptedReply {
  if (request.kind !== 'agent') return { text: '' };
  if (request.rounds.length > 0 || request.mustAnswer) {
    return answerFrom(
      request.messages,
      request.rounds.flatMap((round) =>
        round.results.flatMap((result) => result.sources),
      ),
    );
  }
  const question = request.messages.at(-1)?.content ?? '';
  const said: string[] = question.toLowerCase().match(/[a-z'-]+/g) ?? [];
  const asked = new Set(said);
  const names = request.tools
    .map((tool) => tool.name)
    .filter(
      (name) =>
        name === 'search_chapter' ||
        (TOOL_KEYWORDS[name] ?? []).some((keyword) => asked.has(keyword)),
    );
  return {
    text: '',
    toolCalls: names.map((name, index) => ({
      id: `scripted-call-${index + 1}`,
      name,
      input: name === 'search_chapter' ? { query: question.slice(0, 300) } : {},
    })),
  };
}

function answerFrom(
  messages: LanguageModelRequest['messages'],
  sources: readonly { id: string; text: string }[],
): ScriptedReply {
  const last = messages.at(-1)?.content ?? '';
  const asked = words(last);
  // A follow-up that leans on the turn before ("and the one after that?")
  // is read beside the question before it, as the real search does. A
  // question that stands on its own is not.
  if (asked.size < 3 && LEANS_ON_BEFORE.test(last)) {
    const before = messages
      .slice(0, -1)
      .filter((message) => message.role === 'user')
      .at(-1);
    for (const word of words(before?.content ?? '')) asked.add(word);
  }
  const candidates: Candidate[] = [];
  for (const source of sources) {
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
