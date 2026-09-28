import { safeObjectFilename } from './storage';

describe('safeObjectFilename', () => {
  it.each([
    ['bylaws.pdf', 'bylaws.pdf'],
    ['Q1_report-v2.final.xlsx', 'Q1_report-v2.final.xlsx'],
    // One `_` per offending character, not per run: the name stays as long as
    // the original, which keeps two similar names from collapsing together.
    ['Résumé #3 50%.pdf', 'R_sum___3_50_.pdf'],
    ['Rush #3.pdf', 'Rush__3.pdf'],
    ['Q1 50% growth.pdf', 'Q1_50__growth.pdf'],
  ])('squashes storage-unsafe characters in %p', (input, expected) => {
    expect(safeObjectFilename(input)).toBe(expected);
  });

  it.each([
    ['../../x.pdf', 'x.pdf'],
    ['/etc/passwd.png', 'passwd.png'],
    ['a/b/c.jpg', 'c.jpg'],
  ])('drops the directory part of %p', (input, expected) => {
    expect(safeObjectFilename(input)).toBe(expected);
  });

  it('squashes a backslash rather than treating it as a separator', () => {
    // posix basename leaves `\` alone, so a Windows-style path survives the
    // first step; the squash is what keeps it out of the key.
    expect(safeObjectFilename('..\\..\\x.pdf')).toBe('.._.._x.pdf');
  });

  it('squashes percent-encoded separators, so they never reach storage as `/`', () => {
    expect(safeObjectFilename('..%2f..%2fx.pdf')).toBe('.._2f.._2fx.pdf');
  });
});
