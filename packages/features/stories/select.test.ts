import { hnFixtures, stubHnApi } from '@upvoted/testing/hn';
import { describe, expect, it } from 'vitest';
import { selectStories } from './select';

// The recorded search covers the 24 hours before this moment.
const now = new Date('2026-11-03T08:00:00Z');
const ids = (refs: { id: number }[]) => refs.map((ref) => ref.id);

describe('selectStories', () => {
  it('picks the three biggest stories of the last 24 hours, biggest first', async () => {
    const fetch = stubHnApi();

    const refs = await selectStories(now, []);

    expect(ids(refs)).toEqual([50341174, 50337608, 50340088]);
    expect(refs[0]).toEqual({
      id: 50341174,
      title: 'Astra can read and write weights to improve Qwen',
      url: 'https://rikiyat.github.io/blog/weight-space-programming/',
      by: 'dbreunig',
      points: 2906,
      numComments: 877,
      createdAt: '2026-11-02T18:21:28.000Z',
    });
    // A Show HN post with no link has a null url.
    expect(refs[2]?.url).toBeNull();

    const search = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(search.searchParams.get('tags')).toBe('story');
    expect(search.searchParams.get('numericFilters')).toBe(
      'created_at_i>1793606400,created_at_i<=1793692800',
    );
  });

  it('ranks by points even when the search returns hits in another order', async () => {
    const { algolia } = hnFixtures();
    algolia.hits.reverse();
    stubHnApi({ algolia });

    expect(ids(await selectStories(now, []))).toEqual([50341174, 50337608, 50340088]);
  });

  it('skips excluded stories', async () => {
    stubHnApi();
    expect(ids(await selectStories(now, [50337608, 50341174]))).toEqual([
      50340088, 50336518, 50341462,
    ]);
  });

  it('skips dead and deleted stories', async () => {
    const { items } = hnFixtures();
    items['50337608'] = { ...items['50337608'], id: 50337608, dead: true };
    items['50340088'] = { id: 50340088, deleted: true };
    stubHnApi({ items });

    expect(ids(await selectStories(now, []))).toEqual([50341174, 50336518, 50341462]);
  });

  it('skips jobs', async () => {
    const { algolia, items } = hnFixtures();
    const job = algolia.hits[1] as { _tags: string[] };
    job._tags = ['job', 'author_someone', 'story_50337608'];
    items['50340088'] = { ...items['50340088'], id: 50340088, type: 'job' };
    stubHnApi({ algolia, items });

    expect(ids(await selectStories(now, []))).toEqual([50341174, 50336518, 50341462]);
  });

  it('picks n stories', async () => {
    stubHnApi();
    expect(ids(await selectStories(now, [], 1))).toEqual([50341174]);
  });

  it('throws when there are not enough stories', async () => {
    const { algolia } = hnFixtures();
    algolia.hits = algolia.hits.slice(0, 2);
    stubHnApi({ algolia });

    await expect(selectStories(now, [])).rejects.toThrow('Found only 2 of 3 stories');
  });
});
