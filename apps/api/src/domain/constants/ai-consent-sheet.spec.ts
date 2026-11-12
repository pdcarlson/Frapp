import { AI_MODEL_CATALOG } from './ai-model-catalog';
import { AI_CONSENT_SHEET, AI_FAMILY_SWITCH } from './ai-consent-sheet';

/**
 * What each sheet version covered: its providers and its kinds of data, by
 * key. A member's Yes is for one version, so changing what a version covers
 * after members answered it would make their Yes cover something they never
 * saw. Add a line here with every new version; never edit an old one.
 */
const SHEET_VERSIONS: Record<number, string> = {
  1: 'providers=anthropic,google;data=questions,chapter_records,roster,channel_messages,meetings',
};

function coverage(): string {
  const providers = AI_CONSENT_SHEET.providers.map((p) => p.key).join(',');
  const data = AI_CONSENT_SHEET.data.map((d) => d.key).join(',');
  return `providers=${providers};data=${data}`;
}

describe('AI_CONSENT_SHEET', () => {
  it('covers exactly what its version was recorded as covering', () => {
    // A provider or a kind of data added without a version bump fails here:
    // bump `version` and add its line to SHEET_VERSIONS.
    expect(SHEET_VERSIONS[AI_CONSENT_SHEET.version]).toBe(coverage());
  });

  it('is the newest recorded version', () => {
    const newest = Math.max(...Object.keys(SHEET_VERSIONS).map(Number));
    expect(AI_CONSENT_SHEET.version).toBe(newest);
  });

  it('names every provider the model catalog sends data to', () => {
    const named = new Set<string>(AI_CONSENT_SHEET.providers.map((p) => p.key));
    const used = new Set<string>(
      Object.values(AI_MODEL_CATALOG).map((entry) => entry.provider),
    );
    for (const provider of used) expect(named).toContain(provider);
  });

  it('has no duplicate keys', () => {
    const providers = AI_CONSENT_SHEET.providers.map((p) => p.key);
    const data = AI_CONSENT_SHEET.data.map((d) => d.key);
    expect(new Set(providers).size).toBe(providers.length);
    expect(new Set(data).size).toBe(data.length);
  });
});

describe('AI_FAMILY_SWITCH', () => {
  it('puts every catalog task behind a chapter switch', () => {
    for (const entry of Object.values(AI_MODEL_CATALOG)) {
      expect(AI_FAMILY_SWITCH[entry.family]).toBeDefined();
    }
  });
});
