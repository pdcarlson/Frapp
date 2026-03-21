import { describe, it, expect } from 'vitest';
import { joinClassNames } from './utils';

describe('joinClassNames', () => {
  it('joins strings with spaces', () => {
    expect(joinClassNames('class1', 'class2', 'class3')).toBe('class1 class2 class3');
  });

  it('filters out undefined values', () => {
    expect(joinClassNames('class1', undefined, 'class2')).toBe('class1 class2');
  });

  it('filters out empty strings', () => {
    expect(joinClassNames('class1', '', 'class2')).toBe('class1 class2');
  });

  it('filters out null or other falsy values correctly if they somehow get in despite types', () => {
    // We suppress type checking to test the runtime behavior of filter(Boolean)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    expect(joinClassNames('class1', null, false, 0, 'class2')).toBe('class1 class2');
  });

  it('returns empty string when no arguments provided', () => {
    expect(joinClassNames()).toBe('');
  });

  it('returns empty string when only undefined or falsy arguments provided', () => {
    expect(joinClassNames(undefined, '')).toBe('');
  });
});
