import { loadExcludeIds } from '@upvoted/features/episodes';
import { selectionTime, selectStories } from '@upvoted/features/stories';
import { EpisodeDateSchema } from '@upvoted/types';
import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { selection } from '../lib/selection';

export default defineTool({
  description:
    "Picks the episode's three stories: the biggest on Hacker News (most points) in the 24 hours " +
    'before 09:00 UTC on the date, skipping stories covered in the past week. Biggest ' +
    'first, which is the running order. Call it once, first.',
  inputSchema: z.object({ date: EpisodeDateSchema.describe('The episode date, YYYY-MM-DD') }),
  async execute({ date }) {
    const at = selectionTime(date, new Date());
    const refs = await selectStories(at, await loadExcludeIds(at));
    selection.update(() => ({ date, ids: refs.map((ref) => ref.id) }));
    console.log(`get_top_stories ${date}: ${refs.map((ref) => ref.id).join(', ')}`);
    return {
      date,
      stories: refs.map((ref) => ({
        id: ref.id,
        title: ref.title,
        url: ref.url,
        hnUrl: `https://news.ycombinator.com/item?id=${ref.id}`,
        points: ref.points,
        comments: ref.numComments,
      })),
    };
  },
});
