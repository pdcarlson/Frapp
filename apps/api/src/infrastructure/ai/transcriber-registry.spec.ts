import { AssemblyAiTranscriber } from './assemblyai-transcriber';
import { GoogleTranscriber } from './google-transcriber';
import { ScriptedTranscriber } from './scripted-transcriber';
import { buildTranscriberRegistry } from './transcriber-registry';

const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'frapp-test',
  client_email: 'test@frapp-test.iam.gserviceaccount.com',
  private_key: 'not-a-key',
});

describe('buildTranscriberRegistry', () => {
  it('has no transcriber where there is no credential', () => {
    const registry = buildTranscriberRegistry({});
    expect(registry.resolve('assemblyai')).toBeNull();
    expect(registry.resolve('google')).toBeNull();
    expect(registry.resolve('anthropic')).toBeNull();
  });

  it('builds each vendor from its own credential', () => {
    const registry = buildTranscriberRegistry({
      ASSEMBLYAI_API_KEY: 'test-key-not-a-secret',
      GOOGLE_VERTEX_PROJECT: 'frapp-test',
      GOOGLE_VERTEX_CREDENTIALS_JSON: SERVICE_ACCOUNT,
    });
    expect(registry.resolve('assemblyai')).toBeInstanceOf(
      AssemblyAiTranscriber,
    );
    expect(registry.resolve('google')).toBeInstanceOf(GoogleTranscriber);
  });

  it('treats a blank key as no key', () => {
    expect(
      buildTranscriberRegistry({ ASSEMBLYAI_API_KEY: '  ' }).resolve(
        'assemblyai',
      ),
    ).toBeNull();
  });

  it('answers every vendor with the scripted transcriber in scripted mode, keys or not', () => {
    const registry = buildTranscriberRegistry({
      AI_PROVIDER: 'scripted',
      ASSEMBLYAI_API_KEY: 'test-key-not-a-secret',
    });
    expect(registry.resolve('assemblyai')).toBeInstanceOf(ScriptedTranscriber);
    expect(registry.resolve('google')).toBeInstanceOf(ScriptedTranscriber);
  });
});

describe('ScriptedTranscriber', () => {
  it('returns a fixed meeting with several speakers and the roster’s names, with no network', async () => {
    const result = await new ScriptedTranscriber(0).transcribe({
      task: 'meetings.transcribe',
      model: 'scripted',
      audio: {
        url: 'http://unused.test',
        read: () => Promise.reject(new Error('never read')),
        mimeType: 'audio/mp4',
        sizeBytes: 1,
        durationSeconds: 720,
      },
      maxSeconds: 7200,
      vocabulary: ['Priya Natarajan', 'Marcus Ellison'],
      resumeJobId: null,
      onJobStarted: () => Promise.resolve(),
    });
    expect(result.durationSeconds).toBe(720);
    expect(
      new Set(result.utterances.map((u) => u.speaker)).size,
    ).toBeGreaterThan(1);
    expect(result.utterances.map((u) => u.text).join(' ')).toContain(
      'Priya Natarajan',
    );
  });
});

describe('GoogleTranscriber', () => {
  it('sends the file inline with speaker labels and reads the turns back', async () => {
    const generateContent = jest.fn().mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                audioTranscription: {
                  text: 'Call to order.',
                  speakerLabel: 'spk_1',
                  startOffset: '0s',
                  endOffset: '2.5s',
                },
              },
              {
                audioTranscription: { text: 'Second.', speakerLabel: 'spk_2' },
              },
            ],
          },
        },
      ],
    });
    const transcriber = new GoogleTranscriber({
      models: { generateContent },
    });
    expect(transcriber.limits.maxDurationSeconds).toBe(30 * 60);
    const result = await transcriber.transcribe({
      task: 'meetings.transcribe',
      model: 'gemini-3.5-transcribe',
      audio: {
        url: 'http://unused.test',
        read: () => Promise.resolve(new Uint8Array([1, 2, 3])),
        mimeType: 'audio/mp4',
        sizeBytes: 3,
        durationSeconds: 600,
      },
      maxSeconds: 1800,
      vocabulary: ['Priya Natarajan'],
      resumeJobId: null,
      onJobStarted: () => Promise.resolve(),
    });
    expect(result.durationSeconds).toBe(600);
    expect(result.utterances.map((u) => [u.speaker, u.text])).toEqual([
      ['spk_1', 'Call to order.'],
      ['spk_2', 'Second.'],
    ]);
    const sent = generateContent.mock.calls[0][0];
    expect(sent.model).toBe('gemini-3.5-transcribe');
    expect(sent.contents[0].parts[0].inlineData).toEqual({
      mimeType: 'audio/mp4',
      data: 'AQID',
    });
    expect(sent.config.audioTranscriptionConfig).toEqual({
      diarization: true,
      customVocabulary: ['Priya Natarajan'],
    });
  });
});
