import { ASK_SOURCE_KINDS, type AskSourceKind } from '@repo/validation';
import { AI_MODEL_CATALOG } from './ai-model-catalog';
import {
  AI_CONSENT_SHEET,
  AI_FAMILY_SWITCH,
  type AiConsentSheetDataKind,
} from './ai-consent-sheet';

/**
 * What each sheet version covered: its providers and its kinds of data, by
 * key. A member's Yes is for one version, so changing what a version covers
 * after members answered it would make their Yes cover something they never
 * saw. Add a line here with every new version; never edit an old one.
 */
const SHEET_VERSIONS: Record<number, string> = {
  1: 'providers=anthropic,google;data=questions,chapter_records,roster,channel_messages,meetings',
  // #712: AssemblyAI transcribes a meeting's recording.
  2: 'providers=anthropic,google,assemblyai;data=questions,chapter_records,roster,channel_messages,meetings',
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

/**
 * Which row of the sheet covers each kind of source Ask can put in front of
 * the model (#4787). A new kind fails to compile here until it is mapped, and
 * a kind no row covers is a new version of the sheet, not a mapping.
 */
const ASK_SOURCE_ROW: Record<AskSourceKind, AiConsentSheetDataKind['key']> = {
  document: 'chapter_records',
  minutes: 'meetings',
  chat: 'channel_messages',
  roster: 'roster',
  events: 'chapter_records',
  points: 'roster',
  dues: 'roster',
  tasks: 'chapter_records',
};

describe('Ask sources', () => {
  it('each map to a row the sheet names', () => {
    const rows = new Set<string>(AI_CONSENT_SHEET.data.map((d) => d.key));
    for (const kind of ASK_SOURCE_KINDS) {
      expect(rows).toContain(ASK_SOURCE_ROW[kind]);
    }
  });
});

describe('AI_FAMILY_SWITCH', () => {
  it('puts every catalog task behind a chapter switch', () => {
    for (const entry of Object.values(AI_MODEL_CATALOG)) {
      expect(AI_FAMILY_SWITCH[entry.family]).toBeDefined();
    }
  });
});
