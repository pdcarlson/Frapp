import { AiRunRegistry, type AiRunHandler } from './ai-run-registry';

const handler = (overrides: Partial<AiRunHandler> = {}): AiRunHandler => ({
  kind: 'minutes_draft',
  label: 'Drafting minutes',
  actsForMember: true,
  run: async () => undefined,
  ...overrides,
});

describe('AiRunRegistry', () => {
  it('finds a registered kind, and nothing for another', () => {
    const registry = new AiRunRegistry();
    const minutes = handler();
    registry.register(minutes);
    registry.register(handler({ kind: 'document_index' }));

    expect(registry.get('minutes_draft')).toBe(minutes);
    expect(registry.get('rush_summary')).toBeUndefined();
    expect(registry.kinds()).toEqual(['document_index', 'minutes_draft']);
  });

  it('refuses a kind registered twice', () => {
    const registry = new AiRunRegistry();
    registry.register(handler());
    expect(() => registry.register(handler())).toThrow(/registered twice/);
  });

  it.each(['MinutesDraft', 'minutes-draft', '', '1minutes', 'x'.repeat(49)])(
    'refuses the kind %p',
    (kind) => {
      expect(() => new AiRunRegistry().register(handler({ kind }))).toThrow(
        /snake_case/,
      );
    },
  );

  it.each([0, 11, 2.5])('refuses %p tries', (maxAttempts) => {
    expect(() =>
      new AiRunRegistry().register(handler({ maxAttempts })),
    ).toThrow(/tries/);
  });
});
