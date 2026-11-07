import { signInMethodOf } from './sign-in-method';

describe('signInMethodOf', () => {
  it('names the three providers the apps offer', () => {
    expect(signInMethodOf({ app_metadata: { provider: 'apple' } })).toBe(
      'apple',
    );
    expect(signInMethodOf({ app_metadata: { provider: 'google' } })).toBe(
      'google',
    );
    expect(signInMethodOf({ app_metadata: { provider: 'email' } })).toBe(
      'email',
    );
  });

  it('folds anything else into other, and no user into null', () => {
    expect(signInMethodOf({ app_metadata: { provider: 'discord' } })).toBe(
      'other',
    );
    expect(signInMethodOf({ app_metadata: {} })).toBe('other');
    expect(signInMethodOf(undefined)).toBeNull();
  });
});
