import { allowedVisibilities } from './custom-field-visibility';

describe('allowedVisibilities', () => {
  it('grants chapter to any directory viewer (baseline member, not self)', () => {
    const allowed = allowedVisibilities(['members:view'], false);
    expect([...allowed].sort()).toEqual(['chapter']);
  });

  it('adds self only when the viewer is the member', () => {
    const allowed = allowedVisibilities(['members:view'], true);
    expect([...allowed].sort()).toEqual(['chapter', 'self']);
  });

  it('treats roles:manage holders as exec (not self)', () => {
    const allowed = allowedVisibilities(
      ['members:view', 'roles:manage'],
      false,
    );
    expect([...allowed].sort()).toEqual(['chapter', 'exec']);
  });

  it('treats members:remove holders as exec', () => {
    const allowed = allowedVisibilities(['members:remove'], false);
    expect([...allowed].sort()).toEqual(['chapter', 'exec']);
  });

  it('grants president + exec to wildcard holders viewing others', () => {
    const allowed = allowedVisibilities(['*'], false);
    expect([...allowed].sort()).toEqual(['chapter', 'exec', 'president']);
  });

  it('does NOT grant self to the president when viewing someone else', () => {
    const allowed = allowedVisibilities(['*'], false);
    expect(allowed.has('self')).toBe(false);
  });

  it('grants all tiers to the president viewing their own profile', () => {
    const allowed = allowedVisibilities(['*'], true);
    expect([...allowed].sort()).toEqual([
      'chapter',
      'exec',
      'president',
      'self',
    ]);
  });

  it('returns chapter only for an empty permission set when not self', () => {
    const allowed = allowedVisibilities([], false);
    expect([...allowed].sort()).toEqual(['chapter']);
  });
});
