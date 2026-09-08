import { readDeployedCommit } from './deployed-commit';

describe('readDeployedCommit', () => {
  it('returns undefined when RENDER_GIT_COMMIT is unset', () => {
    expect(readDeployedCommit({})).toBeUndefined();
  });

  it('returns undefined for empty or whitespace-only values', () => {
    expect(readDeployedCommit({ RENDER_GIT_COMMIT: '' })).toBeUndefined();
    expect(readDeployedCommit({ RENDER_GIT_COMMIT: '   ' })).toBeUndefined();
  });

  it('returns a full SHA after trimming', () => {
    expect(
      readDeployedCommit({
        RENDER_GIT_COMMIT: '  0ca478e9105105ff7013834615eee81499813d0e  ',
      }),
    ).toBe('0ca478e9105105ff7013834615eee81499813d0e');
  });

  it('accepts an abbreviated SHA', () => {
    expect(readDeployedCommit({ RENDER_GIT_COMMIT: '0ca478e' })).toBe(
      '0ca478e',
    );
  });

  it('rejects values that are not a git SHA', () => {
    expect(readDeployedCommit({ RENDER_GIT_COMMIT: 'banana' })).toBeUndefined();
    expect(
      readDeployedCommit({ RENDER_GIT_COMMIT: '0ca478e91051 extra' }),
    ).toBeUndefined();
    expect(
      readDeployedCommit({
        RENDER_GIT_COMMIT: 'not-a-sha-even-if-long-enough-0123456789',
      }),
    ).toBeUndefined();
  });
});
