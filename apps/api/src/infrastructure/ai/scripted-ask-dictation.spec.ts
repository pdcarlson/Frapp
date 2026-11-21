import type { LanguageModelRequest } from '#domain/adapters/language-model.interface';
import { scriptedAskDictation, tidyDictation } from './scripted-ask-dictation';
import { SCRIPTED_REPLIES } from './scripted-replies';

function request(text: string): LanguageModelRequest {
  return {
    task: 'ask.dictation',
    kind: 'structured',
    // The fence `askDictationMessages` writes (`ask-dictation-prompt.ts`),
    // written out: infrastructure does not import the application layer.
    messages: [
      {
        role: 'user',
        content: `Clean up this dictation:\n<dictation>\n${text}\n</dictation>`,
      },
    ],
    maxOutputTokens: 600,
  } as unknown as LanguageModelRequest;
}

describe('scriptedAskDictation', () => {
  it('is the running app’s script for the task', () => {
    expect(SCRIPTED_REPLIES['ask.dictation']).toBe(scriptedAskDictation);
  });

  it('tidies the fenced words and nothing around them', () => {
    expect(scriptedAskDictation(request('um when is uh chapter'))).toEqual({
      text: JSON.stringify({ text: 'When is chapter.' }),
      object: { text: 'When is chapter.' },
    });
  });

  it('leaves words that are all filler as they were', () => {
    expect(tidyDictation('um uh')).toBe('um uh');
  });

  it('keeps an ending the words already have', () => {
    expect(tidyDictation('who is driving?')).toBe('Who is driving?');
  });
});
