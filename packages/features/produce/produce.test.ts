import { getFile, getJson, keys } from '@upvoted/lib/storage';
import { readJsonFixture } from '@upvoted/testing/fixtures';
import { stubHnApi } from '@upvoted/testing/hn';
import { type Script, ScriptSchema } from '@upvoted/types';
import { describe, expect, it } from 'vitest';
import { loadIndex } from '../episodes';
import { publishSaved, saveScript } from './produce';

const sample = ScriptSchema.parse(readJsonFixture('script-sample.json')) as Script;
const ids = sample.segments.flatMap((segment) => (segment.storyId ? [segment.storyId] : []));
const draft = {
  date: sample.date,
  segments: sample.segments.map(({ kind, lines }) => ({ kind, lines })),
};
const audio = {
  key: keys.episode(sample.date),
  url: `https://blob.example.com/${keys.episode(sample.date)}`,
  bytes: 8_000_000,
  durationSec: 700,
};

describe('saveScript', () => {
  it('saves the script and transcript with links and show notes looked up from HN', async () => {
    stubHnApi();

    const saved = await saveScript(draft, ids);

    expect(saved.segmentCount).toBe(5);
    expect(saved.stories.map((story) => story.url)).toEqual([
      'https://rikiyat.github.io/blog/weight-space-programming/',
      'https://chalmovsky.com/posts/wtf-ubuntu',
      null,
    ]);
    const script = await getJson(keys.script(sample.date), ScriptSchema);
    expect(script?.segments.map((segment) => segment.storyId)).toEqual([null, ...ids, null]);
    expect(script?.description).toContain('https://chalmovsky.com/posts/wtf-ubuntu');
    expect(script?.description).toContain('https://news.ycombinator.com/item?id=50340088');
    const transcript = (await getFile(keys.transcript(sample.date)))?.toString('utf8');
    expect(transcript).toContain(script?.description);
  });

  it('fails, saving nothing, when an id is not an HN story', async () => {
    stubHnApi();

    await expect(saveScript(draft, [ids[0] as number, ids[1] as number, 1])).rejects.toThrow();
    expect(await getFile(keys.script(sample.date))).toBeNull();
  });
});

describe('publishSaved', () => {
  it("publishes the saved script's title and show notes with the HN stories", async () => {
    stubHnApi();
    const { stories } = await saveScript(draft, ids);

    await publishSaved(sample.date, stories, audio);

    const [episode] = (await loadIndex()).episodes;
    const script = await getJson(keys.script(sample.date), ScriptSchema);
    expect(episode).toMatchObject({
      date: sample.date,
      title: script?.title,
      description: script?.description,
      audio,
      stories,
    });
  });
});
