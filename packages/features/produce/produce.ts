import { getJson, keys, putFile, putJson } from '@upvoted/lib/storage';
import {
  type EpisodeAudio,
  type EpisodeRecord,
  type EpisodeStory,
  type Script,
  type ScriptDraft,
  ScriptSchema,
} from '@upvoted/types';
import { episodeRecord, publishEpisode } from '../episodes';
import { buildScript, renderTranscript } from '../script';
import { lookupStories } from '../stories';
import { voiceSegment } from '../voice';

/**
 * The stages of `publish_episode`, each small enough to be its own durable step: save the
 * script, voice each segment, then (after the mix) publish. They pass dates, indexes, storage
 * keys and contract types; the script travels through storage.
 */

/**
 * Looks up the stories on HN by id, finishes the draft with their links and show notes, and
 * saves `script.json` and `transcript.md`. Call it only with a draft `checkScript` passed.
 */
export async function saveScript(
  draft: ScriptDraft,
  storyIds: number[],
): Promise<{ date: string; segmentCount: number; stories: EpisodeStory[] }> {
  const stories = await lookupStories(storyIds);
  const script = buildScript(draft, stories);
  await putJson(keys.script(script.date), script);
  await putFile(
    keys.transcript(script.date),
    renderTranscript(script),
    'text/markdown; charset=utf-8',
  );
  return { date: script.date, segmentCount: script.segments.length, stories };
}

/** Voices segment `index` of the saved script and returns its storage key. */
export async function voiceSavedSegment(date: string, index: number): Promise<string> {
  const segment = (await loadScript(date)).segments[index];
  if (!segment) throw new Error(`${keys.script(date)} has no segment ${index}`);
  return (await voiceSegment(date, index, segment)).key;
}

/** Adds the mixed episode to the index. */
export async function publishSaved(
  date: string,
  stories: EpisodeStory[],
  audio: EpisodeAudio,
): Promise<EpisodeRecord> {
  const record = episodeRecord(await loadScript(date), stories, audio, new Date());
  await publishEpisode(record);
  return record;
}

async function loadScript(date: string): Promise<Script> {
  const script = await getJson(keys.script(date), ScriptSchema);
  if (!script) throw new Error(`No ${keys.script(date)}`);
  return script;
}
