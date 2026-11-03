import './env';
import { parseArgs } from 'node:util';
import { loadExcludeIds, publishEpisode } from '@upvoted/features/episodes';
import {
  assembleScript,
  renderTranscript,
  writeBookends,
  writeStorySegment,
} from '@upvoted/features/script';
import { gatherStory, selectStories } from '@upvoted/features/stories';
import { mixEpisode, voiceSegment } from '@upvoted/features/voice';
import { config } from '@upvoted/lib/config';
import { episodeDate } from '@upvoted/lib/dates';
import { NotImplementedError } from '@upvoted/lib/errors';
import { describeStorage, getJson, keys, putFile, putJson } from '@upvoted/lib/storage';
import {
  type Brief,
  BriefSchema,
  EpisodeDateSchema,
  type EpisodeRecord,
  type Script,
  ScriptSchema,
} from '@upvoted/types';
import type { z } from 'zod';

/**
 * Runs the pipeline locally, step by step, through @upvoted/lib/storage: local files under out/
 * by default, or Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
 */

const STAGES = ['gather', 'write', 'voice', 'mix', 'publish'] as const;
type Stage = (typeof STAGES)[number];
/** Stages a run can start at; publish needs the mix's result, which isn't saved on its own. */
const START_STAGES = ['gather', 'write', 'voice', 'mix'] as const;

/** The daily cron fires in this hour (UTC). */
const CRON_HOUR_UTC = 8;

const USAGE = `Usage: pnpm episode [--date YYYY-MM-DD] [--from STAGE] [--until STAGE]

Stages, in order: ${STAGES.join(', ')}.

  --date   Episode date. Default: today in ${config.show.timezone}. Stories are picked from
           the 24 hours before ${CRON_HOUR_UTC}:00 UTC that day (or before now, if that is
           still ahead), as the daily cron picks them.
  --from   First stage to run (${START_STAGES.join(', ')}); earlier stages' output is read
           from storage. Default: gather.
  --until  Last stage to run. Default: publish.`;

class UsageError extends Error {}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      date: { type: 'string' },
      from: { type: 'string' },
      until: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const now = new Date();
  const date = values.date ?? episodeDate(now);
  if (!EpisodeDateSchema.safeParse(date).success) {
    throw new UsageError(`--date must be a date as YYYY-MM-DD, not ${JSON.stringify(date)}`);
  }
  const from = parseStage(values.from ?? 'gather', '--from', START_STAGES);
  const until = parseStage(values.until ?? 'publish', '--until', STAGES);
  if (STAGES.indexOf(from) > STAGES.indexOf(until)) {
    throw new UsageError(`--from ${from} comes after --until ${until}`);
  }
  const runs = (stage: Stage) =>
    STAGES.indexOf(from) <= STAGES.indexOf(stage) && STAGES.indexOf(stage) <= STAGES.indexOf(until);

  console.log(`Episode ${date}, ${from} → ${until}, saving to ${describeStorage()}`);

  const brief = runs('gather')
    ? await stage('gather', () => gather(date, selectionTime(date, now)))
    : await load(keys.brief(date), BriefSchema, 'gather');
  if (until === 'gather') return;

  const script = runs('write')
    ? await stage('write', () => write(brief))
    : await load(keys.script(date), ScriptSchema, 'write');
  if (until === 'write') return;

  const segmentKeys = runs('voice')
    ? await stage('voice', () => voice(script))
    : script.segments.map((_, index) => keys.segment(date, index));
  if (until === 'voice') return;

  const audio = await stage('mix', () => mixEpisode(date, segmentKeys));
  console.log(`  ${audio.key}: ${formatDuration(audio.durationSec)}, ${audio.bytes} bytes`);
  if (until === 'mix') return;

  const record: EpisodeRecord = {
    date,
    title: script.title,
    description: script.description,
    audio,
    storyIds: brief.stories.map((story) => story.id),
    publishedAt: new Date().toISOString(),
  };
  await stage('publish', () => publishEpisode(record));
}

async function gather(date: string, selectAt: Date): Promise<Brief> {
  const excludeIds = await recentlyCoveredIds(selectAt);
  const refs = await selectStories(selectAt, excludeIds);
  const stories = await Promise.all(refs.map(gatherStory));
  const brief = BriefSchema.parse({ date, generatedAt: new Date().toISOString(), stories });
  const saved = await putJson(keys.brief(date), brief);
  for (const [i, story] of brief.stories.entries()) {
    const article = story.articleText
      ? `article ${story.articleText.match(/\S+/g)?.length ?? 0} words`
      : story.articleError
        ? `no article (${story.articleError})`
        : 'no link';
    console.log(`  ${i + 1}. [${story.points} points] ${story.title}`);
    console.log(`     ${story.comments.length} comments, ${article}`);
  }
  console.log(`  Saved ${saved.key}`);
  return brief;
}

async function write(brief: Brief): Promise<Script> {
  const stories = await Promise.all(
    brief.stories.map((_, index) => writeStorySegment(brief, index)),
  );
  const { intro, signoff } = await writeBookends(brief, stories);
  const script = ScriptSchema.parse(assembleScript(brief, intro, stories, signoff));
  await putJson(keys.script(brief.date), script);
  await putFile(
    keys.transcript(brief.date),
    renderTranscript(script),
    'text/markdown; charset=utf-8',
  );
  console.log(`  Saved ${keys.script(brief.date)} and ${keys.transcript(brief.date)}`);
  return script;
}

async function voice(script: Script): Promise<string[]> {
  const voiced = await Promise.all(
    script.segments.map((segment, index) => voiceSegment(script.date, index, segment)),
  );
  for (const { key, durationSec } of voiced)
    console.log(`  ${key}: ${formatDuration(durationSec)}`);
  return voiced.map((segment) => segment.key);
}

/** Until the publish task lands, nothing is excluded. */
async function recentlyCoveredIds(now: Date): Promise<number[]> {
  try {
    return await loadExcludeIds(now);
  } catch (error) {
    if (!(error instanceof NotImplementedError)) throw error;
    console.log(`  ${error.message}; not excluding recently covered stories.`);
    return [];
  }
}

/** Stories are picked as the cron picks them: from the 24 hours before its run that day. */
function selectionTime(date: string, now: Date): Date {
  const cronTime = new Date(`${date}T${String(CRON_HOUR_UTC).padStart(2, '0')}:00:00Z`);
  return cronTime < now ? cronTime : now;
}

async function stage<T>(name: Stage, run: () => Promise<T>): Promise<T> {
  console.log(`\n▸ ${name}`);
  const started = performance.now();
  const result = await run();
  console.log(`  ${name} done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  return result;
}

async function load<S extends z.ZodType>(key: string, schema: S, stage: Stage) {
  const value = await getJson(key, schema);
  if (value === null) {
    throw new UsageError(`No ${key} in ${describeStorage()}; run the ${stage} stage first`);
  }
  console.log(`\nLoaded ${key}`);
  return value;
}

function parseStage<T extends string>(value: string, flag: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new UsageError(
      `${flag} must be one of ${allowed.join(', ')}, not ${JSON.stringify(value)}`,
    );
  }
  return value as T;
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

main().catch((error: unknown) => {
  if (error instanceof NotImplementedError) {
    console.error(`\nStopped: ${error.message}.`);
    console.error('Everything before this step is saved. Use --until to stop before it.');
  } else if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${USAGE}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
