import { getReplies } from '@upvoted/features/stories';
import { defineTool } from 'eve/tools';
import { z } from 'zod';

export default defineTool({
  description:
    "Reads a comment's top replies in Hacker News's own order. Usernames are left out. Use it " +
    'where a thread is contested or a reply adds something.',
  inputSchema: z.object({
    commentId: z.int().positive().describe('The comment id from get_comments or get_replies'),
    limit: z.int().min(1).max(10).optional().describe('Replies to read, default 5'),
  }),
  execute: async ({ commentId, limit }) => ({ replies: await getReplies(commentId, { limit }) }),
});
