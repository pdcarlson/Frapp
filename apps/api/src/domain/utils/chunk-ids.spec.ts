import {
  ID_CHUNK_SIZE,
  IN_FILTER_CHAR_BUDGET,
  chunkByEncodedLength,
  chunkIds,
} from './chunk-ids';

describe('chunkIds', () => {
  it('returns no chunks for an empty list', () => {
    expect(chunkIds([])).toEqual([]);
  });

  it('keeps a list shorter than the chunk size in one batch', () => {
    expect(chunkIds(['a', 'b', 'c'], 10)).toEqual([['a', 'b', 'c']]);
  });

  it('splits an exact multiple into equal batches with no empty tail', () => {
    expect(chunkIds(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('carries the remainder in a final short batch', () => {
    expect(chunkIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });

  it('defaults to ID_CHUNK_SIZE, which is what bounds the request line', () => {
    const ids = Array.from({ length: ID_CHUNK_SIZE + 1 }, (_, i) => `id-${i}`);

    const chunks = chunkIds(ids);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(ID_CHUNK_SIZE);
    expect(chunks[1]).toEqual([`id-${ID_CHUNK_SIZE}`]);
  });
});

describe('chunkByEncodedLength', () => {
  const path = (i: number, name: string) =>
    `chapters/0a000000-0000-4000-8000-000000000001/chat-archive/imports/0a000000-0000-4000-8000-0000000001a0/media/${i}/${name}`;

  it('keeps every batch within the budget, however long the paths', () => {
    // Staging's failing slice: a busy channel's attachments, about 230 paths
    // and a 30 KB request line in one `in` list (#2825).
    const paths = Array.from({ length: 230 }, (_, i) =>
      path(
        i,
        i % 3 === 0 ? `Budget Planner (final, v${i}).xlsm` : `img_${i}.png`,
      ),
    );
    const chunks = chunkByEncodedLength(paths);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(paths);
    for (const chunk of chunks) {
      const encoded = chunk.reduce(
        (sum, value) => sum + encodeURIComponent(value).length + 3,
        0,
      );
      expect(encoded).toBeLessThanOrEqual(IN_FILTER_CHAR_BUDGET);
    }
  });

  it('gives a value longer than the budget a batch of its own', () => {
    const long = 'x'.repeat(IN_FILTER_CHAR_BUDGET + 10);
    expect(chunkByEncodedLength(['a', long, 'b'])).toEqual([
      ['a'],
      [long],
      ['b'],
    ]);
  });

  it('returns no chunks for an empty list', () => {
    expect(chunkByEncodedLength([])).toEqual([]);
  });
});
