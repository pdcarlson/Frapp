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
