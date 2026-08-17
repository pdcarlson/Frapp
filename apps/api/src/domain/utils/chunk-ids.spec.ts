import { ID_CHUNK_SIZE, chunkIds } from './chunk-ids';

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
