import { parseBooleanQueryParam } from './query-boolean';

describe('parseBooleanQueryParam', () => {
  it('returns undefined when the param is omitted', () => {
    expect(parseBooleanQueryParam(undefined)).toBeUndefined();
  });

  it('treats true and 1 as true', () => {
    expect(parseBooleanQueryParam('true')).toBe(true);
    expect(parseBooleanQueryParam('1')).toBe(true);
  });

  it('treats false and 0 as false', () => {
    expect(parseBooleanQueryParam('false')).toBe(false);
    expect(parseBooleanQueryParam('0')).toBe(false);
  });
});
