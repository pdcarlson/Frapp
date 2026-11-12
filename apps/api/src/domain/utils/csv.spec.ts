import { SERVICE_COLUMNS } from '#domain/constants/report-columns';
import { toCSV } from './csv';

describe('toCSV', () => {
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'age', header: 'Age' },
    { key: 'city', header: 'City' },
  ];

  it('should generate basic CSV with header and data rows', () => {
    const rows = [
      { name: 'Alice', age: 30, city: 'NYC' },
      { name: 'Bob', age: 25, city: 'LA' },
    ];
    const result = toCSV(rows, columns);
    expect(result).toBe('Name,Age,City\r\nAlice,30,NYC\r\nBob,25,LA');
  });

  it('should escape values containing commas', () => {
    const rows = [{ name: 'Doe, John', age: 40, city: 'Boston' }];
    const result = toCSV(rows, columns);
    expect(result).toBe('Name,Age,City\r\n"Doe, John",40,Boston');
  });

  it('should escape values containing quotes', () => {
    const rows = [{ name: "O'Brien", age: 35, city: 'Chicago' }];
    const result = toCSV(rows, columns);
    expect(result).toContain("O'Brien");
    const rowsWithQuotes = [{ name: 'Say "hello"', age: 20, city: 'Miami' }];
    const result2 = toCSV(rowsWithQuotes, columns);
    expect(result2).toBe('Name,Age,City\r\n"Say ""hello""",20,Miami');
  });

  it('should escape values containing newlines', () => {
    const rows = [{ name: 'Line1\nLine2', age: 22, city: 'Seattle' }];
    const result = toCSV(rows, columns);
    expect(result).toBe('Name,Age,City\r\n"Line1\nLine2",22,Seattle');
  });

  it('should handle empty rows array', () => {
    const result = toCSV([], columns);
    expect(result).toBe('Name,Age,City');
  });

  it('should handle null and undefined values', () => {
    const rows = [
      { name: 'Alice', age: null, city: undefined },
      { name: null, age: 25, city: 'LA' },
    ];
    const result = toCSV(rows, columns);
    expect(result).toBe('Name,Age,City\r\nAlice,,\r\n,25,LA');
  });

  it('should handle arrays by joining with comma and space', () => {
    const cols = [{ key: 'tags', header: 'Tags' }];
    const rows = [{ tags: ['a', 'b', 'c'] }];
    const result = toCSV(rows, cols);
    expect(result).toBe('Tags\r\n"a, b, c"');
  });

  it('should handle objects by JSON stringifying', () => {
    const cols = [{ key: 'meta', header: 'Meta' }];
    const rows = [{ meta: { foo: 'bar' } }];
    const result = toCSV(rows, cols);
    expect(result).toBe('Meta\r\n"{""foo"":""bar""}"');
  });

  // #3976: a member-typed cell a spreadsheet would run as a formula (CSV
  // injection) gets the same apostrophe the dashboard's export adds.
  describe('formula-shaped cells', () => {
    it('makes a member-typed formula inert in a real report row', () => {
      const rows = [
        {
          member_name: '=HYPERLINK("https://evil.example","Click")',
          date: '2026-11-10',
          duration_minutes: 90,
          description: '@SUM(A1:A9)',
          status: '+approved',
        },
      ];
      const result = toCSV(rows, SERVICE_COLUMNS);
      expect(result.split('\r\n')[1]).toBe(
        `"'=HYPERLINK(""https://evil.example"",""Click"")",2026-11-10,90,'@SUM(A1:A9),'+approved`,
      );
    });

    it('prefixes a leading tab or carriage return, then quotes the CR', () => {
      const cols = [{ key: 'v', header: 'V' }];
      expect(toCSV([{ v: '\t=1+1' }], cols)).toBe("V\r\n'\t=1+1");
      expect(toCSV([{ v: '\r=1+1' }], cols)).toBe('V\r\n"\'\r=1+1"');
    });

    it('makes a formula inert inside an array cell', () => {
      const cols = [{ key: 'roles', header: 'Roles' }];
      expect(toCSV([{ roles: ['=1+1', 'Member'] }], cols)).toBe(
        'Roles\r\n"\'=1+1, Member"',
      );
    });

    it('leaves negative numbers and currency amounts as values', () => {
      const cols = [
        { key: 'n', header: 'N' },
        { key: 's', header: 'S' },
        { key: 'c', header: 'C' },
      ];
      expect(toCSV([{ n: -5, s: '-12.50', c: '-$12.00' }], cols)).toBe(
        'N,S,C\r\n-5,-12.50,-$12.00',
      );
    });

    it('applies to a header too', () => {
      expect(toCSV([], [{ key: 'x', header: '-Points' }])).toBe("'-Points");
    });
  });
});
