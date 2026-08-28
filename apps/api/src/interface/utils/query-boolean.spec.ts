import {
  isBooleanQueryStringValue,
  parseBooleanQueryParam,
} from './query-boolean';

describe('isBooleanQueryStringValue', () => {
  it.each(['true', 'false', '1', '0'] as const)('accepts %s', (literal) => {
    expect(isBooleanQueryStringValue(literal)).toBe(true);
  });

  it('rejects other strings and non-strings', () => {
    expect(isBooleanQueryStringValue('yes')).toBe(false);
    expect(isBooleanQueryStringValue('True')).toBe(false);
    expect(isBooleanQueryStringValue('2')).toBe(false);
    expect(isBooleanQueryStringValue(undefined)).toBe(false);
    expect(isBooleanQueryStringValue(1)).toBe(false);
  });
});

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
