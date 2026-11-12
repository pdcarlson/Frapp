import { placeCitations } from './citation-placement';

describe('placeCitations', () => {
  const text =
    'Dues are $225 per active member. They are due by October 15. Late payments add a $25 fee.';
  const end = (sentence: string) => text.indexOf(sentence) + sentence.length;

  it('puts a citation with no position after the sentence sharing its words', () => {
    const placed = placeCitations(text, [
      { sourceId: 'late', quote: 'a late fee of $25 applies' },
      {
        sourceId: 'dues',
        quote: 'dues for the term are $225 per active member',
      },
    ]);
    expect(placed).toEqual([
      {
        sourceId: 'dues',
        quote: 'dues for the term are $225 per active member',
        at: end('Dues are $225 per active member.'),
      },
      {
        sourceId: 'late',
        quote: 'a late fee of $25 applies',
        at: text.length,
      },
    ]);
  });

  it('moves a positioned citation to the end of its sentence, never mid-word', () => {
    const mid = text.indexOf('October') + 3;
    const [placed] = placeCitations(text, [
      { sourceId: 'memo', quote: 'paid in full by October 15', at: mid },
    ]);
    expect(placed.at).toBe(end('They are due by October 15.'));
  });

  it('keeps a position already at a sentence end', () => {
    const at = end('Dues are $225 per active member.');
    expect(
      placeCitations(text, [{ sourceId: 'a', quote: 'x', at }])[0].at,
    ).toBe(at);
  });

  it('falls back to the end of the answer when nothing matches or the position is off', () => {
    const answer = 'The meeting is Sunday.  ';
    const placed = placeCitations(answer, [
      { sourceId: 'a', quote: 'zzz qqq' },
      { sourceId: 'b', quote: 'meeting', at: 999 },
      { sourceId: 'c', quote: 'meeting', at: -1 },
    ]);
    expect(placed.map((citation) => citation.at)).toEqual([
      answer.trimEnd().length,
      answer.trimEnd().length,
      answer.trimEnd().length,
    ]);
  });

  it('treats a line break as a sentence end and keeps closing quotes inside', () => {
    const list = 'Quiet hours:\n- 11pm on weeknights\n- 1am on weekends';
    const [weeknights] = placeCitations(list, [
      { sourceId: 'rules', quote: 'begin at 11pm on weeknights' },
    ]);
    expect(list.slice(0, weeknights.at).endsWith('11pm on weeknights')).toBe(
      true,
    );
    const quoted = 'The rule says "no guests after midnight." It is firm.';
    const [rule] = placeCitations(quoted, [
      { sourceId: 'rules', quote: 'no guests after midnight' },
    ]);
    expect(quoted.slice(0, rule.at)).toBe(
      'The rule says "no guests after midnight."',
    );
  });

  it('keeps the given order for citations at the same place', () => {
    const placed = placeCitations('One sentence only.', [
      { sourceId: 'first', quote: 'sentence' },
      { sourceId: 'second', quote: 'sentence' },
    ]);
    expect(placed.map((citation) => citation.sourceId)).toEqual([
      'first',
      'second',
    ]);
  });

  it('places nothing in an empty answer past offset zero', () => {
    expect(placeCitations('', [{ sourceId: 'a', quote: 'x' }])[0].at).toBe(0);
  });
});
