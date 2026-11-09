import { courseEditRefusal, mergeCourseNames } from './backwork-course-rules';

describe('courseEditRefusal', () => {
  const named = { name: 'Calculus I', nicknames: ['Calc 1'] };
  const unnamed = { name: null, nicknames: ['Calc 1'] };

  it('lets anyone name a course that has no entry yet', () => {
    expect(
      courseEditRefusal(null, { name: 'Calculus I', nicknames: [] }, false),
    ).toBeNull();
  });

  it('lets an uploader name a course that has no name', () => {
    expect(
      courseEditRefusal(
        unnamed,
        { name: 'Calculus I', nicknames: ['Calc 1'] },
        false,
      ),
    ).toBeNull();
  });

  it('lets an uploader add nicknames', () => {
    expect(
      courseEditRefusal(
        named,
        { name: 'Calculus I', nicknames: ['Calc 1', 'Calc I'] },
        false,
      ),
    ).toBeNull();
  });

  it('refuses an uploader changing a set name', () => {
    expect(
      courseEditRefusal(named, { name: 'Calc', nicknames: ['Calc 1'] }, false),
    ).toMatch(/admin/);
  });

  it('refuses an uploader clearing a set name', () => {
    expect(
      courseEditRefusal(named, { name: null, nicknames: ['Calc 1'] }, false),
    ).toMatch(/admin/);
  });

  it('refuses an uploader removing a nickname', () => {
    expect(
      courseEditRefusal(named, { name: 'Calculus I', nicknames: [] }, false),
    ).toMatch(/nickname/);
  });

  it('does not count a nickname that became the name as removed', () => {
    expect(
      courseEditRefusal(unnamed, { name: 'Calc 1', nicknames: [] }, false),
    ).toBeNull();
  });

  it('lets an admin do any of it', () => {
    expect(
      courseEditRefusal(named, { name: null, nicknames: [] }, true),
    ).toBeNull();
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
