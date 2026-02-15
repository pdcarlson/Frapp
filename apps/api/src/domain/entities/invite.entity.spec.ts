import { Invite } from './invite.entity';

describe('Invite Entity', () => {
  it('should be valid if not used and not expired', () => {
    const invite = new Invite(
      'id',
      'tok',
      'chap',
      'role',
      new Date(Date.now() + 10000),
      'user',
      null,
      new Date(),
    );
    expect(invite.isValid()).toBe(true);
  });

  it('should be invalid if already used', () => {
    const invite = new Invite(
      'id',
      'tok',
      'chap',
      'role',
      new Date(Date.now() + 10000),
      'user',
      new Date(),
      new Date(),
    );
    expect(invite.isValid()).toBe(false);
  });

  it('should be invalid if expired', () => {
    const invite = new Invite(
      'id',
      'tok',
      'chap',
      'role',
      new Date(Date.now() - 10000),
      'user',
      null,
      new Date(),
    );
    expect(invite.isValid()).toBe(false);
  });
});
