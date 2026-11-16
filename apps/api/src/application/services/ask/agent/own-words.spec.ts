import {
  OWN_WORDS_MAX_SENTENCE,
  OWN_WORDS_MAX_TEXT,
  ownWords,
} from './own-words';

describe('ownWords', () => {
  it.each([
    [
      'Hi Paul, ask me anything about your chapter.',
      'Hi Paul, ask me anything about your chapter.',
    ],
    [
      "I don't give out phone numbers. You can message Caleb in Frapp.",
      "I don't give out phone numbers. You can message Caleb in Frapp.",
    ],
    [
      `I don't give out phone numbers, emails or home addresses, so ask Dr. Caleb A. Osei directly. ${'You can message him here in Frapp or open his profile from the roster. '.repeat(3)}`,
      "I don't give out phone numbers, emails or home addresses, so ask Dr. Caleb A. Osei directly.",
    ],
    [
      'Which Jordan do you mean? @Jordan A. Lee or @Jordan B. Park.',
      'Which Jordan do you mean? @Jordan A. Lee or @Jordan B. Park.',
    ],
    [
      'Which one do you mean: @Jordan Lee or @Jordan Park?',
      'Which one do you mean: @Jordan Lee or @Jordan Park?',
    ],
    ['Dues are $4.50 a week, I think', 'Dues are $4.50 a week, I think'],
    ['  Hello!  ', 'Hello!'],
  ])('shows the first sentence of %j', (text, shown) => {
    expect(ownWords(text)).toBe(shown);
  });

  it.each([
    ['nothing', ''],
    ['only space', '  \n '],
    ['a long uncited answer', 'Dues are due. '.repeat(40)],
    ['more than one line', 'Hello!\nMore on a second line.'],
    ['an answer under a lead-in', "Here's what I found:\n- Dues are $450"],
    ['a list', '- Dues are $450\n- Formal is Friday'],
    ['a numbered list', '1. Dues\n2. Formal'],
    ['a heading', '# Dues'],
    ['an overlong sentence', `${'word '.repeat(60)}.`],
  ])('shows nothing for %s', (_what, text) => {
    expect(ownWords(text)).toBeNull();
  });

  it('keeps its limits in order', () => {
    expect(OWN_WORDS_MAX_SENTENCE).toBeLessThan(OWN_WORDS_MAX_TEXT);
  });
});
