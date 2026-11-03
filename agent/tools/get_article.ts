import { getArticle } from '@upvoted/features/stories';
import { defineTool } from 'eve/tools';
import { z } from 'zod';

export default defineTool({
  description:
    "Reads a story's linked article (its readable text, up to about 8,000 words) and the post's " +
    'own text, for Ask HN and Show HN. When the article cannot be read, articleError says why.',
  inputSchema: z.object({ id: z.int().positive().describe('The HN story id') }),
  execute: ({ id }) => getArticle(id),
});
