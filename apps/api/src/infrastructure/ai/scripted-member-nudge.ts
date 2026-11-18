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
  // The widened card's one sentence (#5464): `nudges.item-line`.
  if (request.system?.includes('Return "line"')) {
    const line = scriptedLine(prompt);
    return { text: JSON.stringify({ line }), object: { line } };
  }
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

/** One plain sentence from the item's facts, by what they name. */
function scriptedLine(prompt: string): string {
  const event = fact(prompt, 'Event');
  if (event !== null) {
    const points = fact(prompt, 'Points for coming');
    return points
      ? `Being there counts for ${points} points, and the night goes better with everyone in the room.`
      : 'The night goes better with everyone in the room.';
  }
  if (fact(prompt, 'Sign-up') !== null) {
    return 'Picking a slot now takes a minute and gets you the time that suits you.';
  }
  if (fact(prompt, 'Minutes posted for') !== null) {
    return 'A quick read catches you up on what was decided.';
  }
  const left = fact(prompt, 'Left to reach it');
  return left
    ? `One focused session today takes a real bite out of the ${left} left.`
    : 'One focused session today keeps the week on track.';
}
