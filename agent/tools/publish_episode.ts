import { publishSaved, saveScript, voiceSavedSegment } from '@upvoted/features/produce';
import { checkScript } from '@upvoted/features/script';
import { mixEpisode } from '@upvoted/features/voice';
import { config } from '@upvoted/lib/config';
import type { EpisodeAudio, EpisodeStory, ScriptDraft } from '@upvoted/types';
import { defineWorkflowTool } from 'eve/tools';
import { type ScriptInput, ScriptInputSchema } from '../lib/script-input';
import { selection } from '../lib/selection';

/**
 * Publishes the episode as a durable workflow: save the script (links and show notes looked up
 * from HN), voice every segment in parallel, mix, publish. Each step is its own function call,
 * well inside Vercel Hobby's 300-second limit, and is retried on failure; nothing is published
 * unless every step before it succeeded.
 */
export default defineWorkflowTool({
  description:
    'Publishes the episode: saves the script and transcript, voices and mixes it, and adds it to ' +
    'the site. Call it once, with the exact script check_script passed. Returns the episode URL.',
  inputSchema: ScriptInputSchema,
  // The re-check runs before the workflow starts, where this session's selection is readable.
  approval: ({ toolInput }) => {
    const input = toolInput as Partial<ScriptInput> | undefined;
    const problems = checkScript(input?.script, input?.storyIds ?? [], selection.get());
    if (problems.length === 0) return 'not-applicable';
    return {
      type: 'denied',
      reason: `Not published. Fix these, then call check_script again:\n- ${problems.join('\n- ')}`,
    };
  },
  async execute({ script, storyIds }) {
    'use workflow';
    const saved = await saveScriptStep(script, storyIds);
    const segmentKeys = await Promise.all(
      Array.from({ length: saved.segmentCount }, (_, index) => voiceStep(saved.date, index)),
    );
    const audio = await mixStep(saved.date, segmentKeys);
    return publishStep(saved.date, saved.stories, audio);
  },
});

async function saveScriptStep(script: ScriptDraft, storyIds: number[]) {
  'use step';
  return saveScript(script, storyIds);
}

async function voiceStep(date: string, index: number): Promise<string> {
  'use step';
  return voiceSavedSegment(date, index);
}

async function mixStep(date: string, segmentKeys: string[]): Promise<EpisodeAudio> {
  'use step';
  return mixEpisode(date, segmentKeys);
}

async function publishStep(date: string, stories: EpisodeStory[], audio: EpisodeAudio) {
  'use step';
  const record = await publishSaved(date, stories, audio);
  console.log(`publish_episode ${date}: ${audio.url} (${Math.round(audio.durationSec)}s)`);
  return {
    date,
    title: record.title,
    episodeUrl: config.show.siteUrl,
    audioUrl: audio.url,
    durationSec: Math.round(audio.durationSec),
  };
}
