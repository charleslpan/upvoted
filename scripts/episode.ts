import './env';
import { parseArgs } from 'node:util';
import { publishSaved, voiceSavedSegment } from '@upvoted/features/produce';
import { lookupStories } from '@upvoted/features/stories';
import { mixEpisode } from '@upvoted/features/voice';
import { config } from '@upvoted/lib/config';
import { episodeDate } from '@upvoted/lib/dates';
import { describeStorage, getJson, keys } from '@upvoted/lib/storage';
import { EpisodeDateSchema, ScriptSchema } from '@upvoted/types';

/**
 * Voices, mixes and publishes a saved script locally, through @upvoted/lib/storage: local files
 * under out/ by default, or Vercel Blob when BLOB_READ_WRITE_TOKEN is set. The script itself
 * comes from an agent run (see AGENTS.md); this redoes the audio from it, which with
 * UPVOTED_FAKE_VOICES=1 needs no API key.
 */

const STAGES = ['voice', 'mix', 'publish'] as const;
type Stage = (typeof STAGES)[number];
/** Stages a run can start at; publish needs the mix's result, which isn't saved on its own. */
const START_STAGES = ['voice', 'mix'] as const;

const USAGE = `Usage: pnpm episode [--date YYYY-MM-DD] [--from STAGE] [--until STAGE]

Voices, mixes and publishes episodes/<date>/script.json. Stages, in order: ${STAGES.join(', ')}.

  --date   Episode date. Default: today in ${config.show.timezone}.
  --from   First stage to run (${START_STAGES.join(', ')}). Default: voice.
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

  const date = values.date ?? episodeDate(new Date());
  if (!EpisodeDateSchema.safeParse(date).success) {
    throw new UsageError(`--date must be a date as YYYY-MM-DD, not ${JSON.stringify(date)}`);
  }
  const from = parseStage(values.from ?? 'voice', '--from', START_STAGES);
  const until = parseStage(values.until ?? 'publish', '--until', STAGES);
  if (STAGES.indexOf(from) > STAGES.indexOf(until)) {
    throw new UsageError(`--from ${from} comes after --until ${until}`);
  }

  console.log(`Episode ${date}, ${from} → ${until}, using ${describeStorage()}`);
  const script = await getJson(keys.script(date), ScriptSchema);
  if (!script) throw new UsageError(`No ${keys.script(date)} in ${describeStorage()}`);

  const segmentKeys =
    from === 'voice'
      ? await stage('voice', async () => {
          const voiced = await Promise.all(
            script.segments.map((_, index) => voiceSavedSegment(date, index)),
          );
          for (const key of voiced) console.log(`  ${key}`);
          return voiced;
        })
      : script.segments.map((_, index) => keys.segment(date, index));
  if (until === 'voice') return;

  const audio = await stage('mix', () => mixEpisode(date, segmentKeys));
  console.log(`  ${audio.key}: ${formatDuration(audio.durationSec)}, ${audio.bytes} bytes`);
  if (until === 'mix') return;

  await stage('publish', async () => {
    const storyIds = script.segments.flatMap((segment) => segment.storyId ?? []);
    await publishSaved(date, await lookupStories(storyIds), audio);
    console.log(`  Published ${date} to ${keys.index}`);
  });
}

async function stage<T>(name: Stage, run: () => Promise<T>): Promise<T> {
  console.log(`\n▸ ${name}`);
  const started = performance.now();
  const result = await run();
  console.log(`  ${name} done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  return result;
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
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${USAGE}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
