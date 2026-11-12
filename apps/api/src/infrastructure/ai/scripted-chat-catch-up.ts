import type { CatchUpOutput } from '#domain/utils/chat-catch-up';
import { linesInCatchUpPrompt } from '#domain/utils/chat-catch-up';
import type { ScriptedHandler } from './scripted-language-model';

/**
 * The scripted adapter's reply for `chat.catch-up` (#3946), so the summary
 * can be walked locally with no key (`AI_ENABLED=true AI_PROVIDER=scripted`).
 *
 * It is not a model and proves nothing about one. It sorts the
 * conversation's own lines by the words they hold: a line that mentions the
 * reader is theirs, a line that settles something is a decision, a line with
 * a day or a deadline is a date, and a question is a topic. Each point
 * quotes its line whole, so it passes the word-for-word check the way a
 * careful model's quote would.
 */

const DECISION =
  /\b(decided|agreed|approved|passed|voted|final|settled|confirmed|we(?:'re| are) going with|going with)\b/i;
const DATE =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|deadline|due|by noon|by midnight|\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i;
const ADDRESSED_TO_AI = /\b(AI|assistant|ignore (?:your|all|previous))\b/;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 157).trimEnd()}...` : flat;
}

export const scriptedChatCatchUp: ScriptedHandler = (request) => {
  const prompt = request.messages.at(-1)?.content ?? '';
  const output: CatchUpOutput = { points: [] };
  const seen = new Set<string>();
  for (const line of linesInCatchUpPrompt(prompt)) {
    // A line that talks to the summarizer is not followed and not reported.
    if (ADDRESSED_TO_AI.test(line.text)) continue;
    const name = line.who.replace(/ \(.*\)$/, '');
    const kind = /\(.*mentions /.test(line.who)
      ? 'for_you'
      : DECISION.test(line.text)
        ? 'decision'
        : DATE.test(line.text)
          ? 'date'
          : line.text.trim().endsWith('?')
            ? 'topic'
            : null;
    if (kind === null) continue;
    // One point per kind and author, so a chatty member is not the summary.
    const key = `${kind}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.points.push({
      kind,
      text:
        kind === 'for_you'
          ? `${name} asked you: ${clip(line.text)}`
          : kind === 'topic'
            ? `${name} asked: ${clip(line.text)}`
            : `${name}: ${clip(line.text)}`,
      message: line.ref,
      quote: line.text,
    });
  }
  const order = ['for_you', 'decision', 'date', 'topic'];
  output.points.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  output.points = output.points.slice(0, 10);
  return { text: JSON.stringify(output), object: output };
};
