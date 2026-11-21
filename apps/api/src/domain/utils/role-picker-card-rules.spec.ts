import { normalizeRolePickerCard } from './role-picker-card-rules';

const A = '8C03ECD4-267A-40D7-B887-10E3A6206D08';
const B = 'dd475c2c-efb4-4890-8446-d274fb8e19a7';

describe('normalizeRolePickerCard (#4958)', () => {
  it('keeps the title and the role ids, lower-cased and once each', () => {
    expect(
      normalizeRolePickerCard({
        title: '  Teams ',
        role_ids: [A, B, A.toLowerCase()],
        closed_at: 'x',
      }),
    ).toEqual({
      card: { title: 'Teams', role_ids: [A.toLowerCase(), B] },
    });
  });

  it('gives an untitled picker the default title', () => {
    expect(normalizeRolePickerCard({ role_ids: [B] })).toEqual({
      card: { title: 'Pick your roles', role_ids: [B] },
    });
  });

  it('refuses a picker with no roles, a bad id, too many, or a long title', () => {
    const ids = Array.from(
      { length: 26 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    for (const payload of [
      null,
      [],
      { title: 'T' },
      { title: 'T', role_ids: [] },
      { title: 'T', role_ids: ['not-a-uuid'] },
      { title: 'T', role_ids: ids },
      { title: 'x'.repeat(101), role_ids: [B] },
      { title: 3, role_ids: [B] },
    ]) {
      expect('error' in normalizeRolePickerCard(payload)).toBe(true);
    }
  });
});
