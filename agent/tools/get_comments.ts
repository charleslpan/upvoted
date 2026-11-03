import { getComments } from '@upvoted/features/stories';
import { defineTool } from 'eve/tools';
import { z } from 'zod';

export default defineTool({
  description:
    "Reads a story's top-level comments in Hacker News's own ranking order, best first, a page " +
    'at a time. Usernames are left out. Each comment has its id and how many replies it has; ' +
    'pass nextCursor back as cursor for the next page.',
  inputSchema: z.object({
    id: z.int().positive().describe('The HN story id'),
    limit: z.int().min(1).max(30).optional().describe('Comments per page, default 12'),
    cursor: z.string().optional().describe("A previous page's nextCursor"),
  }),
  execute: ({ id, limit, cursor }) => getComments(id, { limit, cursor }),
});
