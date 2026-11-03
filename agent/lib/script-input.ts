import { ScriptDraftSchema } from '@upvoted/types';
import { z } from 'zod';

/** What check_script and publish_episode take: the script and the stories it covers. */
export const ScriptInputSchema = z.object({
  script: ScriptDraftSchema.describe(
    'The whole script: date, then segments intro, story, story, story, signoff, each with its lines',
  ),
  storyIds: z
    .array(z.int().positive())
    .length(3)
    .describe("The ids of story segments 1, 2 and 3, in get_top_stories' order"),
});
export type ScriptInput = z.infer<typeof ScriptInputSchema>;
