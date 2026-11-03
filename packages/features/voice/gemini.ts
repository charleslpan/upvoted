import { config } from '@upvoted/lib/config';
import { generateSpeech, type SpeechModel } from 'ai';
import type { DialogueRequest, SpeechAdapter } from './speech';

/** Retries per call for transient errors (429s and 5xxs), on top of the first attempt. */
const MAX_RETRIES = 3;

/**
 * The `generateSpeech` options for a Gemini call, with the show-wide style as `instructions`.
 *
 * One speaker (the host alone) uses single-speaker mode: the lines as plain `text` in that
 * speaker's prebuilt `voice`. Two speakers (the host and a correspondent) use two-speaker mode:
 * both voices in `multiSpeakerVoiceConfig` and the lines as `turns`, where a turn's own `style`
 * overrides the instructions. `text` is then empty because `turns` carries the transcript.
 */
export function geminiSpeechOptions(request: DialogueRequest) {
  const [only, ...others] = request.speakers;
  if (only && others.length === 0) {
    return {
      text: request.turns.map((turn) => turn.text).join('\n\n'),
      voice: only.voice,
      outputFormat: 'wav',
      instructions: request.instructions,
    };
  }
  if (request.speakers.length !== 2) {
    throw new Error(`Gemini voices one or two speakers, not ${request.speakers.length}`);
  }
  return {
    text: '',
    outputFormat: 'wav',
    instructions: request.instructions,
    providerOptions: {
      google: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: request.speakers.map((speaker) => ({
            speaker: speaker.name,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker.voice } },
          })),
        },
        turns: request.turns.map((turn) => ({
          text: turn.text,
          speechMetadata: turn.style
            ? { speaker: turn.speaker, style: turn.style }
            : { speaker: turn.speaker },
        })),
      },
    },
  };
}

/**
 * Gemini TTS through Vercel AI Gateway. A string model id goes to the gateway, which
 * authenticates with Vercel's OIDC token when deployed and `AI_GATEWAY_API_KEY` locally.
 */
export function geminiAdapter(model: SpeechModel = config.tts.model): SpeechAdapter {
  return {
    name: typeof model === 'string' ? model : model.modelId,
    async synthesize(request, { abortSignal }) {
      const result = await generateSpeech({
        model,
        ...geminiSpeechOptions(request),
        maxRetries: MAX_RETRIES,
        abortSignal,
      });
      for (const warning of result.warnings) {
        console.warn(`  TTS warning: ${JSON.stringify(warning)}`);
      }
      return result.audio.uint8Array;
    },
  };
}
