import {
  ASK_ANSWER_NOT_CARRIED,
  askAnswerMessages,
  askCardsShown,
} from './ask-prompt';

describe('askAnswerMessages', () => {
  it('stands a fixed line in for an answer that is not carried', () => {
    expect(
      askAnswerMessages('And after?', [{ question: 'When?', answer: '' }]),
    ).toEqual([
      { role: 'user', content: 'When?' },
      { role: 'assistant', content: ASK_ANSWER_NOT_CARRIED },
      { role: 'user', content: 'And after?' },
    ]);
  });

  it('says an earlier turn came with cards, after its answer or alone', () => {
    const messages = askAnswerMessages('Make it 10 instead', [
      { question: 'Who is behind?', answer: 'Dante is.', cards: 1 },
      { question: 'Give them 5 points', answer: '', cards: 2 },
    ]);
    expect(messages[1].content).toBe(`Dante is.\n\n${askCardsShown(1)}`);
    expect(messages[3].content).toBe(askCardsShown(2));
    expect(askCardsShown(1)).toContain('a card');
    expect(askCardsShown(2)).toContain('2 cards');
  });
});
