import { isQuoteGrounded, verifyCitations } from './quote-grounding';

const sources = [
  { id: 'bylaws', text: 'Dues are $450 per semester. Late fees are $25.' },
  { id: 'minutes', text: 'The chapter voted to move formal to April 12.' },
];

describe('isQuoteGrounded', () => {
  it('accepts a span that is in the source word for word', () => {
    expect(
      isQuoteGrounded('Dues are $450 per semester.', sources[0].text),
    ).toBe(true);
  });

  it('refuses an empty quote', () => {
    expect(isQuoteGrounded('', sources[0].text)).toBe(false);
  });

  it.each([
    ['a different figure', 'Dues are $500 per semester.'],
    ['different case', 'dues are $450 per semester.'],
    ['repaired whitespace', 'Dues are  $450 per semester.'],
    ['a paraphrase', 'Each semester costs $450 in dues.'],
  ])('refuses %s', (_label, quote) => {
    expect(isQuoteGrounded(quote, sources[0].text)).toBe(false);
  });
});

describe('verifyCitations', () => {
  it('keeps grounded citations in order and counts the rest', () => {
    const grounded = { sourceId: 'bylaws', quote: 'Late fees are $25.' };
    const alsoGrounded = {
      sourceId: 'minutes',
      quote: 'move formal to April 12',
    };
    const result = verifyCitations(
      [
        grounded,
        { sourceId: 'bylaws', quote: 'Late fees are $40.' },
        alsoGrounded,
      ],
      sources,
    );
    expect(result.kept).toEqual([grounded, alsoGrounded]);
    expect(result.dropped).toBe(1);
  });

  it('drops a real quote hung on the wrong source', () => {
    const result = verifyCitations(
      [{ sourceId: 'minutes', quote: 'Late fees are $25.' }],
      sources,
    );
    expect(result).toEqual({ kept: [], dropped: 1 });
  });

  it('drops a citation of a source the model was never given', () => {
    const result = verifyCitations(
      [{ sourceId: 'other-chapter-roster', quote: 'Late fees are $25.' }],
      sources,
    );
    expect(result).toEqual({ kept: [], dropped: 1 });
  });

  it('keeps the extra fields a caller put on a citation', () => {
    const citation = {
      sourceId: 'bylaws',
      quote: 'Late fees are $25.',
      page: 3,
    };
    expect(verifyCitations([citation], sources).kept).toEqual([citation]);
  });
});
