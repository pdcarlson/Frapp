import {
  applyNicknameEdit,
  courseEditRefusal,
  mergeCourseNames,
} from './backwork-course-rules';

describe('courseEditRefusal', () => {
  const named = { name: 'Calculus I' };
  const unnamed = { name: null };
  const none: string[] = [];

  it('lets anyone name a course that has no entry yet', () => {
    expect(
      courseEditRefusal(
        null,
        { name: 'Calculus I', removeNicknames: none },
        false,
      ),
    ).toBeNull();
  });

  it('lets an uploader name a course that has no name', () => {
    expect(
      courseEditRefusal(
        unnamed,
        { name: 'Calculus I', removeNicknames: none },
        false,
      ),
    ).toBeNull();
  });

  it('lets an uploader keep a set name (adding nicknames only)', () => {
    expect(
      courseEditRefusal(
        named,
        { name: 'Calculus I', removeNicknames: none },
        false,
      ),
    ).toBeNull();
  });

  it('refuses an uploader changing a set name', () => {
    expect(
      courseEditRefusal(named, { name: 'Calc', removeNicknames: none }, false),
    ).toMatch(/admin/);
  });

  it('refuses an uploader clearing a set name', () => {
    expect(
      courseEditRefusal(named, { name: null, removeNicknames: none }, false),
    ).toMatch(/admin/);
  });

  it('refuses an uploader removing a nickname', () => {
    expect(
      courseEditRefusal(
        named,
        { name: 'Calculus I', removeNicknames: ['Calc 1'] },
        false,
      ),
    ).toMatch(/nickname/);
  });

  it('lets an admin do any of it', () => {
    expect(
      courseEditRefusal(named, { name: null, removeNicknames: ['x'] }, true),
    ).toBeNull();
  });
});

describe('applyNicknameEdit', () => {
  it('applies the delta to the stored list, keeping what someone else added', () => {
    // The editor saw ['Calc 1']; meanwhile someone added 'Calc I'.
    expect(
      applyNicknameEdit(['Calc 1', 'Calc I'], ['Calculus 1'], [], null),
    ).toEqual(['Calc 1', 'Calc I', 'Calculus 1']);
  });

  it('removes case-insensitively and dedupes adds', () => {
    expect(
      applyNicknameEdit(
        ['Calc 1', 'Orgo'],
        ['orgo', 'Calc One'],
        ['calc 1'],
        null,
      ),
    ).toEqual(['Orgo', 'Calc One']);
  });

  it('drops a nickname that repeats the name', () => {
    expect(applyNicknameEdit(['Calc 1'], [], [], 'calc 1')).toEqual([]);
  });
});

describe('mergeCourseNames', () => {
  it("keeps the target's name and adds the source's as a nickname", () => {
    expect(
      mergeCourseNames(
        { name: 'Calculus I', nicknames: ['Calc 1'] },
        { name: 'Calc One', nicknames: ['calc 1', 'Calc I'] },
      ),
    ).toEqual({
      name: 'Calculus I',
      nicknames: ['Calc 1', 'Calc One', 'Calc I'],
    });
  });

  it("takes the source's name when the target has none", () => {
    expect(
      mergeCourseNames(
        { name: null, nicknames: ['Orgo'] },
        { name: 'Organic Chemistry I', nicknames: [] },
      ),
    ).toEqual({ name: 'Organic Chemistry I', nicknames: ['Orgo'] });
  });

  it('drops a losing name too long to be a nickname', () => {
    const long =
      'An Introduction to the Theory and Practice of Organic Synthesis';
    expect(long.length).toBeGreaterThan(60);
    expect(
      mergeCourseNames(
        { name: 'Organic Chemistry I', nicknames: [] },
        { name: long, nicknames: ['Orgo'] },
      ),
    ).toEqual({ name: 'Organic Chemistry I', nicknames: ['Orgo'] });
  });

  it('caps the union at the nickname limit, target first', () => {
    const many = (prefix: string) =>
      Array.from({ length: 15 }, (_, i) => `${prefix}${i}`);
    const merged = mergeCourseNames(
      { name: null, nicknames: many('t') },
      { name: null, nicknames: many('s') },
    );
    expect(merged.nicknames).toHaveLength(20);
    expect(merged.nicknames.slice(0, 15)).toEqual(many('t'));
  });
});
