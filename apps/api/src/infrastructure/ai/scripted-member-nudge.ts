import type { NudgeOutput } from '#domain/utils/member-nudge';
import type { ScriptedHandler } from './scripted-language-model';

/**
 * The scripted adapter's reply for `nudges.write` (#4781), so the card can
 * be walked locally with no key (`AI_ENABLED=true AI_PROVIDER=scripted`).
 *
 * It is not a model and proves nothing about one. It reads the facts the
 * request carries, line by line, and fills a plain sentence per kind from
 * them, so the card on screen is about the member's real task.
 */

function fact(prompt: string, label: string): string | null {
  const line = prompt.split('\n').find((row) => row.startsWith(`${label}: `));
  return line ? line.slice(label.length + 2).trim() : null;
}

function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

export const scriptedMemberNudge: ScriptedHandler = (request) => {
  const prompt = request.messages.at(-1)?.content ?? '';
  const task = short(fact(prompt, 'Task') ?? 'Your task', 50);
  const due = fact(prompt, 'Due') ?? 'soon';
  const typical = fact(
    prompt,
    'Those usually took this many days from handed out to done',
  );
  const firstStep = prompt
    .split('\n')
    .find((row) => row.startsWith('- [to do] '))
    ?.slice('- [to do] '.length);
  const note = fact(prompt, "The officer's note when sending it back");
  const start = firstStep
    ? `Open it and do "${short(firstStep, 60)}" first.`
    : typical
      ? `Tasks like this usually took about ${typical} days, so block out a first sitting today.`
      : '';

  let output: NudgeOutput;
  if (fact(prompt, 'Finished this many days before the deadline') !== null) {
    output = {
      title: 'That one landed',
      body: `You got "${task}" done on time, and the chapter runs on exactly that.`,
      start_here: '',
    };
  } else if (note !== null) {
    output = {
      title: 'Almost there',
      body: `"${task}" only needs one more pass before it is confirmed.`,
      start_here: `Read the note again and fix just that: ${short(note, 70)}`,
    };
  } else if (fact(prompt, 'Days past due') !== null) {
    output = {
      title: 'Worth closing out',
      body: `"${task}" is still open, and finishing it now still counts.`,
      start_here: start,
    };
  } else {
    output = {
      title: 'A good day to start',
      body: `"${task}" is due ${due}. A small start today makes the rest easy.`,
      start_here: start,
    };
  }
  return { text: JSON.stringify(output), object: output };
};
