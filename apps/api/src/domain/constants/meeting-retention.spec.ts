import {
  MEETING_NOTES_RETENTION_DAYS,
  meetingRetentionCutoff,
} from './meeting-retention';

describe('meeting retention', () => {
  it('keeps notes and recordings for 30 days (spec/behavior/meetings.md § Retention)', () => {
    expect(MEETING_NOTES_RETENTION_DAYS).toBe(30);
  });

  it('cuts off exactly the retention window before now', () => {
    expect(
      meetingRetentionCutoff(
        new Date('2026-12-31T12:34:56.789Z'),
      ).toISOString(),
    ).toBe('2026-12-01T12:34:56.789Z');
  });

  it('does not mutate the date it is given', () => {
    const now = new Date('2026-12-31T00:00:00.000Z');
    meetingRetentionCutoff(now);
    expect(now.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });
});
