import type { AgendaSuggestOutput } from '#domain/utils/agenda-suggestions';
import type { ScriptedHandler } from './scripted-language-model';

/**
 * The scripted adapter's reply for `agenda.suggest` (#5534), so the
 * Suggested section can be walked locally with no key
 * (`AI_ENABLED=true AI_PROVIDER=scripted`).
 *
 * It is not a model and proves nothing about one. It reads the prompt's
 * last meeting (`M1`): an open action item becomes a check-in, a report
 * given becomes that report again, and a topic becomes a follow-up, so
 * what shows is about the chapter's real minutes.
 */

function fieldOf(prompt: string, label: string): string[] {
  const line = prompt.split('\n').find((row) => row.startsWith(`  ${label}: `));
  if (!line) return [];
  return line
    .slice(label.length + 4)
    .split(label === 'Reports given' ? ', ' : ' | ')
    .map((part) => part.trim())
    .filter(Boolean);
}

function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

export const scriptedAgendaSuggest: ScriptedHandler = (request) => {
  const prompt = request.messages.at(-1)?.content ?? '';
  // Only the last meeting's lines: the first block after "M1:".
  const lastMeeting = prompt.split(/\nM2: /)[0] ?? '';
  const items: AgendaSuggestOutput['items'] = [
    ...fieldOf(lastMeeting, 'Open action items').map((item) => ({
      text: short(`Check in: ${item}`, 120),
      reason: 'Still open from the last meeting',
      minutes: 'M1',
    })),
    ...fieldOf(lastMeeting, 'Reports given').map((office) => ({
      text: `${office} report`,
      reason: 'Given at the last meeting',
      minutes: 'M1',
    })),
    ...fieldOf(lastMeeting, 'Topics').map((topic) => ({
      text: short(`Follow up: ${topic}`, 120),
      reason: 'Discussed at the last meeting',
      minutes: 'M1',
    })),
  ].slice(0, 3);
  const output: AgendaSuggestOutput = { items };
  return { text: JSON.stringify(output), object: output };
};
