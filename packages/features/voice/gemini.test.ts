import { MockSpeechModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { fakeAdapter } from './fake';
import { geminiAdapter, geminiSpeechOptions } from './gemini';
import { dialogueRequest } from './speech';

const maya = { name: 'Maya', voice: 'Sulafat' };
const theo = { name: 'Theo', voice: 'Charon' };

describe('geminiSpeechOptions', () => {
  it("uses single-speaker mode, in the speaker's voice, for one speaker", () => {
    const request = dialogueRequest(
      [maya],
      [
        { speaker: 'Maya', text: 'Good morning.' },
        { speaker: 'Maya', text: 'Stick around.', style: 'serious and measured' },
      ],
    );
    expect(geminiSpeechOptions(request)).toEqual({
      text: 'Good morning.\n\nStick around.',
      voice: 'Sulafat',
      outputFormat: 'wav',
      instructions: request.instructions,
    });
  });

  it('refuses more than two speakers', () => {
    const request = dialogueRequest([maya, theo, { name: 'Nadia', voice: 'Erinome' }], []);
    expect(() => geminiSpeechOptions(request)).toThrow(/one or two speakers/);
  });
});

describe('geminiAdapter', () => {
  it('sends a two-speaker request with turns, styles and the show-wide instructions', async () => {
    const wav = await fakeAdapter().synthesize(
      dialogueRequest([maya], [{ speaker: 'Maya', text: 'Hi' }]),
      { abortSignal: AbortSignal.timeout(1_000) },
    );
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

    const request = dialogueRequest(
      [maya, theo],
      [
        { speaker: 'Maya', text: 'Good morning.' },
        { speaker: 'Theo', text: 'Big day.', style: 'serious and measured' },
      ],
    );
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
            { speaker: 'Theo', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
          ],
        },
        turns: [
          { text: 'Good morning.', speechMetadata: { speaker: 'Maya' } },
          {
            text: 'Big day.',
            speechMetadata: { speaker: 'Theo', style: 'serious and measured' },
          },
        ],
      },
    });
  });
});
