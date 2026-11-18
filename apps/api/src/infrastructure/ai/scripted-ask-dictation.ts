import type { ScriptedHandler } from './scripted-language-model';

/**
 * The scripted adapter's reply for `ask.dictation` (#5276), so dictation's
 * cleanup can be walked locally with no key
 * (`AI_ENABLED=true AI_PROVIDER=scripted`).
 *
 * It is not a model and proves nothing about one. It reads the words between
 * the fence the prompt puts them in (`ask-dictation-prompt.ts`), drops "um"
 * and "uh", capitalises the first letter and ends the sentence, so the field
 * visibly changes after the mic stops.
 */
const FENCED = /<dictation>\n([\s\S]*)\n<\/dictation>/;
const FILLERS = /\b(?:um+|uh+|er+)\b,?\s*/gi;

export function tidyDictation(said: string): string {
  const words = said.replace(FILLERS, '').replace(/\s+/g, ' ').trim();
  if (words === '') return said.trim();
  const capitalised = words.charAt(0).toUpperCase() + words.slice(1);
  return /[.?!]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

export const scriptedAskDictation: ScriptedHandler = (request) => {
  const prompt = request.messages.at(-1)?.content ?? '';
  const said = FENCED.exec(prompt)?.[1] ?? prompt;
  const output = { text: tidyDictation(said) };
  return { text: JSON.stringify(output), object: output };
};
