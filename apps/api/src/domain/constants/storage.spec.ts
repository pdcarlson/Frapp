import { safeObjectFilename } from './storage';

describe('safeObjectFilename', () => {
  it.each([
    // Refused by storage-api (non-ASCII, `%`) or cut by the URL (`#`, `?`).
    // One `_` per offending character, not per run.
    ['Résumé #3 50%.pdf', 'R_sum_ _3 50_.pdf'],
    ['Rush #3.pdf', 'Rush _3.pdf'],
    ['Q1 50% growth.pdf', 'Q1 50_ growth.pdf'],
    ['q?.pdf', 'q_.pdf'],
    ['写真.jpg', '__.jpg'],
    ['say "hi".pdf', 'say _hi_.pdf'],
  ])('squashes storage-unsafe characters in %p', (input, expected) => {
    expect(safeObjectFilename(input)).toBe(expected);
  });

  it.each([
    'bylaws.pdf',
    'Meeting notes (final).pdf',
    "Bob's, A&B! v1.pdf",
    'a+b=c;d@e$f.pdf',
    'x:y*.pdf',
  ])(
    'leaves %p unchanged, since storage-api already accepts it and downloads save under it',
    (input) => {
      expect(safeObjectFilename(input)).toBe(input);
    },
  );

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
