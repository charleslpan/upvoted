import {
  episodeRecord,
  findEpisode,
  loadExcludeIds,
  publishEpisode,
} from '@upvoted/features/episodes';
import {
  assembleScript,
  renderTranscript,
  writeBookends,
  writeStorySegment,
} from '@upvoted/features/script';
import { gatherStory, selectionTime, selectStories } from '@upvoted/features/stories';
import { mixEpisode, voiceSegment } from '@upvoted/features/voice';
import { getJson, keys, putFile, putJson } from '@upvoted/lib/storage';
import {
  type Brief,
  BriefSchema,
  type EpisodeAudio,
  type Script,
  ScriptSchema,
  type Segment,
  type Story,
  type StoryRef,
} from '@upvoted/types';

/**
 * Makes and publishes the episode for `date` (YYYY-MM-DD). Does nothing when that date's episode
 * is already published, so a re-run changes nothing.
 *
 * Each step is a thin wrapper around @upvoted/features that passes small JSON: dates, ids,
 * storage keys and contract types. The brief and the script travel through storage. A step that
 * throws is retried with the SDK's defaults; one that keeps failing fails the run, before
 * anything is published.
 */
export async function dailyEpisode(date: string) {
  'use workflow';

  if (await isPublished(date)) return { date, status: 'already published' as const };

  const refs = await selectStep(date);
  const stories = await Promise.all(refs.map((ref) => gatherStep(ref)));
  await saveBriefStep(date, stories);

  const storySegments = await Promise.all(refs.map((_, index) => writeStoryStep(date, index)));
  const script = await writeScriptStep(date, storySegments);

  const segmentKeys = await Promise.all(script.segments.map((_, index) => voiceStep(date, index)));
  const audio = await mixStep(date, segmentKeys);

  await publishStep(date, audio);
  return { date, status: 'published' as const, audio };
}

async function isPublished(date: string): Promise<boolean> {
  'use step';
  return (await findEpisode(date)) !== null;
}

async function selectStep(date: string): Promise<StoryRef[]> {
  'use step';
  const at = selectionTime(date, new Date());
  return selectStories(at, await loadExcludeIds(at));
}

async function gatherStep(ref: StoryRef): Promise<Story> {
  'use step';
  return gatherStory(ref);
}

async function saveBriefStep(date: string, stories: Story[]): Promise<void> {
  'use step';
  const brief = BriefSchema.parse({ date, generatedAt: new Date().toISOString(), stories });
  await putJson(keys.brief(date), brief);
}

async function writeStoryStep(date: string, index: number): Promise<Segment> {
  'use step';
  return writeStorySegment(await loadBrief(date), index);
}

/** Writes the intro and sign-off, then saves `script.json` and `transcript.md`. */
async function writeScriptStep(
  date: string,
  stories: Segment[],
): Promise<{ segments: { kind: Segment['kind'] }[] }> {
  'use step';
  const brief = await loadBrief(date);
  const { intro, signoff } = await writeBookends(brief, stories);
  const script = ScriptSchema.parse(assembleScript(brief, intro, stories, signoff));
  await putJson(keys.script(date), script);
  await putFile(keys.transcript(date), renderTranscript(script), 'text/markdown; charset=utf-8');
  return { segments: script.segments.map(({ kind }) => ({ kind })) };
}

async function voiceStep(date: string, index: number): Promise<string> {
  'use step';
  const segment = (await loadScript(date)).segments[index];
  if (!segment) throw new Error(`${keys.script(date)} has no segment ${index}`);
  const { key } = await voiceSegment(date, index, segment);
  return key;
}

async function mixStep(date: string, segmentKeys: string[]): Promise<EpisodeAudio> {
  'use step';
  return mixEpisode(date, segmentKeys);
}

async function publishStep(date: string, audio: EpisodeAudio): Promise<void> {
  'use step';
  const [brief, script] = await Promise.all([loadBrief(date), loadScript(date)]);
  await publishEpisode(episodeRecord(brief, script, audio, new Date()));
}

async function loadBrief(date: string): Promise<Brief> {
  const brief = await getJson(keys.brief(date), BriefSchema);
  if (!brief) throw new Error(`No ${keys.brief(date)}`);
  return brief;
}

async function loadScript(date: string): Promise<Script> {
  const script = await getJson(keys.script(date), ScriptSchema);
  if (!script) throw new Error(`No ${keys.script(date)}`);
  return script;
}
