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
    ['an overlong sentence', `${'word '.repeat(60)}.`],
  ])('shows nothing for %s', (_what, text) => {
    expect(ownWords(text)).toBeNull();
  });

  it.each([
    [
      'a question back with the names on their own lines',
      'Which Jordan do you mean?\n- @Jordan Lee\n- @Jordan Park',
    ],
    ['two short lines', 'Hello!\nAsk me anything about your chapter.'],
    ['a short numbered list', '1. Dues\n2. Formal'],
  ])(
    'shows %s whole: line breaks and lists are allowed (#5179)',
    (_what, text) => {
      expect(ownWords(text)).toBe(text);
    },
  );

  it('cuts a long reply on several lines to its first sentence', () => {
    const text = `Which Jordan do you mean? ${'There are a few.'.repeat(5)}\n${'- @Jordan Lee\n'.repeat(12)}`;
    expect(text.length).toBeLessThanOrEqual(OWN_WORDS_MAX_TEXT);
    expect(ownWords(text)).toBe('Which Jordan do you mean?');
  });

  it('keeps its limits in order', () => {
    expect(OWN_WORDS_MAX_SENTENCE).toBeLessThan(OWN_WORDS_MAX_TEXT);
  });
});
