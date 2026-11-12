import {
  CORPUS_CHUNK_MAX_CHARS,
  CORPUS_CHUNK_TARGET_CHARS,
  chunkSections,
  corpusEmbeddingText,
  normalizeCorpusText,
  stripLoneSurrogates,
} from './corpus-chunker';

const sentence = (n: number) =>
  `Sentence number ${n} of the bylaws says something plain.`;
const paragraph = (chars: number, seed = 0) => {
  let text = '';
  for (let n = seed; text.length < chars; n += 1) text += `${sentence(n)} `;
  return text.trim();
};

describe('normalizeCorpusText', () => {
  it('drops NUL and control characters, which Postgres refuses, and tidies space', () => {
    expect(
      normalizeCorpusText(
        'Dues\u0000 are\t $225\r\n\r\n\r\n\r\nper   semester\u0007 ',
      ),
    ).toBe('Dues are $225\n\nper semester');
  });
});

describe('chunkSections', () => {
  it('keeps a short source as one passage', () => {
    expect(
      chunkSections([{ heading: null, page: null, text: 'Dues are $225.' }]),
    ).toEqual([
      {
        heading: null,
        content: 'Dues are $225.',
        pageStart: null,
        pageEnd: null,
      },
    ]);
  });

  it('makes nothing from a source with no words', () => {
    expect(
      chunkSections([{ heading: 'Summary', page: null, text: ' \n\n ' }]),
    ).toEqual([]);
  });

  it('never crosses a heading, so a passage can be cited by its section', () => {
    const chunks = chunkSections([
      {
        heading: 'Decisions',
        page: null,
        text: 'Voted to move formal to April 12.',
      },
      { heading: 'Action items', page: null, text: 'Book the venue.' },
    ]);
    expect(chunks.map((chunk) => [chunk.heading, chunk.content])).toEqual([
      ['Decisions', 'Voted to move formal to April 12.'],
      ['Action items', 'Book the venue.'],
    ]);
  });

  it('closes a passage near the target and keeps paragraphs whole', () => {
    const paragraphs = [0, 100, 200, 300, 400, 500].map((seed) =>
      paragraph(600, seed),
    );
    const chunks = chunkSections([
      { heading: null, page: null, text: paragraphs.join('\n\n') },
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CORPUS_CHUNK_MAX_CHARS);
    }
    // Every paragraph survives intact, in order, in exactly one passage.
    expect(chunks.map((chunk) => chunk.content).join('\n\n')).toBe(
      paragraphs.join('\n\n'),
    );
    expect(chunks[0].content.length).toBeGreaterThanOrEqual(
      CORPUS_CHUNK_TARGET_CHARS,
    );
  });

  it('splits one paragraph that is over the limit at a sentence end', () => {
    const long = paragraph(CORPUS_CHUNK_MAX_CHARS * 2 + 500);
    const chunks = chunkSections([{ heading: null, page: null, text: long }]);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content.length).toBeLessThanOrEqual(CORPUS_CHUNK_MAX_CHARS);
      expect(chunk.content.endsWith('.')).toBe(true);
    }
    expect(chunks.map((chunk) => chunk.content).join(' ')).toBe(long);
  });

  it('splits text with no spaces at all rather than writing an oversized passage', () => {
    const chunks = chunkSections([
      {
        heading: null,
        page: null,
        text: 'x'.repeat(CORPUS_CHUNK_MAX_CHARS + 10),
      },
    ]);
    expect(chunks.map((chunk) => chunk.content.length)).toEqual([
      CORPUS_CHUNK_MAX_CHARS,
      10,
    ]);
  });

  it('records the pages a passage spans', () => {
    const chunks = chunkSections([
      { heading: null, page: 1, text: paragraph(700) },
      { heading: null, page: 2, text: paragraph(700, 50) },
      { heading: null, page: 3, text: paragraph(700, 90) },
      { heading: null, page: 4, text: 'The last page.' },
    ]);
    expect(chunks.map((chunk) => [chunk.pageStart, chunk.pageEnd])).toEqual([
      [1, 3],
      [4, 4],
    ]);
  });
});

describe('corpusEmbeddingText', () => {
  it('puts the title and heading ahead of the passage', () => {
    expect(
      corpusEmbeddingText('Bylaws', {
        heading: 'Article IV: Dues',
        content: 'The fee is $225.',
      }),
    ).toBe('Bylaws › Article IV: Dues\nThe fee is $225.');
    expect(
      corpusEmbeddingText('Bylaws', {
        heading: null,
        content: 'The fee is $225.',
      }),
    ).toBe('Bylaws\nThe fee is $225.');
  });

  it('never leaves half a character: not from the source, and not from its own cut', () => {
    expect(normalizeCorpusText('a\uD83Db\uDE00c')).toBe('abc');
    // 2,399 letters, then an emoji whose two halves straddle the hard cut.
    const text = `${'x'.repeat(2399)}😀${'y'.repeat(50)}`;
    const chunks = chunkSections([{ heading: null, page: null, text }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(stripLoneSurrogates(chunk.content)).toBe(chunk.content);
    }
    expect(chunks.map((chunk) => chunk.content).join('')).toBe(text);
  });
});
