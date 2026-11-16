import { decodeJwtSegment, readUnverifiedJwtPayload } from './jwt-segment';

const seg = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

describe('decodeJwtSegment', () => {
  it('decodes a base64url JSON segment', () => {
    expect(decodeJwtSegment(seg({ alg: 'HS256', kid: 'k1' }))).toEqual({
      alg: 'HS256',
      kid: 'k1',
    });
  });

  it('returns JSON that is not an object as is, null included', () => {
    expect(decodeJwtSegment(seg(null))).toBeNull();
    expect(decodeJwtSegment(seg(7))).toBe(7);
    expect(decodeJwtSegment(seg(['a']))).toEqual(['a']);
  });

  it('answers undefined for a segment that is not JSON', () => {
    expect(decodeJwtSegment('')).toBeUndefined();
    expect(decodeJwtSegment('not-json')).toBeUndefined();
    expect(
      decodeJwtSegment(Buffer.from('{"a":', 'utf8').toString('base64url')),
    ).toBeUndefined();
  });
});

describe('readUnverifiedJwtPayload', () => {
  const header = seg({ alg: 'HS256' });

  it('reads the payload of a three-part token without checking the signature', () => {
    expect(
      readUnverifiedJwtPayload(`${header}.${seg({ exp: 1, role: 'x' })}.sig`),
    ).toEqual({ exp: 1, role: 'x' });
  });

  it('accepts an array payload, as typeof does', () => {
    expect(readUnverifiedJwtPayload(`${header}.${seg([1])}.sig`)).toEqual([1]);
  });

  it.each([
    ['two parts', `${header}.${seg({ exp: 1 })}`],
    ['four parts', `${header}.${seg({ exp: 1 })}.sig.extra`],
    ['a null payload', `${header}.${seg(null)}.sig`],
    ['a number payload', `${header}.${seg(5)}.sig`],
    ['a payload that is not JSON', `${header}.nope.sig`],
  ])('answers undefined for %s', (_label, token) => {
    expect(readUnverifiedJwtPayload(token)).toBeUndefined();
  });
});
