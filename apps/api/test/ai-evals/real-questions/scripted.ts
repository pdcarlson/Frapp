/**
 * The scripted "model" for the real-question set: it answers each question
 * with that question's reference answer, and cites the opening words of one
 * source it was handed so that Ask keeps the answer.
 *
 * A run on it proves the path and nothing about quality: that every question
 * reaches the agent as its asker, that the reads and the grader run, and
 * that nothing a question forbids was in the request. The scores it
 * produces are the reference answers' scores, not a model's.
 */
import type { LanguageModelRequest } from '#domain/adapters/language-model.interface';
import type { ScriptedReply } from '../../../src/infrastructure/ai/scripted-language-model';
import { REAL_QUESTIONS } from './index';

const REFERENCES = new Map(
  REAL_QUESTIONS.map((question) => [question.question, question.reference]),
);

/** The source that tells the model who is asking. It is not a thing to cite. */
const ASKER_SOURCE = 'asker';

export function scriptedRealAnswer(
  request: LanguageModelRequest,
): ScriptedReply {
  const asked = (request.messages.at(-1)?.content ?? '').trim();
  const text = REFERENCES.get(asked) ?? 'I do not know.';
  const sources = request.kind === 'cited' ? request.sources : [];
  const source = sources.find(
    (candidate) =>
      candidate.id !== ASKER_SOURCE && candidate.text.trim().length > 0,
  );
  if (!source) return { text, citations: [] };
  // The first line, or its first few words: always word for word in the source.
  const quote = source.text
    .trim()
    .split('\n')[0]
    .split(' ')
    .slice(0, 8)
    .join(' ');
  return { text, citations: [{ sourceId: source.id, quote }] };
}

const QUESTIONS = new Map(
  REAL_QUESTIONS.map((question) => [question.question, question]),
);

/** The two searches a first round always makes, with the question as the query. */
const SEARCHES = ['search_records', 'search_messages'];

/**
 * The scripted "model" for the tool loop (`ask.agent`). Its first round
 * searches documents and chat for the question and asks for each read the
 * question expects, with no arguments (a read that needs one, such as a
 * channel's name, is refused by the loop and returns nothing); its
 * second answers with the question's reference answer, citing the opening
 * words of one source a read returned.
 *
 * As with {@link scriptedRealAnswer}, a run on it proves the path: that the
 * product's tools run against the term chapter as the asker, that the loop
 * hands their results back, and that nothing a question forbids was in a
 * request. It proposes no card: a card's content is a model's to write.
 */
export function scriptedRealLoop(request: LanguageModelRequest): ScriptedReply {
  if (request.kind !== 'agent') return { text: 'I do not know.' };
  const asked = (request.messages.at(-1)?.content ?? '').trim();
  const question = QUESTIONS.get(asked);
  if (request.rounds.length === 0 && !request.mustAnswer) {
    const offered = new Set(request.tools.map((tool) => tool.name));
    const reads = (question?.expect.tools ?? []).flatMap((need) => {
      const read = need.find(
        (tool) => offered.has(tool) && !SEARCHES.includes(tool),
      );
      return read ? [read] : [];
    });
    const names = [
      ...SEARCHES.filter((name) => offered.has(name)),
      ...new Set(reads),
    ];
    return {
      text: '',
      toolCalls: names.map((name, index) => ({
        id: `scripted-call-${index + 1}`,
        name,
        input: SEARCHES.includes(name) ? { query: asked.slice(0, 200) } : {},
      })),
    };
  }
  const text = question?.reference ?? 'I do not know.';
  const source = request.rounds
    .flatMap((round) => round.results.flatMap((result) => result.sources))
    .find((candidate) => candidate.text.trim().length > 0);
  if (!source) return { text, citations: [] };
  const quote = source.text
    .trim()
    .split('\n')[0]
    .split(' ')
    .slice(0, 8)
    .join(' ');
  return { text, citations: [{ sourceId: source.id, quote }] };
}
