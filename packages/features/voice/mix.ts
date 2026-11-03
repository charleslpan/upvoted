import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '@upvoted/lib/config';
import { del, getFile, getJson, keys, putFile } from '@upvoted/lib/storage';
import { type EpisodeAudio, ScriptSchema, type SegmentKind } from '@upvoted/types';
import { ffmpeg } from './ffmpeg';
import { type Cue, MUSIC, musicFilter } from './music';
import { parseWav, pcmDurationSec } from './wav';

export const SAMPLE_RATE = 44_100;
export const TARGET_LUFS = -16;
const BITRATE = '96k';
/** Pauses between the episode's chunks, in seconds. */
export const GAPS = { afterTheme: 0.4, betweenSegments: 0.8, afterSting: 0.4 };
/** Each voice segment and each music cue is levelled before the final pass, music a bit lower. */
const VOICE_LUFS = -18;
const MUSIC_LUFS = -22;

export type MixPart =
  | { type: 'music'; cue: Cue }
  | { type: 'voice'; index: number }
  | { type: 'gap'; sec: number };

/**
 * The running order: the theme, the intro, a sting before each story, the stories, the sign-off,
 * then the theme's tail, with short pauses between.
 */
export function planMix(kinds: SegmentKind[]): MixPart[] {
  const parts: MixPart[] = [
    { type: 'music', cue: 'theme' },
    { type: 'gap', sec: GAPS.afterTheme },
  ];
  kinds.forEach((kind, index) => {
    if (index > 0) parts.push({ type: 'gap', sec: GAPS.betweenSegments });
    if (kind === 'story') {
      parts.push({ type: 'music', cue: 'sting' }, { type: 'gap', sec: GAPS.afterSting });
    }
    parts.push({ type: 'voice', index });
  });
  parts.push({ type: 'gap', sec: GAPS.betweenSegments }, { type: 'music', cue: 'tail' });
  return parts;
}

/** The episode's length from its plan and the voice segments' lengths. */
export function planDurationSec(parts: MixPart[], voiceSec: number[]): number {
  return parts.reduce((sum, part) => {
    if (part.type === 'gap') return sum + part.sec;
    if (part.type === 'music') return sum + MUSIC[part.cue].durationSec;
    return sum + (voiceSec[part.index] ?? 0);
  }, 0);
}

/**
 * Stitches the voiced segments (in order) with the theme and stings into a loudness-normalized
 * MP3, saved at `keys.episode(date)`. Deletes the segment WAVs once the MP3 is saved.
 */
export async function mixEpisode(date: string, segmentKeys: string[]): Promise<EpisodeAudio> {
  const started = performance.now();
  const script = await getJson(keys.script(date), ScriptSchema);
  const kinds =
    script && script.segments.length === segmentKeys.length
      ? script.segments.map((segment) => segment.kind)
      : positionalKinds(segmentKeys.length);
  const parts = planMix(kinds);

  const dir = await mkdtemp(path.join(tmpdir(), 'upvoted-mix-'));
  try {
    const voiceFiles: string[] = [];
    const voiceSec: number[] = [];
    for (const [i, key] of segmentKeys.entries()) {
      const wav = await getFile(key);
      if (!wav) throw new Error(`No ${key}; run the voice stage first`);
      voiceSec.push(pcmDurationSec(parseWav(wav)));
      const file = path.join(dir, `segment-${i}.wav`);
      await writeFile(file, wav);
      voiceFiles.push(file);
    }

    const output = path.join(dir, 'episode.mp3');
    await ffmpeg([
      ...voiceFiles.flatMap((file) => ['-i', file]),
      '-filter_complex',
      mixFilter(parts),
      '-map',
      '[out]',
      '-c:a',
      'libmp3lame',
      '-b:a',
      BITRATE,
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      ...id3Tags(date, script?.title),
      '-y',
      output,
    ]);

    const mp3 = await readFile(output);
    const saved = await putFile(keys.episode(date), mp3, 'audio/mpeg');
    await del(segmentKeys);
    const durationSec = planDurationSec(parts, voiceSec);
    console.log(
      `  Mixed ${segmentKeys.length} segments into ${saved.key} ` +
        `(${durationSec.toFixed(1)}s) in ${((performance.now() - started) / 1000).toFixed(1)}s`,
    );
    return { key: saved.key, url: saved.url, bytes: saved.bytes, durationSec };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Without a matching script: the first segment is the intro, the last the sign-off. */
function positionalKinds(count: number): SegmentKind[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? 'intro' : i === count - 1 ? 'signoff' : 'story',
  );
}

/** The filtergraph: level each part, join them in order, then normalize the whole episode. */
export function mixFilter(parts: MixPart[]): string {
  const format = `aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=mono`;
  const chains = parts.map((part, i) => {
    const label = `[p${i}]`;
    if (part.type === 'voice') {
      return `[${part.index}:a]${format},loudnorm=I=${VOICE_LUFS}:TP=-2:LRA=11,${format}${label}`;
    }
    if (part.type === 'music') {
      return `${musicFilter(part.cue, SAMPLE_RATE)},loudnorm=I=${MUSIC_LUFS}:TP=-3,${format}${label}`;
    }
    return `anullsrc=r=${SAMPLE_RATE}:cl=mono,atrim=duration=${part.sec},${format}${label}`;
  });
  const inputs = parts.map((_, i) => `[p${i}]`).join('');
  return [
    ...chains,
    `${inputs}concat=n=${parts.length}:v=0:a=1,` +
      `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11,${format}[out]`,
  ].join(';');
}

function id3Tags(date: string, title: string | undefined): string[] {
  const tags = {
    title: title ?? `${config.show.name}, ${date}`,
    artist: config.show.name,
    album: config.show.name,
    date,
    genre: 'Podcast',
  };
  return Object.entries(tags).flatMap(([name, value]) => ['-metadata', `${name}=${value}`]);
}
