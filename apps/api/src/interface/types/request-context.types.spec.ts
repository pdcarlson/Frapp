import {
  getOptionalChapterId,
  type RequestContext,
} from './request-context.types';

const CHAPTER_A = '11111111-1111-4111-8111-111111111111';
const CHAPTER_B = '22222222-2222-4222-8222-222222222222';

function request(
  overrides: Partial<
    Pick<RequestContext, 'chapterId' | 'jwtClaims' | 'headers'>
  > = {},
): Pick<RequestContext, 'chapterId' | 'jwtClaims' | 'headers'> {
  return {
    headers: {},
    ...overrides,
  };
}

describe('getOptionalChapterId', () => {
  it('returns undefined when no chapter is in context', () => {
    expect(getOptionalChapterId(request())).toBeUndefined();
  });

  it('reads x-chapter-id when the JWT claim is absent', () => {
    expect(
      getOptionalChapterId(request({ headers: { 'x-chapter-id': CHAPTER_A } })),
    ).toBe(CHAPTER_A);
  });

  it('prefers the JWT active_chapter_id claim over the header', () => {
    expect(
      getOptionalChapterId(
        request({
          jwtClaims: { active_chapter_id: CHAPTER_A },
          headers: { 'x-chapter-id': CHAPTER_B },
        }),
      ),
    ).toBe(CHAPTER_A);
  });

  it('prefers ChapterGuard-resolved request.chapterId over JWT and header', () => {
    expect(
      getOptionalChapterId(
        request({
          chapterId: CHAPTER_A,
          jwtClaims: { active_chapter_id: CHAPTER_B },
          headers: { 'x-chapter-id': CHAPTER_B },
        }),
      ),
    ).toBe(CHAPTER_A);
  });

  it('does not 403 on a JWT/header mismatch — identity still needs the user digest', () => {
    expect(() =>
      getOptionalChapterId(
        request({
          jwtClaims: { active_chapter_id: CHAPTER_A },
          headers: { 'x-chapter-id': CHAPTER_B },
        }),
      ),
    ).not.toThrow();
  });
});
