import { MockSpeechModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { fakeAdapter } from './fake';
import { geminiAdapter } from './gemini';
import { dialogueRequest } from './speech';

describe('geminiAdapter', () => {
  it('sends a two-speaker request with turns, styles and the show-wide instructions', async () => {
    const wav = await fakeAdapter().synthesize(dialogueRequest([{ speaker: 'Maya', text: 'Hi' }]), {
      abortSignal: AbortSignal.timeout(1_000),
    });
    const calls: Parameters<MockSpeechModelV4['doGenerate']>[0][] = [];
    const model = new MockSpeechModelV4({
      modelId: 'google/gemini-3.8-flash-lite-tts',
      doGenerate: async (options) => {
        calls.push(options);
        return {
          audio: wav,
          warnings: [],
          response: { timestamp: new Date(), modelId: 'google/gemini-3.8-flash-lite-tts' },
        };
      },
    });

    const request = dialogueRequest([
      { speaker: 'Maya', text: 'Good morning.' },
      { speaker: 'Theo', text: 'Big day.', style: 'excited and energetic' },
    ]);
    const audio = await geminiAdapter(model).synthesize(request, {
      abortSignal: AbortSignal.timeout(1_000),
    });

    expect(Buffer.from(audio)).toEqual(Buffer.from(wav));
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.text).toBe('');
    expect(call?.outputFormat).toBe('wav');
    expect(call?.instructions).toBe(request.instructions);
    expect(call?.providerOptions).toEqual({
      google: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: 'Maya', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } } },
            { speaker: 'Theo', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Achird' } } },
          ],
        },
        turns: [
          { text: 'Good morning.', speechMetadata: { speaker: 'Maya' } },
          {
            text: 'Big day.',
            speechMetadata: { speaker: 'Theo', style: 'excited and energetic' },
          },
        ],
      },
    });
  });
});
